// Pelipaja – tietoturva
//
// - Ikkunat eivät voi avata uusia ikkunoita, upottaa <webview>-elementtejä eivätkä siirtyä
//   muille sivuille (pelit pysyvät omassa kansiossaan).
// - Sivut saavat ladata koneelta vain Pelipajan omia tiedostoja, eivät esim. käyttäjän dokumentteja.
// - Salaamattomat yhteydet (http://, ws://) estetään.
// - Pelit saavat vain ne selainoikeudet, joita ne tarvitsevat (koko näyttö, hiiren lukitus,
//   leikepöydälle kopiointi). Mikrofoni sallitaan vain peleille, joilla on games.jsonissa
//   "voice": true (äänichat). Kamera, sijainti, ilmoitukset jne. on estetty.
// - IPC-viestit hyväksytään vain oikeasta ikkunasta.
const { app } = require("electron");
const { fileURLToPath } = require("url");
const { isInside } = require("./catalog");
const { RENDERER_DIR, GAMES_DIR, ASSETS_DIR } = require("./paths");

const GAME_PERMISSIONS = new Set(["fullscreen", "pointerLock", "clipboard-sanitized-write"]);
const ALLOWED_SCHEMES = new Set(["https:", "wss:", "file:", "data:", "blob:", "devtools:"]);

// webContents.id -> { kind: "launcher" } | { kind: "game", root, origin }
const roles = new Map();

function setRole(wc, role) {
  const id = wc.id;
  roles.set(id, role);
  wc.once("destroyed", () => roles.delete(id));
}
const roleOf = (wc) => (wc && roles.get(wc.id)) || null;

function filePath(url) {
  try {
    return fileURLToPath(url);
  } catch {
    return null;
  }
}
function fileAllowed(url, roots) {
  const p = filePath(url);
  return !!p && roots.some((r) => p === r || isInside(r, p));
}

// Mihin ikkuna saa siirtyä (linkit, location.href, reload)
function navigationAllowed(wc, url) {
  const role = roleOf(wc);
  if (!role || role.kind !== "game") return false; // launcher ei siirry minnekään
  if (role.root) return url.startsWith("file:") && fileAllowed(url, [role.root]);
  try {
    return new URL(url).origin === role.origin;
  } catch {
    return false;
  }
}

const hardened = new WeakSet();
function hardenSession(ses) {
  if (hardened.has(ses)) return ses;
  hardened.add(ses);
  const roots = [RENDERER_DIR, GAMES_DIR, ASSETS_DIR];

  // äänichat: vain mikrofoni (ei kameraa eikä näytön jakoa) ja vain voice-peleille
  const micOnly = (details) => {
    const types = (details && details.mediaTypes) || [];
    return types.length > 0 && types.every((t) => t === "audio");
  };
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const role = roleOf(wc);
    if (!role || role.kind !== "game") return callback(false);
    if (permission === "media") return callback(!!role.voice && micOnly(details));
    callback(GAME_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const role = roleOf(wc);
    if (!role || role.kind !== "game") return false;
    if (permission === "media") return !!role.voice && (!details || !details.mediaType || details.mediaType === "audio");
    return GAME_PERMISSIONS.has(permission);
  });
  ses.setDevicePermissionHandler(() => false); // USB/HID/sarjaportit
  ses.on("will-download", (e) => e.preventDefault());

  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    const url = details.url;
    let scheme = "";
    try {
      scheme = new URL(url).protocol;
    } catch {}
    if (!ALLOWED_SCHEMES.has(scheme)) return callback({ cancel: true });
    if (scheme === "file:" && !fileAllowed(url, roots)) return callback({ cancel: true });
    callback({});
  });
  return ses;
}

function hardenApp() {
  // Kaikki sivut hiekkalaatikossa (testiympäristön --no-sandbox-ajoa lukuun ottamatta)
  if (!app.commandLine.hasSwitch("no-sandbox")) app.enableSandbox();
  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("will-navigate", (e, url) => {
      if (!navigationAllowed(wc, url)) e.preventDefault();
    });
    wc.on("will-redirect", (e, url) => {
      if (!navigationAllowed(wc, url)) e.preventDefault();
    });
    wc.on("will-frame-navigate", (e) => {
      // iframet saavat näyttää vain sallittuja tiedostoja / https-sivuja
      if (e.isMainFrame) return;
      if (e.url.startsWith("file:") && !fileAllowed(e.url, [GAMES_DIR])) e.preventDefault();
    });
  });
}

// ---------- IPC ----------
// Hyväksytään vain launcher-ikkunan pääkehyksestä tulevat viestit.
function fromLauncher(event) {
  const role = roleOf(event.sender);
  return !!role && role.kind === "launcher" && event.senderFrame === event.sender.mainFrame;
}
function fromGame(event) {
  const role = roleOf(event.sender);
  return !!role && role.kind === "game" && event.senderFrame === event.sender.mainFrame;
}

module.exports = { hardenApp, hardenSession, setRole, roleOf, fromLauncher, fromGame, fileAllowed };
