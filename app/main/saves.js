// Pelipaja – pelien tallennukset pilveen (Supabase, taulu game_saves)
//
// Pelit tallentavat selaimen omaan tallennustilaan (localStorage ja IndexedDB). Ne ovat vain
// tällä koneella, joten launcher kopioi ne pilveen ja takaisin:
//   - Kun peli suljetaan (ja muutaman minuutin välein pelin aikana) launcher lukee pelin
//     tallennustilan ja lähettää muuttuneet avaimet pilveen.
//   - Ennen kuin peli käynnistyy, launcher hakee pilvestä muilla koneilla muuttuneet avaimet.
//     Peli-ikkunan preload kirjoittaa ne tallennustilaan ennen kuin pelin oma koodi alkaa.
//   - Kun kone synkronoi avaimen ensimmäistä kertaa ja sillä on jo eri tallennus, ne
//     yhdistetään (esim. tallennuslistat), eikä mitään heitetä pois.
// Jos nettiä ei ole, muutokset jonotetaan ja lähetetään myöhemmin.
const crypto = require("crypto");
const zlib = require("zlib");
const state = require("./state");
const { readUserJson, writeUserJson } = require("./storage");

const META = "cloud-saves.json"; // avain -> { h: tiiviste, r: palvelimen aikaleima, t, dirty, v (pienet skeemat) }
const QUEUE = "cloud-saves-queue.json"; // avain -> arvo, jota ei vielä saatu lähetettyä
const BATCH_CHARS = 850 * 1024;
const MAX_VALUE = 11 * 1024 * 1024;

const hash = (s) => crypto.createHash("sha1").update(s).digest("base64");
const pack = (s) => (s.length > 1500 ? "z:" + zlib.gzipSync(Buffer.from(s, "utf8")).toString("base64") : "r:" + s);
const unpack = (v) => (v.startsWith("z:") ? zlib.gunzipSync(Buffer.from(v.slice(2), "base64")).toString("utf8") : v.startsWith("r:") ? v.slice(2) : v);
// launcherin omat varmuuskopiot eivät mene pilveen
const skipKey = (k) => typeof k !== "string" || k.startsWith("ls:pelipaja.") || k.length > 900;
const currentUser = () => state.session && state.session.user;
const db = () => state.cloud && state.cloud.client;

let pending = null; // seuraavalle peli-ikkunalle valmiiksi haetut muutokset
let flushing = null;
let status = { ok: true, tableMissing: false, lastSync: 0 };

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error("timeout")), ms)))]).finally(() => clearTimeout(t));
}
async function q(p) {
  const r = await p;
  if (r && r.error) throw r.error;
  return r ? r.data : null;
}
const isMissingTable = (err) => /42P01|PGRST205|relation .* does not exist|could not find the table/i.test(String((err && (err.message || err.code)) || ""));

// ---------- pelin tallennustilan lukeminen ----------
// Ajetaan peli-ikkunassa. Palauttaa localStoragen ja IndexedDB:n sisällön JSON-tekstinä.
const DUMP_SCRIPT = `(async()=>{
  const E=encodeURIComponent,b64=u=>{let s='';for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s);};
  const enc=v=>{if(v===null||typeof v!=='object')return v;if(ArrayBuffer.isView(v))return{__pp:v.constructor.name,b:b64(new Uint8Array(v.buffer,v.byteOffset,v.byteLength))};
    if(v instanceof ArrayBuffer)return{__pp:'ArrayBuffer',b:b64(new Uint8Array(v))};if(v instanceof Date)return{__pp:'Date',t:v.getTime()};
    if(Array.isArray(v))return v.map(enc);const o={};for(const k of Object.keys(v))o[k]=enc(v[k]);return o;};
  const req=r=>new Promise((res,rej)=>{r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const out={ls:{},idb:{}};
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);out.ls[k]=localStorage.getItem(k);}}catch(e){}
  try{const dbs=indexedDB.databases?await indexedDB.databases():[];
    for(const info of dbs){if(!info.name)continue;const d=await new Promise(res=>{try{const r=indexedDB.open(info.name);r.onsuccess=()=>res(r.result);r.onerror=()=>res(null);r.onblocked=()=>res(null);}catch(e){res(null);}});if(!d)continue;
      try{const schema={version:d.version,stores:[]};
        for(const sn of Array.from(d.objectStoreNames)){const st=d.transaction(sn).objectStore(sn);schema.stores.push({name:sn,keyPath:st.keyPath,autoIncrement:st.autoIncrement});
          const keys=await req(st.getAllKeys()),vals=await req(d.transaction(sn).objectStore(sn).getAll());
          keys.forEach((k,i)=>{out.idb['idb:'+E(info.name)+'/'+E(sn)+'/'+E(JSON.stringify(k))]=JSON.stringify(enc(vals[i]));});}
        out.idb['idbs:'+E(info.name)]=JSON.stringify(schema);}catch(e){}
      d.close();}}catch(e){}
  return JSON.stringify(out);})()`;

async function dumpWindow(win, timeoutMs = 6000) {
  if (!win || win.isDestroyed()) return null;
  try {
    const txt = await withTimeout(win.webContents.executeJavaScript(DUMP_SCRIPT, true), timeoutMs);
    return JSON.parse(txt);
  } catch (err) {
    console.warn("[saves] reading game storage failed:", err.message);
    return null;
  }
}

// Muuttuneet avaimet jonoon. Palauttaa muuttuneiden määrän.
function ingest(user, dump) {
  if (!user || !dump) return 0;
  const meta = readUserJson(user, META, {});
  const queue = readUserJson(user, QUEUE, {});
  const all = {};
  for (const [k, v] of Object.entries(dump.ls || {})) all["ls:" + k] = v;
  for (const [k, v] of Object.entries(dump.idb || {})) all[k] = v;
  let n = 0;
  for (const [k, v] of Object.entries(all)) {
    if (skipKey(k) || typeof v !== "string") continue;
    const h = hash(v);
    if (meta[k] && meta[k].h === h) continue;
    meta[k] = Object.assign(meta[k] || {}, { h, t: Date.now(), dirty: true });
    if (k.startsWith("idbs:")) meta[k].v = v;
    queue[k] = v;
    n++;
  }
  if (n) {
    writeUserJson(user, META, meta);
    writeUserJson(user, QUEUE, queue);
  }
  return n;
}

// Jonossa olevat avaimet pilveen
function flush(user = currentUser()) {
  if (!user || !db()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = readUserJson(user, QUEUE, {});
    const keys = Object.keys(queue);
    if (!keys.length) return;
    let batch = [];
    let size = 0;
    const send = async () => {
      if (!batch.length) return;
      const iso = new Date().toISOString();
      const rows = batch.map((k) => ({ user_id: user.id, key: k, value: pack(queue[k]), updated_at: iso }));
      await withTimeout(q(db().from("game_saves").upsert(rows, { onConflict: "user_id,key" })), 30000);
      const meta = readUserJson(user, META, {});
      const qNow = readUserJson(user, QUEUE, {});
      for (const k of batch) {
        if (meta[k]) Object.assign(meta[k], { r: Date.parse(iso), dirty: false });
        if (qNow[k] === queue[k]) delete qNow[k]; // lähetyksen aikana muuttunut jää jonoon
      }
      writeUserJson(user, META, meta);
      writeUserJson(user, QUEUE, qNow);
      batch = [];
      size = 0;
    };
    try {
      for (const k of keys) {
        const v = queue[k];
        if (typeof v !== "string" || v.length > MAX_VALUE) {
          console.warn("[saves] skipping a value that is too large:", k);
          continue;
        }
        if (size + v.length > BATCH_CHARS) await send();
        batch.push(k);
        size += v.length;
      }
      await send();
      status = { ok: true, tableMissing: false, lastSync: Date.now() };
    } catch (err) {
      status = { ok: false, tableMissing: isMissingTable(err), lastSync: status.lastSync };
      console.warn("[saves] upload failed:", (err && err.message) || err);
    }
  })().finally(() => (flushing = null));
  return flushing;
}

// ---------- ennen pelin käynnistystä: muilla koneilla tehdyt muutokset ----------
async function prepare(user = currentUser()) {
  pending = null;
  if (!user || !db()) return;
  await flush(user).catch(() => {});
  let rows;
  try {
    rows = await withTimeout(q(db().from("game_saves").select("key,updated_at").eq("user_id", user.id)), 4500);
  } catch (err) {
    status = { ok: false, tableMissing: isMissingTable(err), lastSync: status.lastSync };
    console.warn("[saves] fetching the save list failed:", (err && err.message) || err);
    return;
  }
  const meta = readUserJson(user, META, {});
  const need = (rows || []).filter((r) => !skipKey(r.key) && (!meta[r.key] || meta[r.key].r !== Date.parse(r.updated_at)));
  if (!need.length) {
    status = { ok: true, tableMissing: false, lastSync: Date.now() };
    return;
  }
  const want = new Set(need.map((r) => r.key));
  const since = need.reduce((m, r) => (r.updated_at < m ? r.updated_at : m), need[0].updated_at);
  const got = [];
  try {
    for (let from = 0; ; from += 100) {
      const part = await withTimeout(
        q(db().from("game_saves").select("key,value,updated_at").eq("user_id", user.id).gte("updated_at", since).order("key").range(from, from + 99)),
        20000
      );
      for (const r of part || []) if (want.has(r.key)) got.push(r);
      if (!part || part.length < 100) break;
    }
  } catch (err) {
    console.warn("[saves] downloading saves failed:", (err && err.message) || err);
    return;
  }
  const items = [];
  for (const r of got) {
    let value;
    try {
      value = unpack(r.value);
    } catch {
      continue;
    }
    const m = meta[r.key];
    items.push({ key: r.key, value, at: r.updated_at, first: !m, localNewer: !!(m && m.dirty && m.t > Date.parse(r.updated_at)) });
  }
  // IndexedDB:n kirjoittamiseen tarvitaan tietokannan rakenne
  const schemas = {};
  for (const it of items) if (it.key.startsWith("idbs:")) schemas[it.key.slice(5)] = it.value;
  for (const it of items) {
    if (!it.key.startsWith("idb:")) continue;
    const dbName = it.key.slice(4).split("/")[0];
    if (!schemas[dbName]) {
      const m = meta["idbs:" + dbName];
      if (m && m.v) schemas[dbName] = m.v;
    }
  }
  pending = { userId: user.id, items, schemas };
  status = { ok: true, tableMissing: false, lastSync: Date.now() };
}

// Peli-ikkunan preload hakee muutokset (kerran per käynnistys)
function take() {
  const user = currentUser();
  if (!pending || !user || pending.userId !== user.id) return null;
  const p = pending;
  pending = null;
  const meta = readUserJson(user, META, {});
  for (const it of p.items) {
    const m = (meta[it.key] = meta[it.key] || {});
    if (it.localNewer) continue; // tämän koneen uudempi versio lähtee pilveen seuraavaksi
    Object.assign(m, { h: hash(it.value), r: Date.parse(it.at), t: Date.parse(it.at) || Date.now(), dirty: false });
    if (it.key.startsWith("idbs:")) m.v = it.value;
  }
  writeUserJson(user, META, meta);
  return { items: p.items, schemas: p.schemas };
}

// Pelin sulkeminen / välitallennus: luetaan ja lähetetään
async function capture(win, user = currentUser()) {
  const dump = await dumpWindow(win);
  if (dump && ingest(user, dump)) flush(user).catch(() => {});
}

const busy = () => !!flushing;
const getStatus = () => status;

// jonossa olevat lähetetään, kun netti palaa
setInterval(() => currentUser() && flush().catch(() => {}), 60 * 1000).unref();

module.exports = { prepare, take, capture, dumpWindow, ingest, flush, busy, getStatus, DUMP_SCRIPT, pack, unpack };
