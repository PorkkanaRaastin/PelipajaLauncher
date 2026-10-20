// Pelipaja – automaattiset päivitykset GitHubista
//
// Käynnistyksen jälkeen haetaan GitHub Releasesista tieto uusimmasta versiosta (latest.json).
// Jos se on uudempi, ladataan päivityspaketti, tarkistetaan allekirjoitus (update-verify.js)
// ja asennetaan kansioon %APPDATA%/pelipaja/updates. Uusi versio käynnistyy seuraavalla
// kerralla, tai heti kun käyttäjä painaa "Käynnistä uudelleen".
const { app, session } = require("electron");
const path = require("path");
const fs = require("fs");
const state = require("./state");
const verify = require("./update-verify");
const { APP_VERSION } = require("./paths");

const REPO = "PorkkanaRaastin/PelipajaLauncher";
const RELEASES = `https://github.com/${REPO}/releases`;
const LATEST_URL = process.env.PELIPAJA_UPDATE_URL && !app.isPackaged ? process.env.PELIPAJA_UPDATE_URL : `${RELEASES}/latest/download/latest.json`;
const CHECK_EVERY_MS = 60 * 60 * 1000;

const updatesDir = () => path.join(app.getPath("userData"), "updates");
let status = { state: "idle", version: null, error: null };

function send() {
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) win.webContents.send("update-status", status);
}
function set(next) {
  status = { ...status, ...next };
  send();
}

// Oma istunto päivityksille (ei evästeitä tai välimuistia muiden sivujen kanssa)
async function fetchBuffer(url, max, onProgress, timeoutMs = 60000) {
  if (app.isPackaged && !url.startsWith("https://")) throw new Error("vain https sallittu");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await session.fromPartition("pelipaja-updater").fetch(url, { cache: "no-store", redirect: "follow", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") || 0);
    if (total > max) throw new Error("liian suuri tiedosto");
    const chunks = [];
    let got = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (got > max) throw new Error("liian suuri tiedosto");
      chunks.push(Buffer.from(value));
      if (onProgress && total) onProgress(got / total);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === "AbortError") throw new Error("aikakatkaisu");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Kehitysversio (npm start) ei päivity itsestään, paitsi testissä PELIPAJA_UPDATE_URL-osoitteella
const enabled = () => app.isPackaged || !!process.env.PELIPAJA_UPDATE_URL;

// Samanaikaiset kutsut odottavat samaa tarkistusta
let inflight = null;
function check() {
  if (!enabled() || status.state === "ready" || status.state === "restarting") return Promise.resolve(status);
  if (!inflight) inflight = doCheck().finally(() => (inflight = null));
  return inflight;
}

async function doCheck() {
  try {
    set({ state: "checking", progress: 0, error: null });
    const latest = JSON.parse((await fetchBuffer(LATEST_URL, 64 * 1024, null, 8000)).toString("utf8"));
    if (!/^\d+\.\d+\.\d+$/.test(latest.version) || verify.compareVersions(latest.version, APP_VERSION) <= 0) {
      set({ state: "uptodate", version: APP_VERSION, error: null });
      return status;
    }
    // Uusi exe tarvitaan (Electron-versio vaihtui): käyttäjän pitää ladata Pelipaja uudelleen
    if (latest.electron && verify.electronMajor(latest.electron) !== verify.electronMajor(process.versions.electron)) {
      set({ state: "manual", version: latest.version, url: `${RELEASES}/latest`, error: null });
      return status;
    }
    if (!/^[A-Za-z0-9._-]+$/.test(latest.file || "") || !/^[a-f0-9]{64}$/.test(latest.sha256 || "")) throw new Error("virheellinen latest.json");
    // Jo ladattu aiemmin?
    const installed = verify.bestInstalled(updatesDir(), APP_VERSION, process.versions.electron);
    if (installed && verify.compareVersions(installed.version, latest.version) >= 0) {
      set({ state: "ready", version: installed.version, error: null });
      return status;
    }
    // Versio, joka on aiemmin kaatunut käynnistyessä, ladataan vasta kun tulee uudempi
    if (fs.existsSync(path.join(updatesDir(), latest.version + ".bad"))) {
      set({ state: "error", error: `versio ${latest.version} ei käynnistynyt tällä koneella` });
      return status;
    }
    set({ state: "downloading", version: latest.version, progress: 0, error: null });
    let lastSent = 0;
    const buf = await fetchBuffer(new URL(latest.file, LATEST_URL).href, 80 * 1024 * 1024, (p) => {
      if (p - lastSent >= 0.02 || p === 1) {
        lastSent = p;
        set({ progress: p });
      }
    });
    set({ state: "installing", progress: 1 });
    if (verify.sha256(buf) !== latest.sha256) throw new Error("ladattu tiedosto ei täsmää");
    const m = verify.installBundle(buf, updatesDir());
    if (m.version !== latest.version) throw new Error("väärä versio paketissa");
    verify.cleanup(updatesDir());
    set({ state: "ready", version: m.version, error: null });
  } catch (err) {
    console.error("Päivityksen tarkistus epäonnistui:", err.message);
    set({ state: "error", error: String(err.message || err) });
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

// Käytön aikana tarkistetaan tunnin välein (ilmoitus sivupalkkiin)
function start() {
  if (!enabled()) return;
  setInterval(check, CHECK_EVERY_MS).unref();
}

module.exports = { start, check, startup, getStatus: () => status };
