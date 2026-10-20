// Pelipaja – "What's new" -ikkuna ja NEW-merkit
//
// Julkaisun mukana tulee whats-new.json (scripts/make-notes.js kokoaa sen commit-viesteistä).
// Kun Pelipaja käynnistyy ensimmäistä kertaa uudella versiolla, käyttöliittymä näyttää
// muutokset ja merkitsee uudet pelit UUSI-merkillä. Seuraavalla käynnistyksellä niitä ei enää näytetä.
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { ROOT, APP_VERSION } = require("./paths");
const { compareVersions } = require("./update-verify");
const { readSealed, writeSealed } = require("./storage");

let result;

function builtinVersion() {
  try {
    if (!app.isPackaged) return null;
    return JSON.parse(fs.readFileSync(path.join(process.resourcesPath, "app", "package.json"), "utf8")).version;
  } catch {
    return null;
  }
}

// Lasketaan kerran käynnistyksessä
function compute() {
  if (result !== undefined) return result;
  result = null;
  const file = path.join(app.getPath("userData"), "launcher-state.dat");
  const st = readSealed(file, null);
  // Ensimmäinen kerta tällä ominaisuudella: verrataan exen mukana tulleeseen versioon
  // Ensimmäinen kerta tällä ominaisuudella: verrataan exen mukana tulleeseen versioon.
  // Vanhojen exejen boot.js ei aseta PELIPAJA_BUILTIN_VERSION-muuttujaa, joten luetaan se suoraan.
  const last = (st && st.lastVersion) || process.env.PELIPAJA_BUILTIN_VERSION || builtinVersion() || APP_VERSION;
  try {
    writeSealed(file, { lastVersion: APP_VERSION });
  } catch {}
  if (compareVersions(APP_VERSION, last) <= 0 && !process.env.PELIPAJA_FORCE_WHATSNEW) return result;
  let info = null;
  try {
    info = JSON.parse(fs.readFileSync(path.join(ROOT, "whats-new.json"), "utf8"));
  } catch {
    return result;
  }
  const clean = (a, n, max) => (Array.isArray(a) ? a.filter((x) => typeof x === "string").slice(0, n).map((x) => x.slice(0, max)) : []);
  result = {
    version: APP_VERSION,
    from: last,
    date: typeof info.date === "string" ? info.date.slice(0, 10) : "",
    notes: clean(info.notes, 15, 200),
    newGames: clean(info.newGames, 30, 48),
  };
  return result;
}

module.exports = { compute };
