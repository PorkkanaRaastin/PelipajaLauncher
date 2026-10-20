// Tekee allekirjoitetun päivityspaketin valmiista Pelipajasta (ajetaan GitHub Actionsissa).
//
//   node scripts/make-update.js <sovelluskansio> <tulostekansio>
//
// Sovelluskansio on electron-builderin tekemä dist/win-unpacked/resources/app.
// Yksityinen allekirjoitusavain luetaan ympäristömuuttujasta PELIPAJA_SIGNING_KEY
// (GitHubissa: Settings → Secrets and variables → Actions). Avainta ei koskaan tallenneta projektiin.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const verify = require("../app/main/update-verify");

const [appDir, outDir] = process.argv.slice(2);
if (!appDir || !outDir) {
  console.error("Käyttö: node scripts/make-update.js <sovelluskansio> <tulostekansio>");
  process.exit(1);
}
const keyPem = process.env.PELIPAJA_SIGNING_KEY;
if (!keyPem) {
  console.error("PELIPAJA_SIGNING_KEY puuttuu (GitHubin salaisuus).");
  process.exit(1);
}

function walk(dir, base = "", out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
const electron = require("electron/package.json").version;
const files = {};
const data = {};
for (const rel of walk(appDir).sort()) {
  if (!verify.SAFE_PATH.test(rel)) throw new Error("Tiedostonimi ei kelpaa päivitykseen: " + rel);
  const buf = fs.readFileSync(path.join(appDir, ...rel.split("/")));
  files[rel] = verify.sha256(buf);
  data[rel] = buf.toString("base64");
}

const manifestText = JSON.stringify({ version: pkg.version, electron, created: new Date().toISOString(), files });
const sig = crypto.sign(null, Buffer.from(manifestText, "utf8"), crypto.createPrivateKey(keyPem)).toString("base64");
const bundle = zlib.gzipSync(Buffer.from(JSON.stringify({ manifest: manifestText, sig, data })), { level: 9 });

// Varmistus: paketti aukeaa Pelipajan omalla tarkistuksella (julkinen avain täsmää)
verify.openBundle(bundle);

const file = `pelipaja-${pkg.version}.update`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, file), bundle);
fs.writeFileSync(
  path.join(outDir, "latest.json"),
  JSON.stringify({ version: pkg.version, electron, file, sha256: verify.sha256(bundle), size: bundle.length }, null, 2)
);
console.log(`Päivityspaketti ${file}: ${Object.keys(files).length} tiedostoa, ${(bundle.length / 1048576).toFixed(1)} Mt`);
