// Ladataan jokaiseen peli-ikkunaan.
// Lisää "Save & End Game" -napin ja antaa pelille yhteyden launcheriin.
const { contextBridge, ipcRenderer } = require("electron");

let launcherUser = null;
try {
  launcherUser = ipcRenderer.sendSync("rr-game-user");
} catch {}
contextBridge.exposeInMainWorld("rrLauncher", {
  saveAndEnd: () => ipcRenderer.send("game-save-and-end"),
  // Pelipajan käyttäjänimi (null, jos ei kirjauduttu)
  username: launcherUser && typeof launcherUser.username === "string" ? launcherUser.username : null,
});

// ---------- Pilvitallennukset ----------
// Muilla koneilla tehdyt tallennukset kirjoitetaan tämän koneen tallennustilaan ennen kuin
// pelin oma koodi ehtii lukea niitä. Kun kone synkronoi avaimen ensimmäistä kertaa ja sillä
// on jo oma, erilainen tallennus, ne yhdistetään (esim. tallennuslistat). Jos yhdistäminen
// ei onnistu, tämän koneen versio jää talteen avaimeen "pelipaja.backup.<avain>".
(function applyCloudSaves() {
  let pull = null;
  try {
    pull = ipcRenderer.sendSync("rr-saves-take");
  } catch {}
  if (!pull || !Array.isArray(pull.items) || !pull.items.length) return;

  const idOf = (o) => (o && typeof o === "object" && !Array.isArray(o) ? (o.id != null ? "i" + o.id : o.key != null ? "k" + o.key : null) : null);
  const idArr = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => idOf(x) !== null);
  const union = (r, l) => {
    const seen = new Set(r.map(idOf));
    return r.concat(l.filter((x) => !seen.has(idOf(x))));
  };
  const stamp = (o) => {
    if (!o || typeof o !== "object") return 0;
    for (const f of ["last", "updated", "updatedAt", "savedAt", "saved", "time", "ts"]) if (typeof o[f] === "number") return o[f];
    return 0;
  };
  // palauttaa { v: kirjoitettava arvo, lost: jäikö paikallinen versio pois }
  function merge(localS, remoteS) {
    let L, Rv;
    try {
      L = JSON.parse(localS);
      Rv = JSON.parse(remoteS);
    } catch {
      return { v: remoteS, lost: true };
    }
    if (Array.isArray(L) && Array.isArray(Rv) && (idArr(L) || idArr(Rv)) && (!L.length || idArr(L)) && (!Rv.length || idArr(Rv))) return { v: JSON.stringify(union(Rv, L)), lost: false };
    if (L && Rv && typeof L === "object" && typeof Rv === "object" && !Array.isArray(L) && !Array.isArray(Rv)) {
      const diff = Object.keys(Object.assign({}, L, Rv)).filter((k) => JSON.stringify(L[k]) !== JSON.stringify(Rv[k]));
      const ok = (v) => v === undefined || (Array.isArray(v) && (!v.length || idArr(v)));
      if (diff.length && diff.every((k) => ok(L[k]) && ok(Rv[k]))) {
        const o = Object.assign({}, Rv);
        for (const k of diff) o[k] = union(Rv[k] || [], L[k] || []);
        return { v: JSON.stringify(o), lost: false };
      }
    }
    const sl = stamp(L),
      sr = stamp(Rv);
    if (sl && sr && sl > sr) return { v: localS, lost: false };
    return { v: remoteS, lost: true };
  }
  // mitä kirjoitetaan: null = pidetään tämän koneen arvo
  function decide(it, local) {
    if (local === null || local === undefined) return { v: it.value };
    if (local === it.value) return null;
    if (it.localNewer) return null;
    if (it.first) return merge(local, it.value);
    return { v: it.value };
  }

  // localStorage
  for (const it of pull.items) {
    if (!it.key.startsWith("ls:")) continue;
    const k = it.key.slice(3);
    try {
      const local = localStorage.getItem(k);
      const d = decide(it, local);
      if (!d) continue;
      if (d.lost && local != null) localStorage.setItem("pelipaja.backup." + k, local);
      if (d.v !== local) localStorage.setItem(k, d.v);
    } catch (err) {
      console.warn("Pelipaja: restoring a save failed", k, err);
    }
  }

  // IndexedDB
  const unb64 = (s) => {
    const bin = atob(s),
      u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  const b64 = (u) => {
    let s = "";
    for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768));
    return btoa(s);
  };
  const TYPES = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
  const dec = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(dec);
    if (v.__pp) {
      if (v.__pp === "Date") return new Date(v.t);
      const u = unb64(v.b);
      if (v.__pp === "ArrayBuffer") return u.buffer;
      if (v.__pp === "DataView") return new DataView(u.buffer);
      const T = TYPES[v.__pp];
      if (T) return new T(u.buffer, 0, u.byteLength / T.BYTES_PER_ELEMENT);
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = dec(v[k]);
    return o;
  };
  const enc = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (ArrayBuffer.isView(v)) return { __pp: v.constructor.name, b: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof ArrayBuffer) return { __pp: "ArrayBuffer", b: b64(new Uint8Array(v)) };
    if (v instanceof Date) return { __pp: "Date", t: v.getTime() };
    if (Array.isArray(v)) return v.map(enc);
    const o = {};
    for (const k of Object.keys(v)) o[k] = enc(v[k]);
    return o;
  };
  const byDb = {};
  for (const it of pull.items) {
    if (!it.key.startsWith("idb:")) continue;
    const [dbN, stN, keyN] = it.key.slice(4).split("/");
    try {
      const e = { it, db: decodeURIComponent(dbN), store: decodeURIComponent(stN), key: JSON.parse(decodeURIComponent(keyN)) };
      (byDb[e.db] = byDb[e.db] || []).push(e);
    } catch {}
  }
  for (const [dbName, entries] of Object.entries(byDb)) {
    let schema = null;
    try {
      schema = JSON.parse((pull.schemas || {})[encodeURIComponent(dbName)] || "null");
    } catch {}
    if (!schema || !Array.isArray(schema.stores)) continue;
    let rq;
    try {
      rq = indexedDB.open(dbName, schema.version);
    } catch {
      continue;
    }
    rq.onupgradeneeded = () => {
      const d = rq.result;
      for (const s of schema.stores) if (!d.objectStoreNames.contains(s.name)) d.createObjectStore(s.name, { keyPath: s.keyPath || undefined, autoIncrement: !!s.autoIncrement });
    };
    rq.onsuccess = () => {
      const d = rq.result;
      const stores = [...new Set(entries.map((e) => e.store))].filter((s) => d.objectStoreNames.contains(s));
      if (!stores.length) return d.close();
      const tx = d.transaction(stores, "readwrite");
      for (const e of entries) {
        if (!stores.includes(e.store)) continue;
        const st = tx.objectStore(e.store);
        const g = st.get(e.key);
        g.onsuccess = () => {
          const local = g.result === undefined ? null : JSON.stringify(enc(g.result));
          const dcs = decide(e.it, local);
          if (!dcs || dcs.v === local) return;
          const val = dec(JSON.parse(dcs.v));
          if (st.keyPath) st.put(val);
          else st.put(val, e.key);
        };
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => d.close();
    };
  }
})();

const CORNERS = {
  "top-left": "top:10px;left:10px",
  "top-right": "top:10px;right:10px",
  "bottom-left": "bottom:10px;left:10px",
  "bottom-right": "bottom:10px;right:10px",
  "top-center": "top:10px;left:50%;transform:translateX(-50%)",
};

function addButton() {
  if (document.getElementById("rr-end-btn")) return;
  const corner = ipcRenderer.sendSync("game-button-corner") || "top-left";

  const style = document.createElement("style");
  style.textContent = `
    #rr-end-btn{position:fixed;${CORNERS[corner] || CORNERS["top-left"]};z-index:2147483647;
      display:flex;align-items:center;gap:8px;padding:7px 12px 7px 10px;border-radius:8px;
      background:rgba(10,12,16,.72);color:#eef1f5;border:1px solid rgba(255,255,255,.18);
      font:600 13px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.02em;cursor:pointer;
      opacity:.6;transition:opacity .15s,background .15s;backdrop-filter:blur(4px);user-select:none}
    #rr-end-btn:hover{opacity:1;background:rgba(10,12,16,.9)}
    #rr-end-btn i{width:9px;height:9px;border-radius:2px;background:#3fbf5f;flex:none}
    #rr-end-btn kbd{font:600 11px/1 inherit;color:#8b94a3;border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:2px 4px}
    #rr-end-btn[disabled]{opacity:1;cursor:default}`;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.id = "rr-end-btn";
  btn.type = "button";
  btn.title = "Saves the game and returns to the launcher (F10)";
  btn.innerHTML = "<i></i><span>Save &amp; End Game</span><kbd>F10</kbd>";

  // Pysäytetään klikkaus, ettei peli luule sitä omaksi klikkaukseksi
  for (const ev of ["pointerdown", "mousedown", "mouseup", "touchstart"]) {
    btn.addEventListener(ev, (e) => e.stopPropagation());
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (btn.disabled) return;
    btn.disabled = true;
    btn.querySelector("span").textContent = "Saving…";
    ipcRenderer.send("game-save-and-end");
  });
  document.body.appendChild(btn);
}

// F10 = Save & End Game (varmistus myös sivun puolelta)
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "F10") {
      e.preventDefault();
      e.stopImmediatePropagation();
      ipcRenderer.send("game-save-and-end");
    }
  },
  true
);

ipcRenderer.on("rr-saving", () => {
  const btn = document.getElementById("rr-end-btn");
  if (btn) {
    btn.disabled = true;
    btn.querySelector("span").textContent = "Saving…";
  }
});

// Pelipajan päivitys ladattu taustalla: pieni ilmoitus peliin (ei keskeytä peliä)
ipcRenderer.on("rr-update-ready", (_e, version) => {
  if (document.getElementById("rr-upd-note")) return;
  const n = document.createElement("div");
  n.id = "rr-upd-note";
  n.setAttribute("style", "position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:300px;padding:10px 14px;border-radius:10px;" +
    "background:rgba(10,12,16,.88);color:#eef1f5;border:1px solid rgba(63,191,95,.6);font:500 13px/1.35 'Segoe UI',system-ui,sans-serif;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.35);pointer-events:none;transition:opacity .4s");
  const b = document.createElement("b");
  b.textContent = `Pelipaja ${String(version || "").slice(0, 20)} is ready`;
  b.style.display = "block";
  const t = document.createElement("span");
  t.textContent = "You'll be asked to update when you close the game.";
  n.append(b, t);
  (document.body || document.documentElement).appendChild(n);
  setTimeout(() => (n.style.opacity = "0"), 8000);
  setTimeout(() => n.remove(), 8600);
});

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", addButton);
} else {
  addButton();
}
