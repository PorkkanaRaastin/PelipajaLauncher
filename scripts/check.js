// Pelipajan tarkistus: npm test (ajetaan myös automaattisesti ennen npm run dist)
//
// 1. Kaikki JavaScript-tiedostot ovat kelvollisia
// 2. games.json on kunnossa ja jokaisen pelin tiedostot löytyvät
// 3. Projektissa ei ole salaisia avaimia (ettei niitä vahingossa päädy GitHubiin)
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { loadCatalog } = require("../app/main/catalog");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", "dist", ".git"]);
let failed = 0;
const fail = (msg) => {
  failed++;
  console.error("  ✗ " + msg);
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(ROOT);
const rel = (p) => path.relative(ROOT, p);

// 1. JavaScript
for (const f of files.filter((f) => f.endsWith(".js") && !f.includes(`${path.sep}_shared${path.sep}`))) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    fail(`${rel(f)}: ${String(err.stderr).split("\n").slice(0, 5).join(" ")}`);
  }
}

// 2. Pelit
const gamesDir = path.join(ROOT, "games");
const { games, errors } = loadCatalog(path.join(gamesDir, "games.json"), gamesDir);
errors.forEach((e) => fail("games.json: " + e));
for (const g of games) {
  if (g.type === "html" && !fs.existsSync(g.target)) fail(`${g.id}: tiedostoa ${rel(g.target)} ei ole`);
  if (g.coverPath && !fs.existsSync(g.coverPath)) fail(`${g.id}: kansikuvaa ${rel(g.coverPath)} ei ole`);
  if (g.type === "html") {
    const html = fs.readFileSync(g.target, "utf8");
    if (!/<meta[^>]+charset/i.test(html)) fail(`${g.id}: <meta charset="utf-8"> puuttuu`);
    if (!/rrSaveGame|_mini\.js/.test(html)) console.warn(`  ! ${g.id}: ei window.rrSaveGame-funktiota (Save & End Game ei tallenna)`);
  }
}

// 3. Salaisuudet: Supabasen salainen/service_role-avain, Brevon API- ja SMTP-avaimet, yksityiset avaimet
const SECRET = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "Supabasen salainen avain"],
  [/xkeysib-[a-f0-9]{20,}/i, "Brevon API-avain"],
  [/xsmtpsib-[a-f0-9]{20,}/i, "Brevon SMTP-avain"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "yksityinen avain"],
  [/"role"\s*:\s*"service_role"|service_role["']?\s*[:=]\s*["']ey/, "Supabasen service_role-avain"],
];
for (const f of files) {
  if (/\.(png|jpe?g|gif|webp|ico|zip|exe)$/i.test(f) || f.endsWith("check.js")) continue;
  const txt = fs.readFileSync(f, "utf8");
  for (const [re, what] of SECRET) if (re.test(txt)) fail(`${rel(f)}: sisältää ${what}! Poista se ennen GitHubiin laittamista.`);
}
if (fs.existsSync(path.join(ROOT, ".env"))) fail(".env-tiedosto projektissa: älä laita sitä GitHubiin");

if (failed) {
  console.error(`\nTarkistus epäonnistui (${failed} virhettä).`);
  process.exit(1);
}
console.log(`Tarkistus ok: ${games.length} peliä, ${files.length} tiedostoa, ei salaisia avaimia.`);
