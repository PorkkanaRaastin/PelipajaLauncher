// Pelipaja – salattu tallennus koneelle
//
// Tiedostot salataan Windowsin omalla salauksella (safeStorage / DPAPI): ne aukeavat vain
// tällä koneella ja tällä Windows-käyttäjällä. Vanhat salaamattomat tiedostot luetaan
// ja salataan seuraavalla tallennuksella.
const { app, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

function seal(obj) {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return "PPJ1:" + safeStorage.encryptString(json).toString("base64");
  return "PPJ0:" + Buffer.from(json).toString("base64");
}

function unseal(text) {
  const t = String(text).trim();
  if (t.startsWith("PPJ1:")) return JSON.parse(safeStorage.decryptString(Buffer.from(t.slice(5), "base64")));
  if (t.startsWith("PPJ0:")) return JSON.parse(Buffer.from(t.slice(5), "base64").toString());
  return JSON.parse(t); // vanha salaamaton tiedosto
}

function readSealed(file, fallback) {
  try {
    return unseal(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

// Kirjoitus ensin väliaikaiseen tiedostoon ja sitten vaihto: tiedosto ei mene rikki,
// vaikka kone sammuisi kesken tallennuksen.
function writeSealed(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + ".tmp", seal(data), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}

const dataDir = () => app.getPath("userData");

// Jokaisella käyttäjällä on oma kansio: userData/users/<id>/
// Tunnus tarkistetaan, ettei kansiopolkua voi ohjata muualle (esim. "../").
function userFile(user, name) {
  if (!user || !SAFE_ID.test(String(user.id))) return null;
  return path.join(dataDir(), "users", String(user.id), name);
}

function readUserJson(user, name, fallback) {
  const f = userFile(user, name);
  return f ? readSealed(f, fallback) : fallback;
}

function writeUserJson(user, name, data) {
  const f = userFile(user, name);
  if (f) writeSealed(f, data);
}

// Kaikki tiedot ovat kansiossa %APPDATA%/pelipaja, sekä npm start -versiolla että .exe:llä,
// jotta tilit, peliajat ja tallennukset säilyvät päivityksissä.
function setupDataDir() {
  const appData = app.getPath("appData");
  const dir = path.join(appData, "pelipaja");
  const old = path.join(appData, "rr-launcher"); // RR Launcherin aikainen kansio siirretään
  try {
    if (!fs.existsSync(dir) && fs.existsSync(old)) fs.renameSync(old, dir);
  } catch (err) {
    console.error("Moving the old data folder failed:", err.message);
  }
  app.setPath("userData", dir);
}

module.exports = { SAFE_ID, seal, unseal, readSealed, writeSealed, dataDir, userFile, readUserJson, writeUserJson, setupDataDir };
