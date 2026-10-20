// Pelipaja – pilvitilit ja -tilastot (Supabase)
//
// Rekisteröinti: käyttäjänimi + sähköposti → Supabase lähettää 6-numeroisen koodin (Brevon kautta)
//                → koodi oikein → salasana → tili valmis.
// Kirjautuminen: sähköposti tai käyttäjänimi + salasana, millä tahansa koneella.
// Peliajat ja käynnistykset tallentuvat pilveen. Jos nettiä ei ole, ne jonotetaan ja lähetetään myöhemmin.
//
// Salasanat hashaa Supabase (bcrypt). Istunto tallennetaan tälle koneelle salattuna.
const fs = require("fs");
const path = require("path");

class CloudError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

const WEAK = ["12345678", "123456789", "1234567890", "salasana", "salasana1", "password", "password1", "qwertyui", "qwerty123", "11111111", "pelipaja", "pelipaja1"];
const RESEND_COOLDOWN_MS = 45 * 1000;
const CODE_MAX_TRIES = 5;
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 60 * 1000;

function validateUsername(name) {
  if (name.length < 3 || name.length > 20) throw new CloudError("Käyttäjänimessä pitää olla 3–20 merkkiä.", "username");
  if (!/^[A-Za-z0-9ÅÄÖåäö_-]+$/.test(name)) throw new CloudError("Käytä vain kirjaimia, numeroita, - ja _.", "username");
}
function validateEmail(email) {
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new CloudError("Tarkista sähköpostiosoite.", "email");
}
function validatePassword(pw, username, email) {
  if (pw.length < 8) throw new CloudError("Salasanassa pitää olla vähintään 8 merkkiä.", "password");
  if (pw.length > 72) throw new CloudError("Salasana on liian pitkä (enintään 72 merkkiä).", "password");
  const l = pw.toLowerCase();
  if (WEAK.includes(l)) throw new CloudError("Tämä salasana on liian helppo arvata.", "password");
  if (l === username.toLowerCase() || l === email || l === email.split("@")[0]) throw new CloudError("Salasana ei saa olla sama kuin käyttäjänimi tai sähköposti.", "password");
}

// Supabasen englanninkieliset virheet selkokielelle
function friendly(err, ctx) {
  const m = String((err && (err.message || err.error_description || err.msg)) || err || "");
  const code = (err && (err.code || err.error_code)) || "";
  if (/fetch failed|failed to fetch|network|ENOTFOUND|ECONN|EAI_AGAIN|timed? ?out|socket/i.test(m))
    return new CloudError("Ei yhteyttä Pelipajan palvelimeen. Tarkista nettiyhteys.");
  const sec = /after (\d+) seconds?/i.exec(m);
  if (sec) return new CloudError(`Odota ${sec[1]} s ennen uutta koodia.`);
  if (/rate limit|too many/i.test(m) || code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
    return new CloudError("Liian monta yritystä hetken sisällä. Odota hetki ja yritä uudelleen.");
  if (/sending .*email|smtp|confirmation email|magic link/i.test(m) || code === "unexpected_failure" && ctx === "send")
    return new CloudError("Koodin lähetys epäonnistui (palvelimen sähköpostiasetus). Yritä hetken päästä uudelleen.");
  if (/token has expired|otp_expired|invalid.*(otp|token)|token.*invalid/i.test(m) || code === "otp_expired")
    return new CloudError("Väärä tai vanhentunut koodi.", "code");
  if (/invalid login credentials/i.test(m) || code === "invalid_credentials") return new CloudError("Väärä käyttäjätunnus tai salasana.");
  if (/password should be|weak_password|password.*(short|characters)/i.test(m) || code === "weak_password")
    return new CloudError("Salasana ei kelpaa palvelimelle: käytä vähintään 8 merkkiä, kirjaimia ja numeroita.", "password");
  if (/same_password|should be different/i.test(m)) return new CloudError("Valitse eri salasana.", "password");
  if (/duplicate key|profiles_username_key|23505/i.test(m) || code === "23505") return new CloudError("Tämä käyttäjänimi ehti mennä toiselle. Valitse toinen nimi.", "username");
  if (/email.*(not confirmed|not_confirmed)/i.test(m)) return new CloudError("Sähköpostia ei ole vahvistettu. Luo tili uudelleen samalla sähköpostilla.");
  if (/function .* does not exist|PGRST202|relation .* does not exist|42P01|42883/i.test(m))
    return new CloudError("Pelipajan tietokantaa ei ole vielä asennettu (SQL-asetukset puuttuvat).");
  if (/signups not allowed|signup.*disabled/i.test(m)) return new CloudError("Uusien tilien luonti on poistettu käytöstä palvelimella.");
  return new CloudError(m || "Tuntematon virhe palvelimella.");
}

class NoSocket {
  constructor() {
    this.readyState = 3;
  }
  close() {}
  send() {}
}

function createCloud({ url, key, dataDir, seal, unseal, createClient, log = console.log }) {
  const SESSION_FILE = path.join(dataDir, "cloud-session.dat");
  const MAP_FILE = path.join(dataDir, "cloud-map.dat");
  const readSealed = (f, fb) => {
    try {
      return unseal(fs.readFileSync(f, "utf8"));
    } catch {
      return fb;
    }
  };
  const writeSealed = (f, data) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + ".tmp", seal(data));
    fs.renameSync(f + ".tmp", f);
  };

  // Istunto talteen salattuna. "Muista minut" pois → istunto vain muistissa.
  let mem = readSealed(SESSION_FILE, {}) || {};
  let remember = mem.__remember !== false;
  const persist = () => writeSealed(SESSION_FILE, remember ? mem : { __remember: false });
  const storage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => {
      mem[k] = v;
      persist();
    },
    removeItem: (k) => {
      delete mem[k];
      persist();
    },
  };
  const sb = createClient(url, key, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "implicit" },
    global: { headers: { "x-client-info": "pelipaja-launcher" } },
    // Pelipaja ei käytä reaaliaikaominaisuuksia. Electronin Node ei sisällä WebSocketia,
    // joten annetaan tyhjä toteutus, ettei kirjasto kaadu käynnistyessä.
    realtime: { transport: NoSocket },
  });

  let current = null;
  const pending = { email: "", username: "", sentAt: 0, tries: 0 };
  const fails = new Map(); // tunnus -> { n, until }

  const lower = (s) => String(s || "").trim().toLowerCase();
  const norm = (s) => String(s || "").trim();
  async function call(p, ctx) {
    let res;
    try {
      res = await p;
    } catch (err) {
      throw friendly(err, ctx);
    }
    if (res && res.error) throw friendly(res.error, ctx);
    return res ? res.data : undefined;
  }

  // Tallennustila (pelien omat tallennukset): vanha paikallinen tili samalla sähköpostilla
  // jatkaa samassa tallennustilassa, muut saavat oman.
  function partitionFor(user, legacyUsers) {
    const map = readSealed(MAP_FILE, {}) || {};
    if (map[user.id] && map[user.id].partition != null) return map[user.id];
    const legacy = (legacyUsers || []).find((u) => lower(u.email) === lower(user.email));
    let entry;
    if (legacy) entry = { partition: legacy.partition ?? `persist:user-${legacy.id}`, legacyId: legacy.id, migrated: false };
    else {
      const usedDefault = Object.values(map).some((e) => e.partition === "") || (legacyUsers || []).some((u) => u.partition === "");
      entry = { partition: usedDefault ? `persist:cloud-${user.id}` : "", legacyId: null, migrated: true };
    }
    map[user.id] = entry;
    writeSealed(MAP_FILE, map);
    return entry;
  }
  function markMigrated(userId) {
    const map = readSealed(MAP_FILE, {}) || {};
    if (map[userId]) map[userId].migrated = true;
    writeSealed(MAP_FILE, map);
  }

  async function loadUser(sessionUser) {
    let username = sessionUser.user_metadata && sessionUser.user_metadata.username;
    try {
      const prof = await call(sb.from("profiles").select("username, created_at").eq("id", sessionUser.id).maybeSingle());
      if (prof) username = prof.username;
      else if (!prof) return null; // rekisteröinti kesken (ei profiilia)
    } catch (err) {
      if (!/yhteyttä/.test(err.message)) throw err; // offline: käytetään istunnon tietoja
    }
    return { id: sessionUser.id, email: sessionUser.email, username: username || sessionUser.email.split("@")[0], createdAt: Date.parse(sessionUser.created_at) || Date.now() };
  }

  const api = {
    CloudError,
    current: () => current,
    client: sb,
    partitionFor,
    markMigrated,

    async restore() {
      let session = null;
      try {
        const { data } = await sb.auth.getSession();
        session = data && data.session;
      } catch {}
      if (!session) {
        // offline: käytetään tallennettua istuntoa sellaisenaan
        const raw = Object.entries(mem).find(([k]) => /auth-token$/.test(k));
        try {
          const parsed = raw && (typeof raw[1] === "string" ? JSON.parse(raw[1]) : raw[1]);
          if (parsed && parsed.user) session = parsed;
        } catch {}
      }
      if (!session || !session.user) return null;
      try {
        current = await loadUser(session.user);
      } catch {
        current = null;
      }
      return current;
    },

    // 1/3: käyttäjänimi + sähköposti → koodi
    async start({ username, email }) {
      username = norm(username);
      email = lower(email);
      validateUsername(username);
      validateEmail(email);
      const free = await call(sb.rpc("username_available", { p_username: username }));
      if (!free) throw new CloudError("Tämä käyttäjänimi on jo käytössä.", "username");
      const taken = await call(sb.rpc("email_registered", { p_email: email }));
      if (taken) throw new CloudError("Tällä sähköpostilla on jo tili. Kirjaudu sisään.", "email");
      if (pending.email === email && Date.now() - pending.sentAt < RESEND_COOLDOWN_MS) {
        pending.username = username;
        return { ok: true, email, reused: true };
      }
      await call(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { username } } }), "send");
      Object.assign(pending, { email, username, sentAt: Date.now(), tries: 0 });
      return { ok: true, email };
    },

    async resend({ email }) {
      email = lower(email);
      if (pending.email !== email) throw new CloudError("Aloita rekisteröinti alusta.");
      const wait = pending.sentAt + RESEND_COOLDOWN_MS - Date.now();
      if (wait > 0) throw new CloudError(`Odota ${Math.ceil(wait / 1000)} s ennen uutta koodia.`);
      await call(sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, data: { username: pending.username } } }), "send");
      Object.assign(pending, { sentAt: Date.now(), tries: 0 });
      return { ok: true };
    },

    // 2/3: koodi → istunto auki (salasana puuttuu vielä)
    async verifyCode({ email, code }) {
      email = lower(email);
      code = String(code || "").replace(/\D/g, "");
      if (code.length !== 6) throw new CloudError("Koodissa on 6 numeroa.", "code");
      if (pending.email !== email) throw new CloudError("Aloita rekisteröinti alusta.");
      if (pending.tries >= CODE_MAX_TRIES) throw new CloudError("Liian monta väärää yritystä. Pyydä uusi koodi.", "code");
      try {
        await call(sb.auth.verifyOtp({ email, token: code, type: "email" }));
      } catch (err) {
        if (err.field === "code") {
          pending.tries++;
          const left = CODE_MAX_TRIES - pending.tries;
          throw new CloudError(left > 0 ? `Väärä tai vanhentunut koodi. Yrityksiä jäljellä ${left}.` : "Liian monta väärää yritystä. Pyydä uusi koodi.", "code");
        }
        throw err;
      }
      return { ok: true, token: "verified", username: pending.username };
    },

    // 3/3: salasana + profiili → tili valmis
    async setPassword({ email, password, remember: rem, legacyUsers }) {
      email = lower(email);
      password = String(password || "");
      const { data } = await sb.auth.getSession();
      const session = data && data.session;
      if (!session || lower(session.user.email) !== email) throw new CloudError("Vahvistus on vanhentunut. Aloita rekisteröinti alusta.");
      const username = pending.username || (session.user.user_metadata && session.user.user_metadata.username) || "";
      validatePassword(password, username, email);
      remember = rem !== false;
      mem.__remember = remember;
      persist();
      await call(sb.auth.updateUser({ password, data: { username } }));
      await call(sb.from("profiles").insert({ id: session.user.id, username }));
      current = { id: session.user.id, email, username, createdAt: Date.now() };
      Object.assign(pending, { email: "", username: "", sentAt: 0, tries: 0 });
      return { ok: true, user: current, partition: partitionFor(current, legacyUsers) };
    },

    async login({ login, password, remember: rem, legacyUsers }) {
      const key = lower(login);
      password = String(password || "");
      if (!key || !password) throw new CloudError("Kirjoita sähköposti tai käyttäjänimi ja salasana.");
      const f = fails.get(key);
      if (f && f.until > Date.now()) throw new CloudError(`Liian monta yritystä. Odota ${Math.ceil((f.until - Date.now()) / 1000)} s.`);
      const bad = () => {
        const g = fails.get(key) || { n: 0, until: 0 };
        g.n++;
        if (g.n >= LOGIN_MAX_FAILS) Object.assign(g, { n: 0, until: Date.now() + LOGIN_LOCK_MS });
        fails.set(key, g);
        return new CloudError("Väärä käyttäjätunnus tai salasana.");
      };
      let email = key;
      if (!key.includes("@")) {
        email = await call(sb.rpc("login_email", { p_login: key, p_password: password }));
        if (!email) throw bad();
      }
      remember = rem !== false;
      mem.__remember = remember;
      persist();
      let data;
      try {
        data = await call(sb.auth.signInWithPassword({ email, password }));
      } catch (err) {
        if (/Väärä käyttäjätunnus/.test(err.message)) throw bad();
        throw err;
      }
      fails.delete(key);
      const user = await loadUser(data.user);
      if (!user) {
        await sb.auth.signOut({ scope: "local" }).catch(() => {});
        throw new CloudError("Rekisteröinti jäi kesken. Luo tili uudelleen samalla sähköpostilla.");
      }
      current = user;
      return { ok: true, user: current, partition: partitionFor(current, legacyUsers) };
    },

    async logout() {
      current = null;
      try {
        await sb.auth.signOut({ scope: "local" });
      } catch {}
      mem = { __remember: remember };
      persist();
      return { ok: true };
    },

    // ---------- tilastot ----------
    async fetchStats() {
      const rows = await call(sb.from("game_stats").select("game_id, playtime_ms, launches, last_played"));
      const out = {};
      for (const r of rows || []) out[r.game_id] = { playtimeMs: Number(r.playtime_ms) || 0, launches: r.launches || 0, lastPlayed: r.last_played ? Date.parse(r.last_played) : null };
      return out;
    },
    async recordPlay(game, ms, launches) {
      await call(sb.rpc("record_play", { p_game: game, p_ms: Math.max(0, Math.round(ms)), p_launches: Math.max(0, launches | 0) }));
    },
  };
  return api;
}

module.exports = { createCloud, CloudError, friendly };
