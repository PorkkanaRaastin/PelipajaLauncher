// Pelipaja – pelilistan (games/games.json) lukeminen ja tarkistus
//
// Jokainen kenttä tarkistetaan: tuntemattomat kentät jätetään pois, polkujen pitää osoittaa
// games-kansion sisälle ja nettipelien osoitteiden pitää olla https-osoitteita.
// Tällä tiedostolla ei ole Electron-riippuvuuksia, joten sitä voi käyttää myös testeissä.
const path = require("path");
const fs = require("fs");

const GAME_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right", "top-center"];
const TYPES = ["html", "url"];
const CATEGORIES = ["peli", "minipeli"];
const IMAGE = /\.(png|jpe?g|webp|svg|gif)$/i;

function isInside(root, target) {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v, n, max) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).map((x) => x.trim().slice(0, max)) : []);

function checkGame(raw, gamesDir) {
  if (!raw || typeof raw !== "object") throw new Error("peli ei ole objekti");
  const id = String(raw.id || "");
  if (!GAME_ID.test(id)) throw new Error(`virheellinen id "${id}" (pienet kirjaimet, numerot, - ja _)`);
  const name = text(raw.name, 60);
  if (!name) throw new Error(`${id}: nimi puuttuu`);
  const type = raw.type || "html";
  if (!TYPES.includes(type)) throw new Error(`${id}: tuntematon tyyppi "${type}" (sallitut: ${TYPES.join(", ")})`);

  const game = {
    id,
    name,
    type,
    version: text(raw.version, 20),
    description: text(raw.description, 600),
    tags: list(raw.tags, 8, 24),
    updates: list(raw.updates, 20, 200),
    endButton: CORNERS.includes(raw.endButton) ? raw.endButton : "top-left",
    fullscreen: raw.fullscreen === true,
    color: /^#[0-9a-f]{3,8}$/i.test(raw.color || "") ? raw.color : null,
    // "peli" näkyy etusivulla ja kirjastossa, "minipeli" Minipelit-välilehdellä
    category: CATEGORIES.includes(raw.category) ? raw.category : "peli",
    players: raw.players === 2 ? 2 : 1,
    // true = peli saa käyttää mikrofonia (äänichat). Kamera pysyy estettynä.
    voice: raw.voice === true,
    controls: text(raw.controls, 60),
    // esim. "Early access": näkyy oranssina merkkinä kortissa ja pelin sivulla
    status: text(raw.status, 30),
  };

  if (type === "html") {
    const target = path.resolve(gamesDir, String(raw.path || ""));
    if (!isInside(gamesDir, target) || !/\.html?$/i.test(target)) throw new Error(`${id}: polun pitää olla .html-tiedosto games-kansion sisällä`);
    game.target = target;
  } else {
    let u;
    try {
      u = new URL(String(raw.path || ""));
    } catch {
      throw new Error(`${id}: virheellinen osoite`);
    }
    if (u.protocol !== "https:") throw new Error(`${id}: nettipelin osoitteen pitää alkaa https://`);
    game.target = u.href;
  }

  if (raw.cover) {
    const cover = path.resolve(gamesDir, String(raw.cover));
    if (isInside(gamesDir, cover) && IMAGE.test(cover)) game.coverPath = cover;
  }
  return game;
}

// Palauttaa { games, errors }. Virheellinen peli jätetään pois, muut toimivat silti.
function loadCatalog(gamesFile, gamesDir = path.dirname(gamesFile)) {
  const raw = JSON.parse(fs.readFileSync(gamesFile, "utf8"));
  const games = [];
  const errors = [];
  const seen = new Set();
  for (const g of Array.isArray(raw.games) ? raw.games : []) {
    try {
      const game = checkGame(g, gamesDir);
      if (seen.has(game.id)) throw new Error(`${game.id}: sama id kahdesti`);
      seen.add(game.id);
      games.push(game);
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { games, errors };
}

module.exports = { GAME_ID, CORNERS, isInside, checkGame, loadCatalog };
