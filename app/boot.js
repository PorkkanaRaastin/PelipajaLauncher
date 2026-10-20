// Pelipaja – käynnistys
//
// Valmiissa versiossa tarkistetaan ensin, onko GitHubista ladattu uudempi, allekirjoitettu
// versio (%APPDATA%/pelipaja/updates/<versio>). Jos on ja se on ehjä, käynnistetään se.
// Muuten käynnistetään exen mukana tullut versio.
// Tätä tiedostoa ei päivitetä: se tulee aina exen mukana.
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

function startUpdated() {
  if (!app.isPackaged) return false;
  const verify = require("./main/update-verify");
  const updatesDir = path.join(app.getPath("appData"), "pelipaja", "updates");
  const own = require("../package.json").version;
  const best = verify.bestInstalled(updatesDir, own, process.versions.electron);
  if (!best) return false;
  try {
    process.env.PELIPAJA_BUILTIN_VERSION = own;
    require(path.join(best.root, "app", "main", "index.js"));
    return true;
  } catch (err) {
    // Rikkinäinen päivitys: merkitään huonoksi ja käynnistetään uudelleen exen omalla versiolla
    console.error(`Update ${best.version} failed to start:`, err);
    try {
      fs.writeFileSync(path.join(updatesDir, best.version + ".bad"), String(err && err.stack));
    } catch {}
    app.relaunch();
    app.exit(0);
    return true;
  }
}

if (!startUpdated()) require("./main/index.js");
