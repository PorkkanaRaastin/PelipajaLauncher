// Pelipaja – automaattiset päivitykset GitHubista
//
// Käynnistyksen jälkeen haetaan GitHub Releasesista tieto uusimmasta versiosta (latest.json).
// Jos se on uudempi, ladataan päivityspaketti, tarkistetaan allekirjoitus (update-verify.js)
// ja asennetaan kansioon %APPDATA%/pelipaja/updates. Uusi versio käynnistyy seuraavalla
// kerralla, tai heti kun käyttäjä painaa "Käynnistä uudelleen".
const { app, session } = require("electron");
const path = require("path");
const state = require("./state");
const verify = require("./update-verify");
const { APP_VERSION } = require("./paths");

const REPO = "PorkkanaRaastin/PelipajaLauncher";
const RELEASES = `https://github.com/${REPO}/releases`;
const LATEST_URL = process.env.PELIPAJA_UPDATE_URL && !app.isPackaged ? process.env.PELIPAJA_UPDATE_URL : `${RELEASES}/latest/download/latest.json`;
const CHECK_EVERY_MS = 60 * 60 * 1000;

const updatesDir = () => path.join(app.getPath("userData"), "updates");
let status = { state: "idle", version: null, error: null };
let checking = false;

function send() {
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) win.webContents.send("update-status", status);
}
function set(next) {
  status = { ...status, ...next };
  send();
}

// Oma istunto päivityksille (ei evästeitä tai välimuistia muiden sivujen kanssa)
async function fetchBuffer(url, max) {
  if (app.isPackaged && !url.startsWith("https://")) throw new Error("vain https sallittu");
  const res = await session.fromPartition("pelipaja-updater").fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > max) throw new Error("liian suuri tiedosto");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error("liian suuri tiedosto");
  return buf;
}

// Kehitysversio (npm start) ei päivity itsestään, paitsi testissä PELIPAJA_UPDATE_URL-osoitteella
const enabled = () => app.isPackaged || !!process.env.PELIPAJA_UPDATE_URL;

async function check() {
  if (!enabled()) return status;
  if (checking || status.state === "ready") return status;
  checking = true;
  try {
    const latest = JSON.parse((await fetchBuffer(LATEST_URL, 64 * 1024)).toString("utf8"));
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
    set({ state: "downloading", version: latest.version, error: null });
    const buf = await fetchBuffer(new URL(latest.file, LATEST_URL).href, 80 * 1024 * 1024);
    if (verify.sha256(buf) !== latest.sha256) throw new Error("ladattu tiedosto ei täsmää");
    const m = verify.installBundle(buf, updatesDir());
    if (m.version !== latest.version) throw new Error("väärä versio paketissa");
    verify.cleanup(updatesDir());
    set({ state: "ready", version: m.version, error: null });
  } catch (err) {
    console.error("Päivityksen tarkistus epäonnistui:", err.message);
    set({ state: "error", error: String(err.message || err) });
  } finally {
    checking = false;
  }
  return status;
}

function start() {
  if (!enabled()) return;
  setTimeout(check, 3000);
  setInterval(check, CHECK_EVERY_MS).unref();
}

module.exports = { start, check, getStatus: () => status };
