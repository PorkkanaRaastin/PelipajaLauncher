// Pelipaja – pääprosessi (Electron)
//
//   index.js     käynnistys, launcher-ikkuna ja IPC-kanavat
//   security.js  ikkunoiden, sivujen ja IPC:n suojaukset
//   accounts.js  kirjautuminen ja rekisteröinti (cloud.js = Supabase)
//   games.js     pelien käynnistys ja Save & End Game (catalog.js = games.json)
//   stats.js     peliajat ja käynnistykset
//   settings.js  asetukset
//   storage.js   salattu tallennus koneelle
//   updater.js   automaattiset päivitykset GitHubista (update-verify.js tarkistaa allekirjoituksen)
//   whatsnew.js  "Mitä uutta" -ikkuna ja uusien pelien UUSI-merkit
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const state = require("./state");
const storage = require("./storage");
const security = require("./security");
const accounts = require("./accounts");
const games = require("./games");
const stats = require("./stats");
const settings = require("./settings");
const updater = require("./updater");
const whatsnew = require("./whatsnew");
const { createCloud, CloudError } = require("./cloud");
const CLOUD = require("./cloud-config");
const { RENDERER_DIR, PRELOAD_DIR, GAMES_DIR, ICON, APP_VERSION } = require("./paths");
const { GAME_ID } = require("./catalog");

app.setName("Pelipaja");
storage.setupDataDir();
security.hardenApp();

// Vain yksi Pelipaja kerrallaan: toinen käynnistys tuo olemassa olevan ikkunan esiin
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = state.launcherWin;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

async function start() {
  whatsnew.compute(); // "Mitä uutta" lasketaan ennen mahdollista päivityksen uudelleenkäynnistystä
  try {
    state.cloud = createCloud({
      // Testiympäristön palvelimen voi vaihtaa vain kehitysversiossa (npm start)
      url: (!app.isPackaged && process.env.PELIPAJA_SUPABASE_URL) || CLOUD.url,
      key: CLOUD.publishableKey,
      dataDir: storage.dataDir(),
      seal: storage.seal,
      unseal: storage.unseal,
      createClient,
    });
    await accounts.restore().catch((err) => console.error("Session restore failed:", err.message));
  } catch (err) {
    console.error("Cloud service start failed:", err);
  }
  createLauncher();
  updater.start();
}

function createLauncher() {
  const win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: "Pelipaja",
    backgroundColor: "#101318",
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, "launcher.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  security.hardenSession(win.webContents.session);
  security.setRole(win.webContents, { kind: "launcher" });
  state.launcherWin = win;
  win.on("closed", () => (state.launcherWin = null));
  win.loadFile(path.join(RENDERER_DIR, "index.html"));
}

// ---------- IPC ----------
// Jokainen kanava tarkistaa lähettäjän: launcherin kanavat toimivat vain launcher-ikkunasta
// ja pelien kanavat vain peli-ikkunoista.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, arg) => {
    if (!security.fromLauncher(event)) throw new Error("Blocked");
    return fn(arg);
  });
}

// Virheet palautetaan käyttöliittymälle selkokielisinä ({ ok:false, error, field })
function authHandle(channel, fn) {
  handle(channel, async (arg) => {
    try {
      return await fn(arg);
    } catch (err) {
      if (err instanceof CloudError) return { ok: false, error: err.message, field: err.field };
      console.error(err);
      return { ok: false, error: "Unexpected error. Please try again." };
    }
  });
}

const signedIn = () => !!state.session;
const validId = (id) => typeof id === "string" && GAME_ID.test(id);

handle("app-info", () => ({ version: APP_VERSION, dev: !app.isPackaged }));
handle("update-status", () => updater.getStatus());
handle("whats-new", () => whatsnew.compute());
handle("update-check", () => updater.check());
handle("update-startup", () => updater.startup());
handle("update-restart", () => {
  if (games.hasRunning()) return { ok: false, error: "Close running games first." };
  if (updater.getStatus().state !== "ready") return { ok: false, error: "The update isn't ready." };
  stats.flushStats().catch(() => {}).finally(() => {
    app.relaunch();
    app.quit();
  });
  return { ok: true };
});
// Uuden Pelipaja-version lataussivu (kun exe itse pitää vaihtaa)
handle("update-open-page", () => shell.openExternal("https://github.com/PorkkanaRaastin/PelipajaLauncher/releases/latest"));
handle("get-games", () => (signedIn() ? games.publicGames() : []));
handle("get-stats", () => (signedIn() ? stats.readStats() : {}));
handle("get-running", () => games.runningIds());
handle("launch-game", (id) => (validId(id) ? games.launch(id) : { ok: false, error: "Game not found." }));
handle("stop-game", (id) => (validId(id) ? games.stop(id) : false));
handle("get-settings", () => settings.readSettings());
handle("set-settings", (patch) => (signedIn() ? settings.updateSettings(patch) : settings.readSettings()));
// Pelikansio avataan vain kehitysversiossa. Valmiissa versiossa pelit ovat lukittuina
// sovelluspaketin sisällä ja uudet pelit tulevat päivitysten mukana.
handle("open-games-folder", () => (app.isPackaged ? false : shell.openPath(GAMES_DIR)));

authHandle("auth-status", accounts.api.status);
authHandle("auth-start", accounts.api.start);
authHandle("auth-resend", accounts.api.resend);
authHandle("auth-verify", accounts.api.verify);
authHandle("auth-password", accounts.api.setPassword);
authHandle("auth-login", accounts.api.login);
authHandle("auth-logout", async () => {
  if (games.hasRunning()) return { ok: false, error: "Close running games before signing out." };
  return accounts.api.logout();
});

// Peli-ikkunoiden kanavat
ipcMain.on("game-save-and-end", (event) => {
  if (security.fromGame(event)) games.saveAndEndSender(event.sender);
});
ipcMain.on("game-button-corner", (event) => {
  event.returnValue = security.fromGame(event) ? games.buttonCorner(event.sender) : "top-left";
});

app.on("window-all-closed", () => app.quit());
