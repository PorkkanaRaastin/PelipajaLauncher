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
  if (typeof manifestText !== "string" || typeof sig !== "string") throw new Error("manifest puuttuu");
  const ok = crypto.verify(null, Buffer.from(manifestText, "utf8"), PUBLIC_KEY, Buffer.from(sig, "base64"));
  if (!ok) throw new Error("allekirjoitus ei täsmää");
  const m = JSON.parse(manifestText);
  if (!VERSION.test(m.version) || typeof m.electron !== "string" || !m.files || typeof m.files !== "object") throw new Error("virheellinen manifest");
  for (const [p, h] of Object.entries(m.files)) {
    if (!SAFE_PATH.test(p) || !/^[a-f0-9]{64}$/.test(h)) throw new Error("virheellinen tiedosto manifestissa: " + p);
  }
  if (!m.files["package.json"] || !m.files["app/main/index.js"]) throw new Error("paketista puuttuu sovellus");
  return m;
}

// Purkaa ja tarkistaa ladatun paketin. Palauttaa { manifest, manifestText, sig, data }
function openBundle(buf) {
  if (!Buffer.isBuffer(buf) || buf.length > MAX_BUNDLE) throw new Error("paketti on liian suuri");
  const raw = JSON.parse(zlib.gunzipSync(buf, { maxOutputLength: MAX_BUNDLE * 2 }).toString("utf8"));
  const manifest = readManifest(raw.manifest, raw.sig);
  const data = raw.data || {};
  const names = Object.keys(manifest.files);
  if (Object.keys(data).length !== names.length) throw new Error("tiedostojen määrä ei täsmää");
  for (const p of names) {
    if (typeof data[p] !== "string") throw new Error("tiedosto puuttuu: " + p);
    if (sha256(Buffer.from(data[p], "base64")) !== manifest.files[p]) throw new Error("tarkistussumma ei täsmää: " + p);
  }
  return { manifest, manifestText: raw.manifest, sig: raw.sig, data };
}

// Asentaa paketin kansioon updates/<versio>. Ensin väliaikaiseen kansioon, sitten vaihto.
function installBundle(buf, updatesDir) {
  const b = openBundle(buf);
  const target = path.join(updatesDir, b.manifest.version);
  const tmp = target + ".tmp-" + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [p, b64] of Object.entries(b.data)) {
    const f = path.join(tmp, ...p.split("/"));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
  }
  fs.writeFileSync(path.join(tmp, "pelipaja-manifest.json"), JSON.stringify({ manifest: b.manifestText, sig: b.sig }));
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  try {
    fs.rmSync(path.join(updatesDir, b.manifest.version + ".bad"), { force: true });
  } catch {}
  return b.manifest;
}

// Tarkistaa asennetun version kaikki tiedostot. Palauttaa manifestin tai heittää virheen.
function verifyInstalled(dir) {
  const { manifest: text, sig } = JSON.parse(fs.readFileSync(path.join(dir, "pelipaja-manifest.json"), "utf8"));
  const m = readManifest(text, sig);
  if (path.basename(dir) !== m.version) throw new Error("kansion nimi ei täsmää versioon");
  for (const [p, h] of Object.entries(m.files)) {
    if (sha256(fs.readFileSync(path.join(dir, ...p.split("/")))) !== h) throw new Error("tiedostoa on muokattu: " + p);
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
      console.error(`Päivitys ${v} hylätty: ${err.message}`);
    }
  }
  return null;
}

// Poistaa vanhat versiot, jättää uusimmat kaksi
function cleanup(updatesDir, keep = 2) {
  let names = [];
  try {
    names = fs.readdirSync(updatesDir);
  } catch {
    return;
  }
  const versions = names.filter((n) => VERSION.test(n)).sort((a, b) => compareVersions(b, a));
  for (const v of versions.slice(keep)) fs.rmSync(path.join(updatesDir, v), { recursive: true, force: true });
  for (const n of names.filter((n) => n.includes(".tmp-"))) fs.rmSync(path.join(updatesDir, n), { recursive: true, force: true });
}

module.exports = { compareVersions, electronMajor, readManifest, openBundle, installBundle, verifyInstalled, bestInstalled, cleanup, sha256, SAFE_PATH };
