// Pelipaja – käyttäjätilit (pilvessä, ks. cloud.js) ja vanhojen paikallisten tilien siirto
const path = require("path");
const state = require("./state");
const { readSealed, readUserJson, writeUserJson, dataDir, SAFE_ID } = require("./storage");
const stats = require("./stats");

// Vanhat paikalliset tilit (ennen pilveä). Samalla sähköpostilla pilveen kirjautuva
// perii vanhan tilin pelitallennukset ja peliajat (kerran).
function legacyUsers() {
  const db = readSealed(path.join(dataDir(), "accounts.json"), {}) || {};
  return (db.users || [])
    .filter((u) => u.password && u.verified !== false && SAFE_ID.test(String(u.id)))
    .map((u) => ({ id: u.id, email: u.email, partition: u.partition }));
}

function legacyStats(legacyId) {
  return (
    readSealed(path.join(dataDir(), "users", legacyId, "stats.json"), null) ||
    // ennen tilejä tallennetut peliajat (vanhin versio)
    readSealed(path.join(dataDir(), "stats.json"), {}) ||
    {}
  );
}

async function beginSession(user, entry) {
  state.session = { user, partition: entry.partition };
  if (entry.legacyId && !entry.migrated && SAFE_ID.test(String(entry.legacyId))) {
    const pend = readUserJson(user, "pending.json", []);
    for (const [game, st] of Object.entries(legacyStats(entry.legacyId))) {
      pend.push({ game, ms: st.playtimeMs || 0, launches: st.launches || 0, at: st.lastPlayed || Date.now() });
    }
    writeUserJson(user, "pending.json", pend);
    state.cloud.markMigrated(user.id);
  }
  stats.refreshStats();
  return publicUser();
}

function publicUser() {
  const s = state.session;
  return s ? { id: s.user.id, email: s.user.email, username: s.user.username, createdAt: s.user.createdAt } : null;
}

// Käyttöliittymältä tulevista tiedoista otetaan vain tunnetut kentät, tekstinä ja rajatun pituisina
function cleanArgs(a) {
  a = a && typeof a === "object" ? a : {};
  const s = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    username: s(a.username, 40),
    email: s(a.email, 254),
    code: s(a.code, 12),
    password: s(a.password, 200),
    login: s(a.login, 254),
    remember: a.remember !== false,
  };
}

async function restore() {
  const user = await state.cloud.restore();
  if (user) await beginSession(user, state.cloud.partitionFor(user, legacyUsers()));
}

const api = {
  status: () => ({ user: publicUser() }),
  start: (a) => state.cloud.start(cleanArgs(a)),
  resend: (a) => state.cloud.resend(cleanArgs(a)),
  verify: (a) => state.cloud.verifyCode(cleanArgs(a)),
  async setPassword(a) {
    const res = await state.cloud.setPassword({ ...cleanArgs(a), legacyUsers: legacyUsers() });
    return { ok: true, user: await beginSession(res.user, res.partition) };
  },
  async login(a) {
    const res = await state.cloud.login({ ...cleanArgs(a), legacyUsers: legacyUsers() });
    return { ok: true, user: await beginSession(res.user, res.partition) };
  },
  async logout() {
    await stats.flushStats().catch(() => {});
    state.session = null;
    return state.cloud.logout();
  },
};

module.exports = { restore, api };
