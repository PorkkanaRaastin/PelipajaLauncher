// Pelipaja – päivityspakettien tarkistus ja asennus
//
// Päivitys on yksi tiedosto (pelipaja-<versio>.update), joka sisältää:
//   manifest  tekstinä: { version, electron, files: { polku: sha256 } }
//   sig       Ed25519-allekirjoitus manifestista (yksityinen avain on vain GitHubin salaisuuksissa)
//   data      { polku: tiedoston sisältö base64:nä }
//
// Pelipaja hyväksyy paketin vain, jos allekirjoitus täsmää alla olevaan julkiseen avaimeen
// ja jokaisen tiedoston tarkistussumma täsmää. Asennettu versio tarkistetaan uudelleen
// jokaisella käynnistyksellä, joten koneelle asennettuja päivitystiedostoja ei voi muokata.
//
// Tällä tiedostolla ei ole Electron-riippuvuuksia.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PUBLIC_KEY = crypto.createPublicKey({
  key: Buffer.from("MCowBQYDK2VwAyEApWsEp+zjI9abV84XtlKUv93ANSxIY6B4i4bNNkBwn04=", "base64"),
  format: "der",
  type: "spki",
});

const MAX_BUNDLE = 80 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9@._ +\-]+(?:\/[A-Za-z0-9@._ +\-]+)*$/;

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}
const electronMajor = (v) => String(v).split(".")[0];

// Tarkistaa allekirjoituksen ja palauttaa manifestin
function readManifest(manifestText, sig) {
  if (typeof manifestText !== "string" || typeof sig !== "string") throw new Error("manifest missing");
  const ok = crypto.verify(null, Buffer.from(manifestText, "utf8"), PUBLIC_KEY, Buffer.from(sig, "base64"));
  if (!ok) throw new Error("signature doesn't match");
  const m = JSON.parse(manifestText);
  if (!VERSION.test(m.version) || typeof m.electron !== "string" || !m.files || typeof m.files !== "object") throw new Error("invalid manifest");
  for (const [p, h] of Object.entries(m.files)) {
    if (!SAFE_PATH.test(p) || !/^[a-f0-9]{64}$/.test(h)) throw new Error("invalid file in manifest: " + p);
  }
  if (!m.files["package.json"] || !m.files["app/main/index.js"]) throw new Error("bundle is missing the app");
  return m;
}

// Purkaa ja tarkistaa ladatun paketin. Palauttaa { manifest, manifestText, sig, data }
function openBundle(buf) {
  if (!Buffer.isBuffer(buf) || buf.length > MAX_BUNDLE) throw new Error("bundle too large");
  const raw = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: MAX_BUNDLE * 2 }).toString("utf8"));
  const manifest = readManifest(raw.manifest, raw.sig);
  const data = raw.data || {};
  const names = Object.keys(manifest.files);
  if (Object.keys(data).length !== names.length) throw new Error("file count doesn't match");
  for (const p of names) {
    if (typeof data[p] !== "string") throw new Error("file missing: " + p);
    if (sha256(Buffer.from(data[p], "base64")) !== manifest.files[p]) throw new Error("checksum doesn't match: " + p);
  }
  return { manifest, manifestText: raw.manifest, sig: raw.sig, data };
}

// Windowsissa virustorjunta tai hakemisto pitää usein uusia tiedostoja hetken auki, jolloin
// kansion siirto/poisto epäonnistuu (EPERM/EBUSY). Yritetään uudelleen pienin tauoin.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (i >= tries - 1 || !/EPERM|EBUSY|EACCES|ENOTEMPTY|EEXIST/.test(err.code || err.message)) throw err;
      await sleep(150 * (i + 1));
    }
  }
}

// Asentaa paketin kansioon updates/<versio>. Ensin väliaikaiseen kansioon, sitten vaihto.
// Jos vaihto ei onnistu, tiedostot kopioidaan suoraan paikalleen (käynnistys tarkistaa ne joka tapauksessa).
async function installBundle(buf, updatesDir) {
  const b = openBundle(buf);
  const target = path.join(updatesDir, b.manifest.version);
  const tmp = target + ".tmp-" + process.pid + "-" + Date.now();
  fs.mkdirSync(updatesDir, { recursive: true });
  for (const [p, b64] of Object.entries(b.data)) {
    const f = path.join(tmp, ...p.split("/"));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
  }
  fs.writeFileSync(path.join(tmp, "pelipaja-manifest.json"), JSON.stringify({ manifest: b.manifestText, sig: b.sig }));
  try {
    await retry(() => fs.rmSync(target, { recursive: true, force: true }));
    await retry(() => fs.renameSync(tmp, target));
  } catch (err) {
    // varasuunnitelma: kopioidaan päälle, manifesti viimeisenä
    const mf = path.join(target, "pelipaja-manifest.json");
    try { fs.rmSync(mf, { force: true }); } catch {}
    await retry(() => fs.cpSync(tmp, target, { recursive: true, force: true, filter: (src) => path.basename(src) !== "pelipaja-manifest.json" || path.dirname(src) !== tmp }));
    await retry(() => fs.copyFileSync(path.join(tmp, "pelipaja-manifest.json"), mf));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  try {
    fs.rmSync(path.join(updatesDir, b.manifest.version + ".bad"), { force: true });
  } catch {}
  return b.manifest;
}

// Tarkistaa asennetun version kaikki tiedostot. Palauttaa manifestin tai heittää virheen.
function verifyInstalled(dir) {
  const { manifest: text, sig } = JSON.parse(fs.readFileSync(path.join(dir, "pelipaja-manifest.json"), "utf8"));
  const m = readManifest(text, sig);
  if (path.basename(dir) !== m.version) throw new Error("folder name doesn't match version");
  for (const [p, h] of Object.entries(m.files)) {
    if (sha256(fs.readFileSync(path.join(dir, ...p.split("/")))) !== h) throw new Error("file has been modified: " + p);
  }
  return m;
}

// Uusin asennettu, ehjä ja tähän exeen sopiva versio, joka on uudempi kuin exen oma
function bestInstalled(updatesDir, ownVersion, electronVersion) {
  let names = [];
  try {
    names = fs.readdirSync(updatesDir).filter((n) => VERSION.test(n));
  } catch {
    return null;
  }
  names.sort((a, b) => compareVersions(b, a));
  for (const v of names) {
    if (compareVersions(v, ownVersion) <= 0) break;
    if (fs.existsSync(path.join(updatesDir, v + ".bad"))) continue;
    const dir = path.join(updatesDir, v);
    try {
      const m = verifyInstalled(dir);
      if (electronMajor(m.electron) !== electronMajor(electronVersion)) continue;
      return { version: v, root: dir };
    } catch (err) {
      console.error(`Update ${v} rejected: ${err.message}`);
    }
  }
  return null;
}

// Poistaa vanhat versiot, jättää uusimmat kaksi. Käynnissä olevaa versiota (keepAlso) ei poisteta.
// Epäonnistunut poisto ei haittaa: yritetään uudelleen seuraavalla kerralla.
function cleanup(updatesDir, keep = 2, keepAlso = []) {
  let names = [];
  try {
    names = fs.readdirSync(updatesDir);
  } catch {
    return;
  }
  const rm = (n) => {
    try {
      fs.rmSync(path.join(updatesDir, n), { recursive: true, force: true });
    } catch {}
  };
  const versions = names.filter((n) => VERSION.test(n)).sort((a, b) => compareVersions(b, a));
  for (const v of versions.slice(keep)) if (!keepAlso.includes(v)) rm(v);
  // keskeneräiset asennukset (vanhemmat kuin 10 min, ettei poisteta juuri käynnissä olevaa)
  for (const n of names.filter((n) => n.includes(".tmp-"))) {
    try {
      if (Date.now() - fs.statSync(path.join(updatesDir, n)).mtimeMs > 10 * 60 * 1000) rm(n);
    } catch {}
  }
}

module.exports = { compareVersions, electronMajor, readManifest, openBundle, installBundle, verifyInstalled, bestInstalled, cleanup, sha256, SAFE_PATH };
