// Kokoaa "Mitä uutta" -tiedot commit-viesteistä (ajetaan GitHub Actionsissa ennen päivityspaketin tekoa).
//
//   node scripts/make-notes.js <sovelluskansio> <julkaisutiedot.md>
//
// - muutokset: kaikki commit-viestit edellisen julkaisun (v*-tagin) jälkeen
//   (GitHubin oletusviestit, kuten "Add files via upload", jätetään pois)
// - uudet pelit: games.json-pelit, joita edellisessä julkaisussa ei ollut
// - päivityshistoria: jokaisen v*-tagin muutokset (commit-viestit) ja uudet pelit
// Tulos: <sovelluskansio>/whats-new.json ja update-history.json (menevät allekirjoitettuun pakettiin)
// sekä julkaisun kuvaus.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const [appDir, mdOut] = process.argv.slice(2);
if (!appDir) {
  console.error("Käyttö: node scripts/make-notes.js <sovelluskansio> [julkaisutiedot.md]");
  process.exit(1);
}
const sh = (c) => {
  try {
    return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

// GitHub Actions hakee oletuksena vain viimeisimmän commitin. Haetaan koko historia ja tagit,
// jotta "edellisen julkaisun jälkeen" voidaan laskea.
if (sh("git rev-parse --is-shallow-repository") === "true") sh("git fetch --quiet --unshallow --tags");
else if (!sh("git tag --list v*")) sh("git fetch --quiet --tags");

const version = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;
const prev = sh("git tag --list \"v*\" --sort=-v:refname").split("\n").filter(Boolean)[0] || "";
const raw = sh(`git log ${prev ? prev + "..HEAD" : "-n 20"} --no-merges --format=%B%x1e`);

const IGNORE = [
  /^add files via upload$/i,
  /^(update|create|delete|add|rename|upload) \S+$/i, // GitHubin automaattiset "Update README.md"
  /^add github actions workflow/i,
  /^pelipaja\s*v?\d+(\.\d+)*\.?$/i, // pelkkä versionumero
  /^merge /i,
  /^initial commit$/i,
  /^(co-authored-by|signed-off-by|claude-session):/i,
];
function parseNotes(text) {
  const out = [];
  for (const msg of text.split("\x1e")) {
    for (let line of msg.split("\n")) {
      line = line.replace(/^\s*[-*•]\s*/, "").trim();
      if (!line || line.length < 3 || IGNORE.some((re) => re.test(line))) continue;
      if (!out.includes(line)) out.push(line.slice(0, 200));
    }
  }
  return out;
}
const notes = parseNotes(raw);

const ids = (json) => {
  try {
    return (JSON.parse(json).games || []).map((g) => g.id);
  } catch {
    return [];
  }
};
const now = ids(fs.readFileSync(path.join(appDir, "games", "games.json"), "utf8"));
const before = prev ? ids(sh(`git show ${prev}:games/games.json`)) : now;
const newGames = now.filter((id) => !before.includes(id));

const out = { version, date: new Date().toISOString().slice(0, 10), notes: notes.slice(0, 15), newGames };
fs.writeFileSync(path.join(appDir, "whats-new.json"), JSON.stringify(out, null, 2));

// päivityshistoria kaikista julkaisuista (uusin ensin)
const gamesAt = (ref) => {
  try {
    return (JSON.parse(ref ? sh(`git show ${ref}:games/games.json`) : fs.readFileSync(path.join(appDir, "games", "games.json"), "utf8")).games || []).map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return [];
  }
};
const nowName = new Map(gamesAt(null).map((g) => [g.id, g.name]));
const tags = sh("git tag --list \"v*\" --sort=v:refname").split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t));
const history = [];
let prevTag = "";
for (const tag of tags) {
  const v = tag.slice(1);
  if (v === version) continue;
  const log = sh(`git log ${prevTag ? prevTag + ".." + tag : tag + " -n 20"} --no-merges --format=%B%x1e`);
  const before = prevTag ? gamesAt(prevTag).map((g) => g.id) : null;
  const added = before ? gamesAt(tag).filter((g) => !before.includes(g.id)).map((g) => nowName.get(g.id) || g.name) : [];
  history.push({ version: v, date: sh(`git log -1 --format=%cs ${tag}`), notes: parseNotes(log).slice(0, 20), newGames: added });
  prevTag = tag;
}
const curNames = gamesAt(null).filter((g) => newGames.includes(g.id)).map((g) => g.name);
history.push({ version, date: out.date, notes: notes.slice(0, 20), newGames: curNames });
history.reverse();
fs.writeFileSync(path.join(appDir, "update-history.json"), JSON.stringify({ releases: history.slice(0, 200) }, null, 1));

if (mdOut) {
  const names = JSON.parse(fs.readFileSync(path.join(appDir, "games", "games.json"), "utf8")).games.filter((g) => newGames.includes(g.id)).map((g) => g.name);
  const md = [
    `Download **Pelipaja-Windows.zip**, extract it and run Pelipaja.exe. If you already have Pelipaja 1.2 or newer, it updates itself.`,
    "",
    "### What's new",
    ...(notes.length ? notes.slice(0, 15).map((n) => "- " + n) : ["- Small fixes and improvements"]),
    ...(names.length ? ["", "### New games", ...names.map((n) => "- " + n)] : []),
  ].join("\n");
  fs.writeFileSync(mdOut, md);
}
console.log(`Päivityshistoria: ${history.length} versiota`);
console.log(`Mitä uutta ${version}: ${notes.length} muutosta, uudet pelit: ${newGames.join(", ") || "-"} (edellinen julkaisu ${prev || "-"})`);
