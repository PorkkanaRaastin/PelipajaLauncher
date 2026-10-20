// Pelipaja – peliajat, käynnistykset ja viimeksi pelattu
//
// Pilvi on totuus. Koneelle pidetään salattu välimuisti (stats.json) ja jono (pending.json)
// tapahtumista, joita ei vielä ole saatu lähetettyä (esim. ilman nettiä).
const crypto = require("crypto");
const state = require("./state");
const { readUserJson, writeUserJson } = require("./storage");

// Palvelin hyväksyy enintään 24 h peliaikaa yhdellä kutsulla, joten isot erät lähetetään paloina.
const CHUNK_MS = 12 * 60 * 60 * 1000;
const currentUser = () => state.session && state.session.user;

function readStats(user = currentUser()) {
  const cache = readUserJson(user, "stats.json", {});
  const pend = readUserJson(user, "pending.json", []);
  const out = JSON.parse(JSON.stringify(cache));
  for (const e of pend) {
    const s = (out[e.game] = out[e.game] || { playtimeMs: 0, launches: 0, lastPlayed: null });
    s.playtimeMs += e.ms;
    s.launches += e.launches;
    s.lastPlayed = Math.max(s.lastPlayed || 0, e.at || 0) || null;
  }
  return out;
}

function sendStats() {
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) win.webContents.send("stats-changed", readStats());
}

function queuePlay(user, game, ms, launches) {
  if (!user) return;
  const pend = readUserJson(user, "pending.json", []);
  pend.push({ id: crypto.randomUUID(), game, ms: Math.max(0, Math.round(ms)), launches, at: Date.now() });
  writeUserJson(user, "pending.json", pend);
  flushStats(user);
}
const addPlaytime = (user, game, ms) => queuePlay(user, game, ms, 0);
const countLaunch = (user, game) => queuePlay(user, game, 0, 1);

let flushing = false;
async function flushStats(user = currentUser()) {
  const cur = currentUser();
  if (!user || flushing || !cur || cur.id !== user.id) return;
  flushing = true;
  try {
    // yhdistetään saman pelin tapahtumat; muistetaan mitkä tapahtumat lähetettiin,
    // jotta lähetyksen aikana jonoon tulleet eivät katoa
    const sum = {};
    for (const e of readUserJson(user, "pending.json", [])) {
      const t = (sum[e.game] = sum[e.game] || { ms: 0, launches: 0, ids: new Set() });
      t.ms += e.ms;
      t.launches += e.launches;
      t.ids.add(e.id || `${e.game}:${e.at}:${e.ms}:${e.launches}`);
    }
    for (const [game, t] of Object.entries(sum)) {
      let ms = t.ms;
      let launches = t.launches;
      try {
        do {
          const part = Math.min(ms, CHUNK_MS);
          await state.cloud.recordPlay(game, part, launches);
          // jonosta pois lähetetyt, loput jäävät odottamaan
          const pend = readUserJson(user, "pending.json", []).filter((e) => !t.ids.has(e.id || `${e.game}:${e.at}:${e.ms}:${e.launches}`));
          const rest = ms - part;
          if (rest > 0) {
            const id = crypto.randomUUID();
            pend.push({ id, game, ms: rest, launches: 0, at: Date.now() });
            t.ids = new Set([id]);
          }
          writeUserJson(user, "pending.json", pend);
          const cache = readUserJson(user, "stats.json", {});
          const c = (cache[game] = cache[game] || { playtimeMs: 0, launches: 0, lastPlayed: null });
          c.playtimeMs += part;
          c.launches += launches;
          c.lastPlayed = Date.now();
          writeUserJson(user, "stats.json", cache);
          ms = rest;
          launches = 0;
        } while (ms > 0);
      } catch {
        break; // ei nettiä: yritetään myöhemmin uudelleen
      }
    }
  } finally {
    flushing = false;
  }
}

async function refreshStats() {
  const user = currentUser();
  if (!user) return;
  try {
    await flushStats(user);
    const fresh = await state.cloud.fetchStats();
    writeUserJson(user, "stats.json", fresh);
  } catch {}
  const now = currentUser();
  if (now && now.id === user.id) sendStats();
}

// jonossa olevat lähetetään, kun netti palaa
setInterval(() => currentUser() && flushStats(), 60 * 1000).unref();

module.exports = { readStats, sendStats, addPlaytime, countLaunch, flushStats, refreshStats };
