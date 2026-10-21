// Pelipaja – automaattiset päivitykset GitHubista
//
// Käynnistyksen jälkeen haetaan GitHub Releasesista tieto uusimmasta versiosta (latest.json).
// Jos se on uudempi, ladataan päivityspaketti, tarkistetaan allekirjoitus (update-verify.js)
// ja asennetaan kansioon %APPDATA%/pelipaja/updates. Uusi versio käynnistyy seuraavalla
// kerralla, tai heti kun käyttäjä painaa "Restart now".
// Käytön aikana tarkistetaan 10 sekunnin välein hiljaa taustalla; käyttöliittymä ehdottaa
// päivitystä, kun uusi versio on ladattu. history() palauttaa päivityshistorian.
const { app, session, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const state = require("./state");
const verify = require("./update-verify");
const { APP_VERSION, ROOT } = require("./paths");

const REPO = "PorkkanaRaastin/PelipajaLauncher";
const RELEASES = `https://github.com/${REPO}/releases`;
const LATEST_URL = process.env.PELIPAJA_UPDATE_URL && !app.isPackaged ? process.env.PELIPAJA_UPDATE_URL : `${RELEASES}/latest/download/latest.json`;
const CHECK_EVERY_MS = 10 * 1000;

const updatesDir = () => path.join(app.getPath("userData"), "updates");
let status = { state: "idle", version: null, error: null, checkedAt: 0, latest: null };

// Loki tiedostoon updates/update-log.txt, jotta ongelmat näkyvät jälkikäteen
function log(msg) {
  const line = new Date().toISOString() + " " + msg + "\n";
  console.log("[update] " + msg);
  try {
    const f = path.join(updatesDir(), "update-log.txt");
    fs.mkdirSync(updatesDir(), { recursive: true });
    try {
      if (fs.statSync(f).size > 200 * 1024) fs.renameSync(f, f + ".old");
    } catch {}
    fs.appendFileSync(f, line);
  } catch {}
}

function send() {
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) win.webContents.send("update-status", status);
}
function set(next) {
  status = { ...status, ...next };
  send();
}

// Oma istunto päivityksille (ei evästeitä tai välimuistia muiden sivujen kanssa)
async function fetchBuffer(url, max, onProgress, timeoutMs = 60000, headers) {
  if (app.isPackaged && !url.startsWith("https://")) throw new Error("only https allowed");
  // aikakatkaisu nollautuu aina kun dataa tulee (hidas mutta toimiva yhteys ei katkea)
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  };
  try {
    const res = await session.fromPartition("pelipaja-updater").fetch(url, { cache: "no-store", redirect: "follow", signal: ctrl.signal, headers: headers || {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    if (total > max) throw new Error("file too large");
    const chunks = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      alive();
      if (got > max) throw new Error("file too large");
      chunks.push(Buffer.from(value));
      if (onProgress && total) onProgress(got / total);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Kehitysversio (npm start) ei päivity itsestään, paitsi testissä PELIPAJA_UPDATE_URL-osoitteella
const enabled = () => app.isPackaged || !!process.env.PELIPAJA_UPDATE_URL;

// Ladatun päivityksen "What's new" -rivit (tulevat päivityspaketin mukana)
function notesFor(version) {
  try {
    const w = JSON.parse(fs.readFileSync(path.join(updatesDir(), version, "whats-new.json"), "utf8"));
    const clean = (a, n) => (Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, n).map((x) => x.slice(0, 200)) : []);
    return { notes: clean(w.notes, 10), newGames: clean(w.newGames, 20) };
  } catch {
    return { notes: [], newGames: [] };
  }
}

// Samanaikaiset kutsut odottavat samaa tarkistusta
let inflight = null;
let quietUntil = 0; // taustatarkistuksen tauko (GitHubin rajoitus tai peräkkäiset virheet)
let limitedUntil = 0; // GitHubin rajoitus (HTTP 403/429)
let fails = 0;
function check(quiet, now) {
  if (!enabled() || status.state === "restarting") return Promise.resolve(status);
  if (inflight) return inflight;
  if (quiet && Date.now() < (now ? limitedUntil : quietUntil)) return Promise.resolve(status);
  inflight = doCheck(!!quiet).finally(() => (inflight = null));
  return inflight;
}

async function doCheck(quiet) {
  // hiljaisessa tarkistuksessa käyttöliittymälle kerrotaan vain muutoksista
  const q = (next) => {
    if (quiet && next.state === status.state && next.version === status.version) return;
    set(next);
  };
  try {
    if (!quiet || status.state === "error") set({ state: "checking", progress: 0, error: null });
    const latest = JSON.parse((await fetchBuffer(LATEST_URL, 64 * 1024, null, 10000)).toString("utf8"));
    status.checkedAt = Date.now();
    status.latest = typeof latest.version === "string" ? latest.version.slice(0, 20) : null;
    fails = 0;
    if (!/^\d+\.\d+\.\d+$/.test(latest.version) || verify.compareVersions(latest.version, APP_VERSION) <= 0) {
      q({ state: "uptodate", version: APP_VERSION, error: null });
      send(); // "Last checked" päivittyy käyttöliittymään
      return status;
    }
    // Uusi exe tarvitaan (Electron-versio vaihtui): käyttäjän pitää ladata Pelipaja uudelleen
    if (latest.electron && verify.electronMajor(latest.electron) !== verify.electronMajor(process.versions.electron)) {
      q({ state: "manual", version: latest.version, url: `${RELEASES}/latest`, error: null, notes: [], newGames: [] });
      return status;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(latest.file || "") || !/^[a-f0-9]{64}$/.test(latest.sha256 || "")) throw new Error("invalid latest.json");
    // Jo ladattu aiemmin?
    const installed = verify.bestInstalled(updatesDir(), APP_VERSION, process.versions.electron);
    if (installed && verify.compareVersions(installed.version, latest.version) >= 0) {
      q({ state: "ready", version: installed.version, error: null, ...notesFor(installed.version) });
      send();
      return status;
    }
    // Versio, joka on aiemmin kaatunut käynnistyessä, ladataan vasta kun tulee uudempi
    if (fs.existsSync(path.join(updatesDir(), latest.version + ".bad"))) {
      q({ state: "error", version: latest.version, error: `version ${latest.version} failed to start on this computer` });
      return status;
    }
    log(`downloading ${latest.version} (running ${APP_VERSION})`);
    set({ state: "downloading", version: latest.version, progress: 0, error: null });
    let lastSent = 0;
    const buf = await fetchBuffer(new URL(latest.file, LATEST_URL).href, 80 * 1024 * 1024, (p) => {
      if (p - lastSent >= 0.02 || p === 1) {
        lastSent = p;
        set({ progress: p });
      }
    });
    set({ state: "installing", progress: 1 });
    if (verify.sha256(buf) !== latest.sha256) throw new Error("downloaded file doesn't match");
    const m = await verify.installBundle(buf, updatesDir());
    if (m.version !== latest.version) throw new Error("wrong version in bundle");
    try {
      verify.cleanup(updatesDir(), 2, [APP_VERSION, m.version, path.basename(ROOT)]);
    } catch {}
    log(`installed ${m.version}`);
    set({ state: "ready", version: m.version, error: null, ...notesFor(m.version) });
    notifyGames();
  } catch (err) {
    const msg = String(err.message || err);
    fails++;
    log(`${quiet ? "background " : ""}check failed (${fails}): ${msg}`);
    // GitHubin rajoitus: 5 min tauko. Muuten tauko kasvaa virheistä (10 s, 20 s, enintään 30 s)
    if (/HTTP (403|429)/.test(msg)) limitedUntil = Date.now() + 5 * 60 * 1000;
    quietUntil = Math.max(limitedUntil, Date.now() + Math.min(30000, 10000 * fails) - 1000);
    // valmiiksi ladattu päivitys pysyy valmiina, vaikka uudemman tarkistus epäonnistuisi
    if (quiet && status.state === "ready" && verify.bestInstalled(updatesDir(), APP_VERSION, process.versions.electron)) return status;
    if (!quiet || status.state === "checking" || status.state === "downloading" || status.state === "installing") set({ state: "error", error: msg });
  }
  return status;
}

// Käynnistysnäkymä: tarkistetaan ja ladataan uusin versio ennen launcheria.
// Jos uusi versio asentui, Pelipaja käynnistyy heti uudelleen sillä.
// Uudelleenkäynnistys samaan versioon vain kerran kahden minuutin sisällä (ei silmukkaa,
// jos uusi versio ei jostain syystä käynnistyisikään)
function mayRestartTo(version) {
  const f = path.join(updatesDir(), "restart.json");
  try {
    const last = JSON.parse(fs.readFileSync(f, "utf8"));
    if (last.version === version && Date.now() - last.at < 2 * 60 * 1000) return false;
  } catch {}
  try {
    fs.writeFileSync(f, JSON.stringify({ version, at: Date.now() }));
  } catch {}
  return true;
}

async function startup() {
  if (!enabled()) return { state: "dev", version: APP_VERSION };
  const s = await check();
  if (s.state === "ready" && app.isPackaged && mayRestartTo(s.version)) {
    set({ state: "restarting" });
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 700);
  }
  return status;
}

// Pelien ikkunoihin pieni ilmoitus: päivitys asentuu, kun peli suljetaan
function notifyGames() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w === state.launcherWin || w.isDestroyed()) continue;
    try {
      w.webContents.send("rr-update-ready", status.version);
    } catch {}
  }
}

// Käytön aikana tarkistetaan 10 sekunnin välein (käyttöliittymä ehdottaa päivitystä).
// Lisäksi heti, kun Pelipajan ikkuna aktivoituu. Ajastin tarkistaa myös, ettei tarkistus ole jumissa.
let started = false;
function tick(now) {
  const before = status.state + status.version;
  return check(true, now).then(() => {
    // uusi päivitys valmiina: välkytetään tehtäväpalkissa, jos Pelipaja on taustalla
    const win = state.launcherWin;
    if (status.state === "ready" && before !== status.state + status.version && win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
  }, (err) => log("tick failed: " + (err && err.message)));
}
function start() {
  if (!enabled() || started) return;
  started = true;
  log(`background checks every ${CHECK_EVERY_MS / 1000} s (running ${APP_VERSION})`);
  setInterval(() => tick(), CHECK_EVERY_MS);
  let lastFocus = 0;
  app.on("browser-window-focus", (_e, win) => {
    if (win !== state.launcherWin || Date.now() - lastFocus < 3000) return;
    lastFocus = Date.now();
    tick(true);
  });
}

// ---------- päivityshistoria ----------
// Julkaisu kokoaa historian commit-viesteistä (scripts/make-notes.js) tiedostoon update-history.json,
// joka tulee päivityspaketin mukana. Näin historia toimii ilman nettiä eikä GitHubin rajoituksia tarvitse miettiä.
// Ladattu mutta vielä asentamaton versio lisätään listan alkuun.
function readHistory(file) {
  try {
    const h = JSON.parse(fs.readFileSync(file, "utf8"));
    const str = (x, n) => (typeof x === "string" ? x.slice(0, n) : "");
    const list = (a, n) => (Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, n).map((x) => x.slice(0, 240)) : []);
    return (Array.isArray(h.releases) ? h.releases : [])
      .filter((r) => r && /^\d+\.\d+\.\d+$/.test(r.version))
      .slice(0, 200)
      .map((r) => ({ version: r.version, date: str(r.date, 10), notes: list(r.notes, 20), newGames: list(r.newGames, 30) }));
  } catch {
    return null;
  }
}
async function history() {
  const releases = readHistory(path.join(ROOT, "update-history.json"));
  if (!releases) return { ok: false, error: app.isPackaged ? "No update history in this version yet. It appears after the next update." : "Development build: the history is created when Pelipaja is published.", current: APP_VERSION };
  // ladattu päivitys (odottaa uudelleenkäynnistystä): sen oma historia on uusin
  if (status.state === "ready" && status.version) {
    const next = readHistory(path.join(updatesDir(), status.version, "update-history.json"));
    if (next && next.length) return { ok: true, releases: next, current: APP_VERSION };
  }
  return { ok: true, releases, current: APP_VERSION };
}

module.exports = { start, check, startup, history, getStatus: () => status };
