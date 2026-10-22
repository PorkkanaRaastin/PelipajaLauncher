// Chained Climbers – pelin logiikka (kenttä, fysiikka, ketju, myrsky, botti).
// Ladataan index.html:stä ennen grafiikkaa. Ei riipu three.js:stä, joten testit voivat ajaa sen suoraan.
(function (root) {
"use strict";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const T = 32;                      // ruudun koko
const PW = 10, PH = 34;            // pelaajan puolileveys ja korkeus
const GRAV = 1500, JUMP = 520, CLIMB = 105, WALK = 215;
const AIR = 0, ROCK = 1, ICE = 2, CRUM = 3, PLAT = 4, SLAB = 5;
const W = 30, IN0 = 2, IN1 = W - 3; // kentän leveys ja sisäosa
const CHAIN = 230, CHAIN_MIN = 34;  // ketjun pituus
const Z = { foot: 0, cliff: 1, cave: 2, ice: 3, ridge: 4, summit: 5 };
const ZNAME = ["Foothills", "Cliffs", "Inside the mountain", "Ice face", "Storm ridge", "Summit"];
const gripT = (t) => t === ROCK || t === CRUM;
const MOUNTS = [
  { n: "Saana", m: 1029, base: 480 },
  { n: "Pallas", m: 807, base: 330 },
  { n: "Ylläs", m: 718, base: 260 },
  { n: "Pyhä", m: 540, base: 180 },
  { n: "Halti", m: 1324, base: 700 },
  { n: "Kebnekaise", m: 2097, base: 900 },
];
function mountain(lv) {
  const i = (lv - 1) % MOUNTS.length, loop = Math.floor((lv - 1) / MOUNTS.length), b = MOUNTS[i];
  return { n: b.n + (loop ? " #" + (loop + 1) : ""), m: b.m, base: b.base, D: i + 1 + loop * 2, idx: i };
}
function zonesFor(D) {
  const k = Math.min(3, Math.floor((D - 1) / 2));
  const z = [["foot", 4 + k], ["cliff", 5 + k], ["cave", 5 + k], ["ice", 4 + k]];
  if (D >= 2) z.push(["ridge", 3 + k]);
  return z;
}

// ---------- maailma ----------
const M = {
  TH: 0, grid: null, zr: null, route: [], cps: [], saus: [], bers: [], spawners: [], signs: [], lanterns: [], crumList: [], crumIdx: new Map(),
  summit: null, MT: null, segs: [], startX: 0, decor: [],
};
function tile(cx, cy) { if (cx < 0 || cx >= W || cy < 0) return ROCK; if (cy >= M.TH) return AIR; return M.grid[cy * W + cx]; }
const solidC = (cx, cy) => { const t = tile(cx, cy); return t !== AIR && t !== PLAT; };
const solidAt = (x, y) => tile(Math.floor(x / T), Math.floor(y / T)) !== AIR;
const zoneAt = (y) => M.zr[clamp(Math.floor(y / T), 0, M.TH - 1)];

function buildMap(seed, lv) {
  const R = mulberry32((seed ^ 0x5bd1e995) + lv * 7919);
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const MT = mountain(lv), D = MT.D;
  M.MT = MT;
  const CAP = 1500;
  const g = new Uint8Array(W * CAP), rs = new Uint8Array(W * CAP), rsol = new Uint8Array(W * CAP), hr = new Uint8Array(W * CAP), zr = new Uint8Array(CAP);
  const route = [], cps = [], saus = [], spawners = [], signs = [], lanterns = [], segs = [], decor = [];
  let filled = 0, zone = Z.foot;
  let firstSign = new Set();
  const at = (x, y) => (x < 0 || x >= W || y < 0 ? ROCK : y >= CAP ? AIR : g[y * W + x]);
  const put = (x, y, t) => { if (x < 0 || x >= W || y < 0 || y >= CAP) return; const k = y * W + x; if (rs[k]) return; g[k] = t; rsol[k] = t !== AIR ? 1 : 0; };
  const putF = (x, y, t) => { if (x < 0 || x >= W || y < 0 || y >= CAP) return; const k = y * W + x; g[k] = t; rsol[k] = t !== AIR ? 1 : 0; };
  const fill = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, t); };
  function ensure(y) {
    y = Math.min(CAP - 1, y);
    for (; filled <= y; filled++) {
      zr[filled] = zone;
      for (let x = 0; x < W; x++) {
        const k = filled * W + x;
        if (rsol[k]) continue;
        g[k] = zone === Z.cave ? ROCK : x < IN0 || x > IN1 ? SLAB : AIR;
      }
    }
  }
  // ilmaa (ei koske reitin kiinteisiin paloihin)
  const carve = (x0, y0, x1, y1) => { ensure(y1 + 1); for (let y = Math.max(0, y0); y <= y1; y++) for (let x = Math.max(IN0, x0); x <= Math.min(IN1, x1); x++) { const k = y * W + x; if (!rsol[k]) g[k] = AIR; } };
  const reserve = (x0, y0, x1, y1) => { for (let y = Math.max(0, y0); y <= y1; y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) rs[y * W + x] = 1; };
  const markHr = (x0, x1, y, n = 3) => { for (let yy = y; yy < y + n; yy++) for (let x = x0; x <= x1; x++) if (x >= 0 && x < W) hr[yy * W + x] = 1; };
  const rect = (x0, y0, x1, y1, f) => { if (x0 > x1 || y0 > y1) return true; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!f(x, y, y * W + x)) return false; return true; };
  const inb = (x, y) => x >= IN0 && x <= IN1 && y >= 0 && y < CAP - 40;
  const freeSolid = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (x, y, k) => inb(x, y) && !rsol[k] && !rs[k] && !hr[k]);
  const freeBlock = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (x, y, k) => inb(x, y) && !rs[k] && !hr[k]);
  const clearAir = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (x, y, k) => inb(x, y) && !rsol[k]);
  const sign = (type, txt, x, y) => { if (lv > 2 && type !== "storm" && type !== "chain") return; if (firstSign.has(type)) return; firstSign.add(type); signs.push({ x, y, t: txt, type }); };
  const mid = (IN0 + IN1) / 2;

  // lähtö: tasainen pohja
  ensure(8);
  for (let y = 0; y <= 2; y++) for (let x = 0; x < W; x++) putF(x, y, ROCK);
  markHr(Math.floor(W / 2) - 2, Math.floor(W / 2) + 2, 3, 3);
  let cur = { x: Math.floor(W / 2), y: 3, l: Math.floor(W / 2) - 2, r: Math.floor(W / 2) + 2 };
  M.startX = cur.x * T + T / 2;
  cps.push({ x: cur.x * T + T / 2, y: 3 * T, i: 0, start: true });
  route.push({ k: "walk", x: cur.x * T + T / 2, y: 3 * T, l: IN0 * T, r: (IN1 + 1) * T, fy: 3 * T, fl: IN0 * T, fr: (IN1 + 1) * T });
  sign("basics", "Hold SHIFT to grip|W climbs · SPACE jumps", (cur.x - 5) * T, 3 * T);
  sign("chain", "You're chained together!|If one falls, the other holds on", (cur.x + 6) * T, 3 * T);

  let est = 0;
  const node = (n) => {
    const prev = route[route.length - 1];
    n.fy = prev.y; n.fl = prev.l; n.fr = prev.r;
    route.push(n);
  };
  // tilannekuva: pala voidaan perua, jos sen jälkeen ei pääse jatkamaan
  function snap() {
    return { g: g.slice(), rs: rs.slice(), rsol: rsol.slice(), hr: hr.slice(), zr: zr.slice(), filled, zone, cur: { ...cur }, est, rl: route.length, last: { ...route[route.length - 1] },
      sl: saus.length, spl: spawners.length, sgl: signs.length, fs: new Set(firstSign), ll: lanterns.length };
  }
  function restore(q) {
    g.set(q.g); rs.set(q.rs); rsol.set(q.rsol); hr.set(q.hr); zr.set(q.zr); filled = q.filled; zone = q.zone; cur = { ...q.cur }; est = q.est;
    route.length = q.rl; route[q.rl - 1] = { ...q.last };
    saus.length = q.sl; spawners.length = q.spl; signs.length = q.sgl; firstSign = new Set(q.fs); lanterns.length = q.ll;
  }
  function canContinue() {
    const q = snap();
    const ok = wall1(4) || hop1({}) || stairsUp() || wallOn(4);
    restore(q);
    return ok;
  }
  const prefDir = () => { const d = cur.x < mid ? 1 : -1; return R() < 0.3 ? -d : d; };

  // --- palat: palauttavat true, jos pala mahtui ---
  // hyppy tasanteelta toiselle
  function hop1(o = {}) {
    const w = o.w || ri(o.wmin || 3, o.wmax || 5);
    const pd = prefDir();
    const dys = o.dy != null ? [o.dy] : R() < 0.55 ? [2, 1] : [1, 2];
    const cands = [];
    // kapealta tai murenevalta tasanteelta ei saa vauhtia: lyhyempi rako
    const short = cur.r - cur.l + 1 < 3 || at(cur.x, cur.y - 1) === CRUM || at(cur.x, cur.y - 1) === ICE;
    for (const dir of [pd, -pd]) for (const dy of dys) {
      const gmax = Math.min(o.gmax || 4, dy >= 2 ? 3 : 4, short ? 2 : 9), gmin = Math.min(gmax, o.gmin || 2);
      const g0 = ri(gmin, gmax), gaps = [g0];
      for (let q = gmax; q >= gmin; q--) if (q !== g0) gaps.push(q);
      gaps.forEach((gp, gi) => {
        let nl, nr;
        if (dir > 0) { nl = cur.r + 1 + gp; nr = nl + w - 1; } else { nr = cur.l - 1 - gp; nl = nr - w + 1; }
        if (nl < IN0 || nr > IN1) return;
        const ny = cur.y + dy, thick = dy >= 2 && !o.crum && !o.thin ? 2 : 1;
        if (!(o.relax ? rect(nl, ny - thick, nr, ny - 1, (x, y, k) => inb(x, y) && !rsol[k] && !rs[k]) : freeSolid(nl, ny - thick, nr, ny - 1))) return;
        if (!clearAir(nl, ny, nr, ny + 2)) return;
        const gx0 = dir > 0 ? cur.r + 1 : nr + 1, gx1 = dir > 0 ? nl - 1 : cur.l - 1;
        if (!clearAir(gx0, cur.y, gx1, ny + 2)) return;
        const ex = dir > 0 ? cur.r : cur.l;
        if (!clearAir(Math.min(ex, ex - dir), cur.y, Math.max(ex, ex - dir), cur.y + 3)) return;
        // nurkkaan jäävä tasanne on huono jatkon kannalta
        const room = dir > 0 ? IN1 - nr : nl - IN0;
        const score = (dir === pd ? 0 : 2) + gi * 0.5 + (dy === dys[0] ? 0 : 1) + (room < 3 ? 6 : 0);
        cands.push({ dir, dy, gp, nl, nr, ny, thick, gx0, gx1, score });
      });
    }
    if (!cands.length) return false;
    cands.sort((a, b) => a.score - b.score);
    const { dir, dy, nl, nr, ny, thick, gx0, gx1 } = cands[0];
    ensure(ny + 6);
    carve(Math.min(dir > 0 ? cur.r - 1 : nl, gx0), cur.y, Math.max(dir > 0 ? nr : cur.l + 1, gx1), ny + 3);
    const mat = o.crum ? CRUM : o.ice && nr - nl + 1 >= 4 && R() < 0.6 ? ICE : ROCK;
    for (let x = nl; x <= nr; x++) { put(x, ny - 1, mat); if (thick === 2) put(x, ny - 2, ROCK); }
    reserve(gx0, cur.y, gx1, ny + 2);
    { const ex = dir > 0 ? cur.r : cur.l; reserve(Math.min(ex, ex - dir), cur.y, Math.max(ex, ex - dir), cur.y + 3); }
    markHr(nl, nr, ny);
    node({ k: "jump", dir, tx: dir > 0 ? (cur.r + 1) * T - 1 : cur.l * T + 1, x: ((nl + nr + 1) / 2) * T, y: ny * T, l: nl * T, r: (nr + 1) * T, t: o.crum ? "crum" : o.ice ? "ice" : "hop" });
    if (o.crum) sign("crum", "Crumbling rock!|Don't stop moving", ((cur.l + cur.r + 1) / 2) * T, cur.y * T);
    cur = { x: Math.floor((nl + nr) / 2), y: ny, l: nl, r: nr };
    if (!o.crum && R() < 0.2) saus.push({ x: (cur.x + 0.5) * T, y: cur.y * T + 12, e: false });
    est += o.crum ? 1.1 : 1.6;
    return true;
  }
  function hop(n, o) { let ok = 0; for (let k = 0; k < n; k++) if (hop1(o)) ok++; else break; return ok > 0; }
  // porras suoraan ylös (varasuunnitelma)
  function stairsUp() {
    const ny = cur.y + 2;
    const opts = [];
    if (IN1 - cur.r >= 3) opts.push([1, cur.r + 1, cur.r + 3, false]);
    if (cur.l - IN0 >= 3) opts.push([-1, cur.l - 3, cur.l - 1, false]);
    if (cur.x - cur.l >= 3) opts.push([-1, cur.l, cur.l + 2, true]);
    if (cur.r - cur.x >= 3) opts.push([1, cur.r - 2, cur.r, true]);
    for (const [dir, nl, nr, from0] of opts) {
      if (!freeSolid(nl, ny - 2, nr, ny - 1) || !clearAir(nl, ny, nr, ny + 2)) continue;
      if (!clearAir(Math.min(cur.l, nl), cur.y, Math.max(cur.r, nr), cur.y + 1) && !from0) continue;
      ensure(ny + 6);
      carve(Math.min(cur.l, nl), cur.y, Math.max(cur.r, nr), ny + 3);
      for (let x = nl; x <= nr; x++) { put(x, ny - 1, ROCK); put(x, ny - 2, ROCK); }
      markHr(nl, nr, ny);
      const n = { k: "jump", dir, tx: dir > 0 ? (cur.r + 1) * T - 1 : cur.l * T + 1, x: ((nl + nr + 1) / 2) * T, y: ny * T, l: nl * T, r: (nr + 1) * T, t: "hop" };
      if (from0) { n.from0 = true; n.tx = dir < 0 ? (nr + 1) * T + PW + 3 : nl * T - PW - 3; }
      node(n);
      cur = { x: Math.floor((nl + nr) / 2), y: ny, l: nl, r: nr };
      est += 1.6;
      return true;
    }
    return false;
  }
  // seinä: kallio nousee tasanteen päästä
  function wall1(h, o = {}) {
    const pd = o.dir || (IN1 - cur.r >= cur.l - IN0 ? 1 : -1) * (R() < 0.3 ? -1 : 1);
    const bws = o.bw ? [o.bw] : [ri(3, 4), 3, 2];
    for (const dir of o.dir ? [o.dir] : [pd, -pd]) for (const bw of bws) for (let hh = h; hh >= Math.max(3, h - 3); hh--) {
      const wx0 = dir > 0 ? cur.r + 1 : cur.l - bw, wx1 = wx0 + bw - 1;
      if (wx0 < IN0 || wx1 > IN1) continue;
      const fc = dir > 0 ? wx0 : wx1, cc = dir > 0 ? cur.r : cur.l;
      const top = cur.y + hh;
      if (!freeBlock(wx0, cur.y - 2, wx1, top - 1)) continue;
      if (!clearAir(Math.min(cc, cc - dir), cur.y, Math.max(cc, cc - dir), top + 3)) continue;
      if (!clearAir(wx0, top, wx1, top + 2)) continue;
      ensure(top + 6);
      carve(Math.min(cc, cc - dir), cur.y, Math.max(cc, cc - dir), top + 3);
      carve(wx0, top, wx1, top + 3);
      fill(wx0, cur.y - 2, wx1, top - 1, ROCK);
      if (o.ice && hh >= 6) {
        const bh = D >= 5 ? 3 : 2, b = cur.y + ri(2, hh - bh - 2);
        for (let y = b; y < b + bh; y++) putF(fc, y, ICE);
        sign("ice", "Ice can't be gripped!|W + SPACE while gripping = lunge", cc * T + T / 2 - dir * 2 * T, cur.y * T);
      }
      if (o.crum && hh >= 5) {
        const b = cur.y + ri(1, hh - 4);
        for (let y = b; y < b + 2; y++) if (at(fc, y) === ROCK) putF(fc, y, CRUM);
      }
      let rk = null;
      if (o.rocks && hh <= 8) {
        rk = spawners.length;
        spawners.push({ x: cc * T + T / 2, y: (top + 9) * T, per: 5.5 + R() * 2, t: R() * 2, warn: false, gy: 0 });
        sign("rocks", "Falling rocks!|Watch for the warning", cc * T + T / 2 - dir * 2 * T, cur.y * T);
      }
      reserve(Math.min(cc, cc - dir), cur.y, Math.max(cc, cc - dir), top + 3);
      markHr(wx0, wx1, top);
      if (hh >= 8) sign("piton", "Tall wall!|E hammers a piton: rest + safe anchor", cc * T + T / 2 - dir * 2 * T, cur.y * T);
      else sign("wall", "Grip the wall with SHIFT|W climbs · keep W at the top", cc * T + T / 2 - dir * 2 * T, cur.y * T);
      node({ k: "climb", side: dir, cc, rk, fx: dir > 0 ? wx0 * T - PW : (wx1 + 1) * T + PW, x: ((wx0 + wx1 + 1) / 2) * T, y: top * T, l: wx0 * T, r: (wx1 + 1) * T, h: hh, t: o.ice ? "ice" : "wall" });
      cur = { x: Math.floor((wx0 + wx1) / 2), y: top, l: wx0, r: wx1, cc, dir };
      if (R() < 0.25) saus.push({ x: (cur.x + 0.5) * T, y: cur.y * T + 12, e: false });
      est += hh * 0.45 + 1.8 + (o.ice ? 2.5 : 0) + (o.rocks ? 2 : 0);
      return true;
    }
    return false;
  }
  // kamiini: kaksi pylvästä, sisäpinnat jäätä -> potkitaan seinästä toiseen
  function chimney(h, o = {}) {
    const cw = D >= 4 && R() < 0.5 ? 4 : 3;
    let prog = false;
    if (cur.r - cur.l + 1 !== cw) {
      prog = R() < 0.5 ? hop1({ w: cw, dy: 2, gmin: 2, gmax: 3 }) || wall1(ri(3, 4), { bw: cw }) : wall1(ri(3, 4), { bw: cw }) || hop1({ w: cw, dy: 2, gmin: 2, gmax: 3 });
      if (!prog || cur.r - cur.l + 1 !== cw) return prog;
    }
    const exit = cur.x < mid ? 1 : -1;
    for (let hh = h; hh >= 4; hh--) {
      const top = cur.y + hh;
      const okP = [[cur.l - 2, cur.l - 1], [cur.r + 1, cur.r + 2]].every(([a, b]) => rect(a, cur.y - 2, b, top - 1, (x, y, k) => inb(x, y) && !hr[k]));
      if (!okP) continue;
      if (!clearAir(cur.l, cur.y, cur.r, top + 2)) continue;
      for (const e of [exit, -exit]) {
        const ex0 = e > 0 ? cur.r + 1 : cur.l - 4, ex1 = e > 0 ? cur.r + 4 : cur.l - 1;
        if (ex0 < IN0 || ex1 > IN1) continue;
        if (!freeBlock(ex0, top - 2, ex1, top - 1) || !clearAir(ex0, top, ex1, top + 2)) continue;
        ensure(top + 6);
        carve(cur.l, cur.y, cur.r, top + 3);
        const inner = o.rockInner ? ROCK : ICE;
        // pylväät: tulokäytävän kohdalle jää kahden ruudun oviaukko
        let door = 0;
        for (const [a, b, inn, sd] of [[cur.l - 2, cur.l - 1, cur.l - 1, -1], [cur.r + 1, cur.r + 2, cur.r + 1, 1]])
          for (let y = cur.y - 2; y <= top - 1; y++) for (let x = a; x <= b; x++) {
            const t = y === top - 1 ? ROCK : x === inn ? inner : o.allIce ? ICE : ROCK;
            if (rs[y * W + x] && y <= cur.y + 1) { if (y >= cur.y) door = sd; continue; }
            if (y >= cur.y + 2) putF(x, y, t); else put(x, y, t);
          }
        carve(ex0, top, ex1, top + 3);
        for (let x = ex0; x <= ex1; x++) { put(x, top - 1, ROCK); put(x, top - 2, ROCK); }
        reserve(cur.l, cur.y, cur.r, top + 2);
        markHr(ex0, ex1, top);
        sign("chim", "Icy chimney!|Kick between the walls with SPACE", ((cur.l + cur.r + 1) / 2) * T, cur.y * T);
        node({ k: "chim", door, xl: cur.l * T, xr: (cur.r + 1) * T, top: top * T, exit: e, x: ((ex0 + ex1 + 1) / 2) * T, y: top * T, l: ex0 * T, r: (ex1 + 1) * T, t: "chim" });
        cur = { x: Math.floor((ex0 + ex1) / 2), y: top, l: ex0, r: ex1 };
        est += hh * 0.45 + 3;
        return true;
      }
    }
    return prog;
  }
  // luola: tasanteita vuorotellen seinien vierellä, hypitään edestakaisin ylös
  function zigzag(n) {
    const pw = 4, rw = 10;
    const starts = [];
    for (let rx0 = Math.max(IN0, cur.x - rw + 2); rx0 <= Math.min(IN1 - rw + 1, cur.x - 1); rx0++) starts.push(rx0);
    shuffle(starts);
    for (let nn = n; nn >= 2; nn--) for (const rx0 of starts) {
      const rx1 = rx0 + rw - 1, yTop = cur.y + 2 * nn + 3;
      if (!clearAir(rx0, cur.y, rx1, yTop)) continue;
      // kuivaharjoitus: mahtuvatko tasanteet
      const plats = [];
      let side = cur.x < (rx0 + rx1) / 2 ? 1 : -1, y = cur.y, ok = true;
      for (let k = 1; k <= nn; k++) {
        const ny = y + 2, w = pw;
        const nl = side > 0 ? rx1 - w + 1 : rx0, nr = side > 0 ? rx1 : rx0 + w - 1;
        if (!freeSolid(nl, ny - 1, nr, ny - 1)) { ok = false; break; }
        plats.push({ nl, nr, ny, side });
        y = ny; side = -side;
      }
      if (!ok) continue;
      ensure(yTop + 6);
      carve(rx0, cur.y, rx1, yTop);
      for (let x = rx0; x <= rx1; x++) { const k = (cur.y - 1) * W + x; if (g[k] === AIR) { if (rs[k]) { g[k] = PLAT; rsol[k] = 1; } else put(x, cur.y - 1, ROCK); } }
      markHr(rx0, rx1, cur.y, 1);
      sign("zig", "Inside the mountain|Hop from ledge to ledge", cur.x * T, cur.y * T);
      const room0 = { l: rx0, r: rx1 };
      plats.forEach(({ nl, nr, ny, side }, i) => {
        const k = i + 1;
        const crum = D >= 2 && k > 1 && k < nn && R() < 0.25;
        for (let x = nl; x <= nr; x++) put(x, ny - 1, crum ? CRUM : ROCK);
        markHr(nl, nr, ny);
        const nd = { k: "jump", dir: side, tx: side > 0 ? (cur.r + 1) * T - 1 : cur.l * T + 1, x: ((nl + nr + 1) / 2) * T, y: ny * T, l: nl * T, r: (nr + 1) * T, t: "zig" };
        node(nd);
        if (k === 1) { nd.fl = Math.min(room0.l, cur.l) * T; nd.fr = (Math.max(room0.r, cur.r) + 1) * T; nd.from0 = true; nd.tx = side > 0 ? nl * T - PW - 3 : (nr + 1) * T + PW + 3; }
        if (R() < 0.5) lanterns.push({ x: (side > 0 ? rx1 + 0.75 : rx0 + 0.25) * T, y: ny * T + 30 });
        cur = { x: Math.floor((nl + nr) / 2), y: ny, l: nl, r: nr };
      });
      // huoneen ilma varataan: myöhemmät palat eivät saa tukkia hyppyjä
      for (let yy = plats[0].ny - 2; yy <= cur.y + 1; yy++) for (let x = rx0; x <= rx1; x++) { const k = yy * W + x; if (g[k] === AIR) rs[k] = 1; }
      if (D >= 2 && R() < 0.6) spawners.push({ x: ((rx0 + rx1 + 1) / 2) * T, y: (yTop - 1) * T, per: 3 + R() * 2, t: R() * 2, warn: false, gy: 0, drip: true });
      if (R() < 0.5) saus.push({ x: (cur.x + 0.5) * T, y: cur.y * T + 12, e: false });
      est += nn * 1.7 + 1.5;
      return true;
    }
    return false;
  }
  // heilautus: rotko on liian leveä hypättäväksi -> roikutaan ketjussa ja heilutaan yli
  function swing() {
    const w = 4;
    for (const gp of D >= 4 ? [6, 5] : [5]) for (const dir of [prefDir(), 0].map((d, i) => (i ? -1 : 1) * (d || 1))) {
      const nl = dir > 0 ? cur.r + 1 + gp : cur.l - gp - w, nr = nl + w - 1;
      if (nl < IN0 || nr > IN1) continue;
      if (!freeSolid(nl, cur.y - 2, nr, cur.y - 1) || !clearAir(nl, cur.y, nr, cur.y + 2)) continue;
      const gx0 = dir > 0 ? cur.r + 1 : nr + 1, gx1 = dir > 0 ? nl - 1 : cur.l - 1;
      if (!clearAir(gx0, cur.y - 1, gx1, cur.y + 4)) continue;
      ensure(cur.y + 8);
      carve(Math.min(cur.l, nl), cur.y, Math.max(cur.r, nr), cur.y + 4);
      carve(dir > 0 ? cur.r - 1 : nr + 1, cur.y - 9, dir > 0 ? nl - 1 : cur.l + 1, cur.y - 1);
      for (let x = nl; x <= nr; x++) { put(x, cur.y - 1, ROCK); put(x, cur.y - 2, ROCK); }
      reserve(gx0, cur.y - 8, gx1, cur.y + 3);
      markHr(nl, nr, cur.y);
      sign("swing", "Too far to jump!|Hang off the edge, swing with A/D, SPACE leaps", ((cur.l + cur.r + 1) / 2) * T - dir * T, cur.y * T);
      node({ k: "swing", dir, tx: dir > 0 ? (cur.r + 1) * T - 1 : cur.l * T + 1, x: ((nl + nr + 1) / 2) * T, y: cur.y * T, l: nl * T, r: (nr + 1) * T, t: "swing" });
      cur = { x: Math.floor((nl + nr) / 2), y: cur.y, l: nl, r: nr };
      est += 9;
      return true;
    }
    return false;
  }
  function pillars(n) {
    const ok = hop(n, { wmin: 1, wmax: 2, dy: R() < 0.5 ? 1 : 0, gmin: 2, gmax: 3, ice: true });
    if (ok) sign("wind", "Wind gusts!|Grip the rock when it blows", cur.x * T, cur.y * T);
    return ok;
  }
  // seinä tasanteen omalle ulkopäälle (kun vieressä ei ole tilaa)
  function wallOn(h, relax) {
    if (at(cur.x, cur.y - 1) === CRUM) return false;
    const inCur = (x, y) => x >= cur.l && x <= cur.r && y >= cur.y && y <= cur.y + 2;
    const dirs = IN1 - cur.r <= cur.l - IN0 ? [1, -1] : [-1, 1];
    for (const dir of dirs) for (const bw of [2, 1]) for (let hh = h; hh >= 3; hh--) {
      const wx0 = dir > 0 ? cur.r - bw + 1 : cur.l, wx1 = wx0 + bw - 1;
      const cc = dir > 0 ? wx0 - 1 : wx1 + 1;
      if (cc < cur.l || cc > cur.r) continue;
      const top = cur.y + hh;
      const prevN = route[route.length - 1];
      if (!rect(wx0, cur.y, wx1, top - 1, (x, y, k) => inb(x, y) && !rs[k] && (relax || !hr[k] || inCur(x, y)))) continue;
      if (!clearAir(cc, cur.y, cc, top + 3) || !clearAir(wx0, top, wx1, top + 2)) continue;
      ensure(top + 6);
      carve(cc, cur.y, cc, top + 3); carve(wx0, top, wx1, top + 3);
      fill(wx0, cur.y, wx1, top - 1, ROCK);
      reserve(cc, cur.y, cc, top + 3);
      // edellinen tasanne kapeni: sen kohde on nyt kiipeilysarake
      const fl0 = dir > 0 ? cur.l : cc, fr0 = dir > 0 ? cc : cur.r;
      prevN.x = ((fl0 + fr0 + 1) / 2) * T; prevN.l = fl0 * T; prevN.r = (fr0 + 1) * T;
      markHr(wx0, wx1, top);
      node({ k: "climb", side: dir, cc, fx: dir > 0 ? wx0 * T - PW : (wx1 + 1) * T + PW, x: ((wx0 + wx1 + 1) / 2) * T, y: top * T, l: wx0 * T, r: (wx1 + 1) * T, h: hh, t: "wall" });
      cur = { x: wx0, y: top, l: wx0, r: wx1, cc, dir };
      est += hh * 0.45 + 1.8;
      return true;
    }
    return false;
  }
  // pakko edetä: pieni seinä tai porras
  function force() {
    M.forced = (M.forced || 0) + 1;
    if (wall1(ri(3, 5))) return;
    if (stairsUp()) return;
    if (hop1({ dy: 1, w: 3, gmin: 1, gmax: 3 })) return;
    if (wallOn(ri(3, 5))) return;
    if (wallOn(3, true)) return;
    M.stuck = (M.stuck || 0) + 1;
  }
  // segmentin loppu: seinä, jonka kiipeilyreiän kohdalle tulee läpi päästävä luukku
  function finalWall() {
    for (let k = 0; k < 6; k++) { if (wall1(ri(5, 6))) return; if (!hop1({ dy: 1 })) force(); }
    force();
  }
  function floorAt(x0, x1) {
    const y = cur.y;
    for (let x = x0; x <= x1; x++) {
      const k1 = (y - 1) * W + x, k2 = (y - 2) * W + x;
      if (rs[k1]) { g[k1] = PLAT; rsol[k1] = 1; } else if (!hr[k1]) putF(x, y - 1, ROCK);
      if (!rs[k2] && !hr[k2]) putF(x, y - 2, ROCK);
    }
  }
  function hut(nextZone) {
    finalWall();
    const y = cur.y, cc = cur.cc;
    floorAt(IN0, IN1);
    for (let yy = y; yy <= y + 4; yy++) for (let x = IN0; x <= IN1; x++) { const k = yy * W + x; if (!rsol[k]) g[k] = AIR; }
    const hx = cc < mid ? IN1 - 5 : IN0 + 5;
    // majan paikka ja kulku luukulta majalle pidetään vapaana
    markHr(hx - 2, hx + 2, y, 5);
    markHr(cc - 1, cc + 1, y, 4);
    reserve(Math.min(cc, hx) , y, Math.max(cc, hx), y + 2);
    const cp = { x: hx * T + T / 2, y: y * T, i: cps.length, hatch: cc * T + T / 2 };
    cps.push(cp);
    saus.push({ x: (hx + (hx > cc ? -2 : 2)) * T + T / 2, y: y * T + 12, e: false });
    sign("hut", "Hut = checkpoint|Saves · refills stamina · +1 piton", (hx + (hx > cc ? -4 : 4)) * T, y * T);
    if (cps.length === 2) signs.push({ x: (hx + (hx > cc ? -8 : 8)) * T, y: y * T, t: "A storm follows you!|Climb on before it catches you", type: "storm" });
    route.push({ k: "walk", x: cp.x, y: y * T, l: IN0 * T, r: (IN1 + 1) * T, fy: y * T, fl: IN0 * T, fr: (IN1 + 1) * T, hut: cp.i });
    zone = nextZone;
    // uusi vyöhyke alkaa majan huoneen yläpuolelta
    for (let yy = y; yy <= y + 4; yy++) zr[yy] = zr[y - 1];
    if (filled > y + 5) {
      for (let yy = y + 5; yy < filled; yy++) { zr[yy] = zone; for (let x = 0; x < W; x++) { const k = yy * W + x; if (!rsol[k]) g[k] = zone === Z.cave ? ROCK : x < IN0 || x > IN1 ? SLAB : AIR; } }
    } else filled = y + 5;
    ensure(y + 8);
    cur = { x: hx, y, l: hx - 2, r: hx + 2 };
  }

  // --- segmentit ---
  const zones = zonesFor(D);
  const pickW = (a) => { const s = a.reduce((q, e) => q + e[1], 0); let v = R() * s; for (const e of a) { v -= e[1]; if (v <= 0) return e[0]; } return a[a.length - 1][0]; };
  let swingDone = 0;
  const RUN = {
    hop: () => hop(ri(2, 3), { gmin: D <= 1 ? 1 : 2, gmax: D <= 1 ? 3 : 4, ice: zone === Z.ice }),
    wall: () => wall1(ri(Math.min(5 + (D >> 1), 9), Math.min(7 + D, 12)), { crum: zone === Z.cliff && D >= 2 && R() < 0.5, rocks: zone === Z.cliff && D >= 2 && R() < 0.45 }),
    icewall: () => wall1(ri(7, Math.min(9 + D, 12)), { ice: true, rocks: D >= 4 && R() < 0.3 }),
    chim: () => chimney(ri(5, Math.min(7 + D, 11)), { allIce: zone === Z.ice }),
    zig: () => zigzag(ri(3, 3 + Math.min(3, D))),
    swing: () => { const ok = swing(); if (ok) swingDone++; return ok; },
    crum: () => { if (!hop(ri(3, 4), { crum: true, w: 2, dy: 2, gmin: 1, gmax: 2 })) return false; if (!hop1({ dy: 1, gmin: 1, gmax: 3 })) force(); return true; },
    pillars: () => pillars(ri(3, 4)),
  };
  zones.forEach(([zn, cnt], zi) => {
    zone = Z[zn];
    const y0 = cur.y;
    est = 0;
    ensure(cur.y + 8);
    let last = "";
    for (let c = 0; c < cnt; c++) {
      let opts;
      if (zone === Z.foot) opts = [["hop", 4], ["wall", D >= 2 ? 2 : 1.5]];
      else if (zone === Z.cliff) opts = [["wall", 4], ["hop", 2], ["chim", 1.2], ["swing", swingDone < 1 ? 2.5 : 1], ["crum", D >= 2 ? 1.5 : 0.6]];
      else if (zone === Z.cave) opts = [["zig", 4], ["chim", 2.5], ["wall", 1], ["swing", 1]];
      else if (zone === Z.ice) opts = [["icewall", 3.5], ["chim", 2.5], ["hop", 1.2], ["swing", 1]];
      else opts = [["pillars", 3.5], ["wall", 1.5], ["swing", 1]];
      opts = opts.filter((e) => e[0] !== last || e[0] === "hop" || e[0] === "zig");
      let t = pickW(opts);
      if (zone === Z.cave && c === 0) t = "zig";
      if (lv === 1 && zone === Z.cliff && c === 1) t = "swing";
      if (lv === 1 && zone === Z.foot && c === 0) t = "hop";
      const tryT = (name) => { const q = snap(); if (RUN[name]() && canContinue()) return true; restore(q); return false; };
      let ok = tryT(t);
      if (!ok) for (const [t2] of shuffle(opts.slice())) if (t2 !== t && tryT(t2)) { ok = true; t = t2; break; }
      if (!ok) for (const t2 of ["hop", "wall"]) if (tryT(t2)) { ok = true; t = t2; break; }
      if (!ok) force();
      last = t;
    }
    const isLast = zi === zones.length - 1;
    if (!isLast) {
      hut(Z[zones[zi + 1][0]]);
      segs.push({ y0: y0 * T, y1: cur.y * T, zone: Z[zn], est: est + 4 });
    } else {
      finalWall();
      const y = cur.y, cc = cur.cc;
      const sx0 = Math.max(IN0, Math.min(cur.l, cc) - 3), sx1 = Math.min(IN1, Math.max(cur.r, cc) + 3);
      floorAt(sx0, sx1);
      zone = Z.summit;
      for (let yy = y; yy < y + 30; yy++) { zr[yy] = Z.summit; for (let x = 0; x < W; x++) { g[yy * W + x] = AIR; rsol[yy * W + x] = 0; } }
      filled = y + 30;
      M.summit = { x0: sx0 * T, x1: (sx1 + 1) * T, y: y * T, gx: ((sx0 + sx1 + 1) / 2) * T, cc };
      route.push({ k: "walk", x: M.summit.gx, y: y * T, l: sx0 * T, r: (sx1 + 1) * T, fy: y * T, fl: sx0 * T, fr: (sx1 + 1) * T, summit: true });
      segs.push({ y0: y0 * T, y1: y * T, zone: Z[zn], est: est + 4 });
      // vuoren olkapäät: sivuseinät madaltuvat huipun alla
      for (let yy = y - 3; yy < y; yy++) for (const x of [0, 1, W - 2, W - 1]) if (!rsol[yy * W + x]) g[yy * W + x] = AIR;
    }
  });

  const TH = filled;
  M.TH = TH;
  M.grid = g.slice(0, W * TH);
  M.zr = zr.slice(0, TH);
  M.route = route; M.cps = cps; M.saus = saus; M.spawners = spawners; M.signs = signs; M.lanterns = lanterns; M.segs = segs;
  // murenevat kivet
  M.crumList = []; M.crumIdx = new Map();
  for (let y = 0; y < TH; y++) for (let x = 0; x < W; x++) if (M.grid[y * W + x] === CRUM) { M.crumIdx.set(y * W + x, M.crumList.length); M.crumList.push({ cx: x, cy: y, idx: y * W + x, st: 0, t: 0 }); }
  for (const s of spawners) { const cx = Math.floor(s.x / T); let cy = Math.min(TH - 1, Math.floor(s.y / T)); while (cy > 0 && tile(cx, cy) === AIR) cy--; s.gy = (cy + 1) * T; }
  // lakat: pieni sivutasanne reitin vieressä (vaatii hypyn sivuun)
  const bers = [];
  const free = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { if (x < IN0 || x > IN1 || y < 3 || y >= TH) return false; const k = y * W + x; if (rsol[k] || rs[k]) return false; } return true; };
  const cands = [];
  for (let i = 1; i < route.length; i++) {
    const n = route[i];
    if (n.k === "walk") continue;
    const cy = Math.round(n.y / T), l = Math.round(n.l / T), r = Math.round(n.r / T) - 1;
    for (const d of [1, -1]) {
      const ox0 = d > 0 ? r + 3 : l - 4, ox1 = ox0 + 1, oy = cy + 2;
      if (free(Math.min(ox0, d > 0 ? r + 1 : l - 2) , cy, Math.max(ox1, d > 0 ? r + 2 : l - 1), oy + 3) && !hr[(oy - 1) * W + ox0] && !hr[(oy - 1) * W + ox1]) cands.push({ i, ox0, ox1, oy, cy, d, l, r });
    }
  }
  for (const f of [0.22, 0.55, 0.85]) {
    if (!cands.length) break;
    let best = null, bd = 1e9;
    for (const c of cands) { const dd = Math.abs(c.i / route.length - f); if (dd < bd && !bers.some((b) => Math.abs(b.ri - c.i) < 4)) { bd = dd; best = c; } }
    if (!best) break;
    const c = best;
    for (let y = c.cy; y <= c.oy + 3; y++) for (let x = Math.min(c.ox0, c.d > 0 ? c.r + 1 : c.l - 2); x <= Math.max(c.ox1, c.d > 0 ? c.r + 2 : c.l - 1); x++) if (!rsol[y * W + x]) M.grid[y * W + x] = AIR;
    for (let x = c.ox0; x <= c.ox1; x++) M.grid[(c.oy - 1) * W + x] = ROCK;
    bers.push({ x: (c.ox0 + 1) * T, y: c.oy * T + 14, got: false, ri: c.i });
  }
  M.bers = bers;
  // myrskyn nopeus: segmentin korkeus / arvioitu aika
  const factor = clamp(3 - 0.2 * (D - 1), 1.8, 3);
  for (const s of segs) s.v = clamp((s.y1 - s.y0 + 10 * T) / (s.est * factor), 14, 70);
  // koristeet: kivenlohkareita ja kasveja tasanteille
  M.decor = decor;
  return M;
}

// ---------- törmäys ----------
function boxHit(x, y) {
  const x0 = Math.floor((x - PW) / T), x1 = Math.floor((x + PW - 0.01) / T);
  const y0 = Math.floor(y / T), y1 = Math.floor((y + PH - 0.01) / T);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) if (solidC(cx, cy)) return true;
  return false;
}
// läpi päästävä taso: kiinteä vain ylhäältä tultaessa
function platUnder(x, yFrom, yTo) {
  const top = Math.floor(yFrom / T + 1e-6) * T;
  if (!(yFrom >= top - 1e-6 && yTo < top)) return false;
  const cy = top / T - 1;
  const x0 = Math.floor((x - PW) / T), x1 = Math.floor((x + PW - 0.01) / T);
  for (let cx = x0; cx <= x1; cx++) if (tile(cx, cy) === PLAT) return true;
  return false;
}
function moveP(p, dt) {
  const along = (dx, dy) => {
    const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6);
    for (let i = 0; i < n; i++) {
      const sx = dx / n, sy = dy / n;
      if (!boxHit(p.x + sx, p.y + sy) && !(sy < 0 && platUnder(p.x + sx, p.y, p.y + sy))) { p.x += sx; p.y += sy; continue; }
      const m = Math.ceil(Math.max(Math.abs(sx), Math.abs(sy)));
      for (let j = 0; j < m; j++) {
        const ux = sx / m, uy = sy / m;
        if (boxHit(p.x + ux, p.y + uy) || (uy < 0 && platUnder(p.x + ux, p.y, p.y + uy))) return true;
        p.x += ux; p.y += uy;
      }
      return true;
    }
    return false;
  };
  if (along(p.vx * dt, 0)) p.vx = 0;
  p.ground = false;
  if (along(0, p.vy * dt)) { if (p.vy < 0) p.ground = true; p.vy = 0; }
  if (!p.ground && p.vy <= 0 && (boxHit(p.x, p.y - 1) || platUnder(p.x, p.y, p.y - 1))) p.ground = true;
}
function wallInfo(p, side, dy = 0) {
  const cx = Math.floor((p.x + side * (PW + 2)) / T), y = p.y + dy;
  const rl = Math.floor((y + 4) / T), rm = Math.floor((y + PH / 2) / T), ru = Math.floor((y + PH - 4) / T);
  const tl = tile(cx, rl), tm = tile(cx, rm), tu = tile(cx, ru);
  const s = (t) => t !== AIR && t !== PLAT;
  return { cx, any: s(tl) || s(tm) || s(tu), grip: gripT(tl) || gripT(tm) || gripT(tu), up: s(tu) || s(tm), low: s(tl), below: solidC(cx, Math.floor((y - 6) / T)), rows: [rl, rm, ru] };
}
function tileUnder(p) {
  const cy = Math.floor((p.y - 1) / T);
  for (const ox of [0, -PW + 1, PW - 1]) { const t = tile(Math.floor((p.x + ox) / T), cy); if (t !== AIR) return t; }
  return AIR;
}

// ---------- pelaajat ja tila ----------
function mkP(i, bot) {
  return { i, bot: !!bot, x: 0, y: 0, vx: 0, vy: 0, px: 0, py: 0, ground: true, cling: 0, st: 100, tired: false, face: 1, stun: 0, fallTop: 0, coyote: 0, climbing: false, hang: false, brace: false, atPiton: false,
    kickLock: 0, kickCd: 0, kickSide: 0, lunge: false, autoGrip: 0, slide: false, cold: 0, blockT: 0, prevD: 0, maxY: 0, leapT: 0, say: null };
}
const NOIN = { x: 0, y: 0, a: false, b: false, c: false, aP: false, bP: false, cP: false };
function newG(seed) {
  return { seed, t: 0, saus: 0, ber: 0, cp: 0, falls: 0, bigFalls: 0, topT: 0, pitLeft: 3, pitUsed: 0, pitons: [], rocks: [], wind: { s: 0, t: 6, dir: 1 }, resp: null,
    len: CHAIN, taut: false, storm: 0, stormOn: false, stormV: 20, resets: 0, stormClose: false, wantSave: false, bot: null, done: false };
}
const S = { P: [], G: newG(1), emit: () => {}, save: () => {}, finish: () => {}, isBot: () => false };

function anchoredW(p) {
  // 0 = ankkuri (pitää kiinni), 1 = vapaa
  if (p.cling || p.atPiton) return 0;
  if (p.ground) return 0;
  return 1;
}

function step(dt, inputs) {
  const { P, G } = S;
  G.t += dt;
  const ins = P.map((p) => inputs[p.i] || NOIN);
  if (P[1] && P[1].bot) ins[1] = botInput(P[1], P[0], dt);
  for (const p of P) { p.px = p.x; p.py = p.y; }
  for (const p of P) playerStep(p, ins[p.i], ins[p.i].a || p.autoGrip > 0, dt);
  if (P.length === 2) chainStep(ins, dt);
  crumbleStep(dt);
  rocksStep(dt);
  windStep(dt);
  stormStep(dt);
  if (G.done) return;
  // makkarat ja lakat
  for (const s of M.saus) {
    if (s.e) continue;
    const p = P.find((p) => Math.abs(p.x - s.x) < 22 && Math.abs(p.y + PH / 2 - s.y) < 30);
    if (p) { s.e = true; G.saus++; p.st = Math.min(100, p.st + 50); S.emit("eat", p.i, s.x, s.y); }
  }
  for (const b of M.bers) {
    if (b.got) continue;
    const p = P.find((p) => Math.abs(p.x - b.x) < 24 && Math.abs(p.y + PH / 2 - b.y) < 32);
    if (p) { b.got = true; G.ber++; S.emit("berry", p.i, b.x, b.y, G.ber); }
  }
  // majat
  for (const cp of M.cps) {
    if (cp.i <= G.cp) continue;
    if (P.some((p) => p.ground && Math.abs(p.y - cp.y) < 6)) {
      G.cp = cp.i; G.pitLeft = Math.min(5, G.pitLeft + 1); G.resp = { x: cp.x, y: cp.y };
      for (const p of P) { p.st = 100; p.tired = false; p.cold = 0; }
      const close = G.stormOn && G.storm > cp.y - 2.5 * T;
      startSegment();
      S.emit("cp", cp.i, cp.x, cp.y, close ? 1 : 0);
      G.wantSave = true;
    }
  }
  // korkein kohta (saavutukset)
  for (const p of P) if (!p.bot && p.y > p.maxY + T) { const d = p.y - p.maxY; p.maxY = p.y; S.emit("up", p.i, d); }
  // huippu: ihmispelaajat huipulla
  const sm = M.summit;
  const atTop = (p) => p.x > sm.x0 - PW && p.x < sm.x1 + PW && p.y >= sm.y - 2 && p.ground;
  const humans = P.filter((p) => !p.bot);
  if (humans.every(atTop)) { G.topT += dt; if (G.topT > 1.2) { G.done = true; S.finish(); return; } } else G.topT = 0;
  if (G.wantSave) { G.wantSave = false; S.save(); }
}

function startSegment() {
  const G = S.G, seg = M.segs[G.cp] || M.segs[M.segs.length - 1];
  const cp = M.cps[G.cp];
  G.storm = cp.y - 10 * T;
  G.stormOn = false;
  G.stormV = seg.v;
  G.stormClose = false;
}

function playerStep(p, inp, grip, dt) {
  const { P, G } = S;
  const o = P.length === 2 ? P[1 - p.i] : null;
  if (p.stun > 0) { p.stun -= dt; inp = NOIN; grip = false; }
  if (p.autoGrip > 0) { p.autoGrip -= dt; if (inp.bP || (inp.a && !p.cling)) p.autoGrip = 0; }
  if (inp.x) p.face = Math.sign(inp.x);
  p.kickLock = Math.max(0, p.kickLock - dt);
  p.kickCd = Math.max(0, p.kickCd - dt);
  p.leapT = Math.max(0, p.leapT - dt);
  if (p.lunge && p.vy < 150) p.lunge = false;
  const bm = p.bot ? 0.6 : 1;

  const sides = inp.x ? [Math.sign(inp.x), -Math.sign(inp.x)] : [p.face, -p.face];
  let wall = 0, wi = null, touch = 0;
  for (const s of sides) { const w = wallInfo(p, s); if (w.grip && !(p.kickLock > 0 && s === p.kickSide)) { wall = s; wi = w; break; } }
  for (const s of sides) if (wallInfo(p, s).any) { touch = s; break; }
  const was = p.cling;
  if (p.tired && p.st >= 35) p.tired = false;
  p.cling = grip && wall && !p.tired && p.st > 0 && !p.lunge && (!p.ground || inp.y < 0) ? wall : 0;
  // seinän yläreuna: noustaan tasanteelle
  if (was && grip && inp.y < 0) {
    const w = wallInfo(p, was);
    if (!w.up && (w.low || w.below)) { p.cling = 0; p.vy = 330; p.vx = was * 170; S.emit("mantle", p.i); }
  }
  p.climbing = false;
  p.slide = false;
  p.brace = p.ground && grip;
  p.atPiton = nearPiton(p);
  const wind = windForce(p);
  const carrying = o && o.hang && G.taut;

  if (p.cling) {
    const up = -inp.y;
    let vy = up * CLIMB;
    if (up > 0 && !wallInfo(p, p.cling, 6).grip) vy = 0; // jäähän ei voi kiivetä
    p.vy = vy; p.vx = 0; p.climbing = vy !== 0;
    for (const row of wi.rows) markCrum(wi.cx, row);
    if (p.atPiton && vy === 0) p.st = Math.min(100, p.st + 24 * dt);
    else if (!p.atPiton) {
      let drain = 4 + (vy > 0 ? 15 : vy < 0 ? 3 : 0);
      if (carrying) drain += 10;
      if (wind) drain += 10;
      p.st -= drain * bm * dt;
    }
    if (p.st <= 0) { p.st = 0; p.cling = 0; p.tired = true; S.emit("slip", p.i, p.x, p.y + PH); }
    else if (inp.bP) {
      const s = p.cling;
      if (inp.y < 0 && p.st > 12) { p.cling = 0; p.vy = 560; p.vx = 0; p.st -= 14 * bm; p.lunge = true; S.emit("lunge", p.i, p.x, p.y); }
      else if (p.st > 6) { p.cling = 0; p.vy = 470; p.vx = -s * 260; p.face = -s; p.st -= 7 * bm; p.kickLock = 0.22; p.kickSide = s; S.emit("jump", p.i); }
    }
  } else {
    const ice = p.ground && tileUnder(p) === ICE;
    const target = inp.x * WALK;
    if (p.hang && !p.ground) {
      // roikkuminen ketjussa: A/D heiluttaa, SPACE loikkaa
      p.vx += inp.x * 430 * dt;
      p.vy = Math.max(p.vy - GRAV * dt, -900);
      if (inp.bP && p.leapT <= 0) {
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 160 && Math.abs(p.vx) > 110) { p.vx *= 1.18; p.vy = Math.max(p.vy, 0) + 470; S.emit("leap", p.i, p.x, p.y + PH); }
        else { p.vy = 660; p.vx = Math.sign(o.x - p.x || 1) * 150; if (!o.atPiton) o.st = Math.max(0, o.st - 12); S.emit("toss", p.i, p.x, p.y + PH); }
        p.leapT = 0.45; p.hang = false;
      }
    } else {
      const acc = p.ground ? (ice ? 2.2 : 12) : p.kickLock > 0 ? 0 : 5;
      p.vx += (target - p.vx) * Math.min(1, acc * dt);
      p.vy = Math.max(p.vy - GRAV * dt, -900);
      if (!p.ground && touch && inp.x === touch && p.vy < -170) { p.vy = -170; p.slide = true; }
    }
    if (wind) p.vx += wind * (p.ground ? 900 : 1000) * dt * (p.brace ? 0.15 : 1);
    p.coyote = p.ground ? 0.1 : Math.max(0, p.coyote - dt);
    if (inp.bP && !(p.hang && !p.ground)) {
      if (p.ground || p.coyote > 0) { p.vy = JUMP; p.coyote = 0; S.emit("jump", p.i); }
      else if (touch && p.kickCd <= 0) {
        p.vy = 500; p.vx = -touch * 270; p.face = -touch; p.kickCd = 0.15; p.kickLock = 0.2; p.kickSide = touch;
        S.emit("kick", p.i, p.x + touch * PW, p.y + PH / 2);
      }
    }
    // maasta ketjuun: W ylempänä kiinni olevan kaverin alla
    if (p.ground && inp.y < 0 && !grip && o && anchoredW(o) === 0 && o.y - p.y > 1.5 * T) {
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d > 2.2 * T) { G.len = Math.min(CHAIN, d - 2); p.vy = 140; p.ground = false; p.hang = true; S.emit("grabChain", p.i); }
    }
    if (p.ground && p.cold <= 0) p.st = Math.min(100, p.st + 32 * dt);
  }
  if (inp.cP) placePiton(p);
  // lyhyt hyppy, jos nappi päästetään irti
  if (!inp.b && p.vy > 200 && !p.cling && !p.hang && !p.lunge && p.kickLock <= 0 && p.leapT <= 0) p.vy -= 1400 * dt;

  const wasGround = p.ground;
  moveP(p, dt);
  if (p.ground) for (const ox of [-PW + 1, 0, PW - 1]) markCrum(Math.floor((p.x + ox) / T), Math.floor((p.y - 1) / T));
  if (p.ground || p.cling || (p.hang && G.taut)) {
    const fall = p.fallTop - p.y;
    if (!wasGround && p.ground) {
      if (fall > 10 * T) { p.stun = 1.6; G.bigFalls++; G.falls++; S.emit("thud", p.i, p.x, p.y, 14, fall); }
      else if (fall > 5 * T) { p.stun = 0.7; G.falls++; S.emit("thud", p.i, p.x, p.y, 7, fall); }
      else if (fall > 1.5 * T) S.emit("land", p.x, p.y);
    }
    p.fallTop = p.y;
  } else p.fallTop = Math.max(p.fallTop, p.y);
}

function nearPiton(p) {
  if (!p.cling) return false;
  const hx = p.x + p.cling * (PW + 1), hy = p.y + PH * 0.7;
  return S.G.pitons.some((q) => q.s === p.cling && Math.abs(q.x - hx) < 6 && Math.abs(q.y - hy) < 30);
}
function placePiton(p) {
  const G = S.G;
  if (!p.cling) return S.emit("say", p.i, "Grip a rock wall first", "#ffd36a");
  if (G.pitLeft <= 0) return S.emit("say", p.i, "No pitons left!", "#ff8c6a");
  const hx = p.x + p.cling * (PW + 1), hy = p.y + PH * 0.7;
  if (G.pitons.some((q) => Math.hypot(q.x - hx, q.y - hy) < 40)) return S.emit("say", p.i, "There's a piton here", "#ffd36a");
  G.pitons.push({ x: Math.round(hx), y: Math.round(hy), s: p.cling });
  G.pitLeft--; G.pitUsed++;
  S.emit("piton", hx, hy, p.cling, p.i);
}

// ---------- ketju ----------
function tryMove(p, mx, my) {
  if (!boxHit(p.x + mx, p.y + my)) { p.x += mx; p.y += my; return true; }
  if (!boxHit(p.x + mx, p.y)) { p.x += mx; return false; }
  if (!boxHit(p.x, p.y + my)) { p.y += my; return false; }
  return false;
}
function chainStep(ins, dt) {
  const { P, G } = S;
  const [A, B] = P;
  for (const p of [A, B]) if (p.hang && !p.ground && !p.cling) {
    const inp = ins[p.i];
    if (inp.y < 0 && p.stun <= 0) { G.len = Math.max(CHAIN_MIN, G.len - (p.bot ? 150 : 135) * dt); p.st = Math.max(0, p.st - (p.bot ? 3 : 5) * dt); p.chainUp = true; }
    else if (inp.y > 0) G.len = Math.min(CHAIN, G.len + 140 * dt);
  }
  if (!(A.hang || B.hang)) G.len = Math.min(CHAIN, G.len + 220 * dt);
  const ax = A.x, ay = A.y + PH / 2, bx = B.x, by = B.y + PH / 2;
  const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy) || 1;
  const nx = dx / d, ny = dy / d;
  const over = d - G.len;
  G.taut = over > -2;
  const wa = anchoredW(A), wb = anchoredW(B);
  if (over > 0) {
    let rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny; // erkanemisnopeus
    let fa = 0.5, fb = 0.5;
    if (wa === 0 && wb === 1) { fa = 0; fb = 1; }
    else if (wb === 0 && wa === 1) { fa = 1; fb = 0; }
    else if (wa === 0 && wb === 0) {
      // molemmat kiinni: palautetaan se, joka liikkui poispäin
      const ma = (A.x - A.px) * -nx + (A.y - A.py) * -ny, mb = (B.x - B.px) * nx + (B.y - B.py) * ny;
      if (ma > mb) { fa = 1; fb = 0; } else { fa = 0; fb = 1; }
      rel = 0;
    }
    // nykäisy: vapaana putoava kaveri tempaisee
    if (rel > 320 && (fa === 0) !== (fb === 0)) {
      const anc = fa === 0 ? A : B, fal = fa === 0 ? B : A;
      if (anc.cling || anc.brace || anc.atPiton) {
        if (!anc.atPiton) anc.st -= rel * (anc.bot ? 0.025 : 0.035);
        if (anc.st <= 0) { anc.st = 0; anc.cling = 0; anc.tired = true; anc.autoGrip = 0; S.emit("ripped", anc.i, anc.x, anc.y + PH); fa = fb = 0.5; }
        else S.emit("catch", anc.i, fal.i, Math.round(rel));
      } else if (anc.ground && rel > 420) {
        // seisova kaveri ei jarruta: tempautuu mukaan
        anc.ground = false; anc.vy += 120; fa = fb = 0.5; S.emit("yank", anc.i, anc.x, anc.y + PH);
      } else S.emit("catch", anc.i, fal.i, Math.round(rel));
    }
    if (fa) tryMove(A, nx * over * fa, ny * over * fa);
    if (fb) tryMove(B, -nx * over * fb, -ny * over * fb);
    if (rel > 0) { A.vx += nx * rel * fa; A.vy += ny * rel * fa; B.vx -= nx * rel * fb; B.vy -= ny * rel * fb; }
  }
  // roikkuu = vapaa ja ketju kireällä kiinni olevassa kaverissa
  const d2 = Math.hypot(B.x - A.x, B.y + PH / 2 - (A.y + PH / 2));
  for (const [p, o] of [[A, B], [B, A]]) {
    const was = p.hang;
    p.hang = !p.ground && !p.cling && anchoredW(o) === 0 && d2 >= G.len - 3 && p.y < o.y + 12 && p.leapT <= 0;
    if (p.hang && !was) p.blockT = 0;
    // ketjun yläpäässä: kaveri vetää ylös tasanteelle tai seinälle
    if (p.hang && ins[p.i].y < 0) {
      if (d2 > p.prevD - 0.5) p.blockT += dt; else p.blockT = Math.max(0, p.blockT - dt);
      // ketju kelattu loppuun: kiivetään reunan yli kaverin viereen (myös jos reuna on välissä)
      if (((G.len <= CHAIN_MIN + 2 || p.blockT > 0.4) && d2 < 95) || (G.len <= CHAIN_MIN + 2 && p.blockT > 0.6 && d2 < 6.5 * T)) pullUp(p, o);
    }
    p.prevD = d2;
  }
}
function pullUp(p, o) {
  const G = S.G;
  if (o.ground) {
    for (const off of [24, -24, 40, -40, 56, -56, 0]) {
      const x = o.x + off * (p.x < o.x ? -1 : 1);
      if (!boxHit(x, o.y) && (boxHit(x, o.y - 2) || platUnder(x, o.y, o.y - 2))) {
        p.x = x; p.y = o.y; p.vx = p.vy = 0; p.ground = true; p.hang = false; p.fallTop = p.y; G.len = CHAIN;
        S.emit("pulled", p.i, p.x, p.y);
        return;
      }
    }
  } else if (o.cling) {
    const y = o.y - PH - 2;
    const t = { x: o.x, y };
    if (!boxHit(t.x, t.y) && wallInfo({ x: t.x, y: t.y }, o.cling).grip) {
      p.x = t.x; p.y = y; p.vx = p.vy = 0; p.cling = o.cling; p.autoGrip = 1.5; p.hang = false; p.fallTop = p.y;
      S.emit("pulled", p.i, p.x, p.y);
    }
  }
}

// ---------- ympäristö ----------
function markCrum(cx, cy) {
  const k = M.crumIdx.get(cy * W + cx);
  if (k == null) return;
  const c = M.crumList[k];
  if (c.st === 0) { c.st = 1; c.t = 0; S.emit("shake", c.cx * T + T / 2, c.cy * T + T / 2); }
}
function crumbleStep(dt) {
  const life = M.MT.D >= 4 ? 0.55 : 0.75;
  for (const c of M.crumList) {
    if (c.st === 1) {
      c.t += dt;
      if (c.t >= life) { c.st = 2; c.t = 0; M.grid[c.idx] = AIR; S.emit("crumble", c.cx * T + T / 2, c.cy * T + T / 2); }
    } else if (c.st === 2) {
      c.t += dt;
      if (c.t >= 6) {
        const x0 = c.cx * T, y0 = c.cy * T;
        const blocked = S.P.some((p) => p.x + PW > x0 && p.x - PW < x0 + T && p.y + PH > y0 && p.y < y0 + T);
        if (!blocked) { c.st = 0; c.t = 0; M.grid[c.idx] = CRUM; }
      }
    }
  }
}
function rocksStep(dt) {
  const G = S.G;
  for (const s of M.spawners) {
    if (!S.P.some((p) => p.y < s.y && s.y - p.y < 900 && Math.abs(p.x - s.x) < 600)) { s.warn = false; continue; }
    s.t += dt;
    if (!s.warn && s.t >= s.per - (s.drip ? 0.9 : 1.4)) { s.warn = true; S.emit("warn", s.x, s.gy); }
    if (s.t >= s.per) { s.t = 0; s.warn = false; G.rocks.push({ x: s.x + (Math.random() - 0.5) * 6, y: s.y, vy: -100, drip: !!s.drip }); }
  }
  for (const r of G.rocks) {
    r.vy -= 1200 * dt; r.y += r.vy * dt;
    if (r.y < -50 || solidAt(r.x, r.y - 9)) { r.dead = true; S.emit("rock", r.x, r.y); continue; }
    for (const p of S.P) {
      if (p.stun > 0) continue;
      if (Math.abs(p.x - r.x) < PW + 9 && r.y - 9 < p.y + PH && r.y + 9 > p.y) {
        r.dead = true; p.stun = 0.9; p.cling = 0; p.autoGrip = 0; p.vx = (p.x < r.x ? -1 : 1) * 160; p.vy = 100;
        S.emit("bonk", p.i, p.x, p.y + PH);
        break;
      }
    }
  }
  G.rocks = G.rocks.filter((r) => !r.dead);
}
const windy = (y) => { const z = zoneAt(y); return z === Z.ridge || (z === Z.ice && M.MT.D >= 4); };
function windStep(dt) {
  const G = S.G;
  if (!S.P.some((p) => windy(p.y))) { if (G.wind.s) { G.wind.s = 0; G.wind.t = 4; } return; }
  const w = G.wind;
  w.t -= dt;
  if (w.t > 0) return;
  if (w.s === 0) { w.s = 1; w.t = 1.4; w.dir = Math.random() < 0.5 ? -1 : 1; S.emit("windWarn", w.dir); }
  else if (w.s === 1) { w.s = 2; w.t = 1.8; S.emit("gust", w.dir); }
  else { w.s = 0; w.t = 4 + Math.random() * 5; S.emit("calm"); }
}
const windForce = (p) => (S.G.wind && S.G.wind.s === 2 && windy(p.y) ? S.G.wind.dir : 0);

// ---------- myrsky ----------
function stormStep(dt) {
  const G = S.G, P = S.P;
  const cp = M.cps[G.cp];
  if (!G.stormOn) {
    if (P.some((p) => p.y > cp.y + 3 * T)) { G.stormOn = true; S.emit("stormGo"); }
    return;
  }
  G.storm += G.stormV * dt;
  let reset = false;
  for (const p of P) {
    if (p.y + PH * 0.55 < G.storm) {
      p.cold += dt;
      p.st = Math.max(0, p.st - 30 * dt);
      if (p.cold > 3) reset = true;
    } else p.cold = Math.max(0, p.cold - dt * 1.5);
  }
  const lowest = Math.min(...P.map((p) => p.y));
  if (lowest - G.storm < 2 * T) G.stormClose = true;
  if (reset) stormReset();
}
function stormReset() {
  const G = S.G;
  G.resets++;
  S.emit("stormCaught");
  const cp = M.cps[G.cp];
  G.resp = { x: cp.x, y: cp.y };
  for (const p of S.P) placeAt(p, G.resp, p.i);
  G.len = CHAIN; G.rocks = [];
  startSegment();
}
function placeAt(p, r, i) {
  p.x = r.x + (i ? 22 : -22); p.y = r.y; p.vx = p.vy = 0;
  p.cling = 0; p.autoGrip = 0; p.fallTop = p.y; p.st = 100; p.tired = false; p.stun = 0; p.lunge = false; p.cold = 0; p.hang = false; p.ground = true;
}

// ---------- reitin seuraaja (botti ja testit) ----------
// Kenttägeneraattori tietää jokaisen palan: hypyn, seinän, kamiinin tai heilautuksen. Seuraaja ajaa ne yksi kerrallaan.
function blankIn() { return { x: 0, y: 0, a: false, b: false, c: false, aP: false, bP: false, cP: false }; }
function mkRunner(ri) { return { ri: ri || 1, ph: 0, t: 0, jt: 0, aim: 0, lost: 0, tries: 0, done: false }; }
function onLedge(p, n) { return p.ground && Math.abs(p.y - n.y) < 6 && p.x > n.l - PW + 1 && p.x < n.r + PW - 1; }
function onFrom(p, n) { return p.ground && Math.abs(p.y - n.fy) < 6 && p.x > n.fl - PW - 2 && p.x < n.fr + PW + 2; }
// mistä kohtaa reittiä jatketaan (pudotuksen jälkeen)
function locate(p, hint) {
  if (!p.ground) return -1;
  let best = -1;
  for (let j = 1; j < M.route.length; j++) {
    const n = M.route[j];
    if (onLedge(p, n) && j + 1 < M.route.length) { if (j + 1 <= hint + 1 || best < 0) best = Math.max(best, j + 1); }
    else if (onFrom(p, n)) { if (j <= hint + 1 || best < 0) best = Math.max(best, j); }
  }
  return best;
}
function exec(p, R, dt, opt = {}) {
  const inp = blankIn();
  const n = M.route[R.ri];
  if (!n) { R.done = true; return inp; }
  R.t += dt;
  const next = () => { R.ri++; R.ph = 0; R.t = 0; R.jt = 0; R.tries = 0; };
  const walkTo = (x) => { const dx = x - p.x; if (Math.abs(dx) > 7) inp.x = Math.sign(dx); return Math.abs(dx) <= 7; };
  // eksyikö? (putosi muualle)
  const inClimb = n.k === "climb" && Math.abs(p.x - n.fx) < 34 && p.y > n.fy - 4 && p.y < n.y;
  if (p.ground && R.t > 0.25 && !onFrom(p, n) && !onLedge(p, n) && !inClimb && !(n.k === "chim" && p.x > n.xl - 3 * T && p.x < n.xr + 3 * T && p.y >= n.fy - 4 && p.y <= n.top + 4)) {
    const j = locate(p, R.ri);
    R.lost++;
    if (j > 0) { R.ri = j; R.ph = 0; R.t = 0; R.jt = 0; return inp; }
    // ei tunnettua kohtaa: kävellään kohti reittiä ja hypätään, jos eteneminen pysähtyy
    inp.x = Math.sign(n.x - p.x);
    if (Math.abs(p.vx) < 20 && R.t > 0.6) { inp.b = inp.bP = true; R.t = 0.3; }
    return inp;
  }
  // levähdys seinällä
  if (p.cling && p.st < 22 && opt.pitons && S.G.pitLeft > 0 && !p.atPiton) { inp.a = true; inp.cP = true; return inp; }
  if (p.cling && p.atPiton && (p.st < 92 && R.rest)) { inp.a = true; if (p.st >= 90) R.rest = false; return inp; }
  if (p.cling && p.atPiton && p.st < 40) { R.rest = true; inp.a = true; return inp; }
  switch (n.k) {
    case "walk":
      if (walkTo(n.x) && p.ground) next();
      break;
    case "jump": case "swing": {
      if (n.k === "swing" && opt.teleportSwing && p.ground && onFrom(p, n)) { p.x = n.x; p.y = n.y; p.vx = p.vy = 0; p.fallTop = p.y; next(); break; }
      if (n.k === "swing" && !opt.teleportSwing) break;
      if (R.ph === 0) {
        if (!p.ground) break;
        if (n.from0) {
          const dx = n.tx - p.x;
          if (Math.abs(dx) > 4 || Math.abs(p.vx) > 60) { inp.x = Math.abs(dx) > 4 ? Math.sign(dx) : 0; break; }
          inp.b = inp.bP = true; R.ph = 1; R.jt = 0; break;
        }
        inp.x = n.dir;
        // hyppykohta: tasanteen reuna tai aiemmin, jos edessä on korkea askel
        const landEdge = n.dir > 0 ? n.l : n.r, rise = Math.max(0, n.y - p.y) + 4;
        const tr = (520 - Math.sqrt(Math.max(0, 520 * 520 - 3000 * rise))) / 1500;
        const v = Math.max(Math.abs(p.vx), 140);
        const jx = landEdge - n.dir * (PW + v * tr + 8);
        const tp = n.t === "zig" ? n.tx : n.dir > 0 ? Math.min(jx, n.tx) : Math.max(jx, n.tx);
        const ahead = (p.x - tp) * n.dir;
        const onCrum = tileUnder(p) === CRUM;
        if (ahead > 2 && !R.backed && Math.abs(p.vx) < 120 && !onCrum) R.backup = true;
        if (R.backup) { inp.x = -n.dir; if (ahead < -40 || !onFrom(p, n)) { R.backup = false; R.backed = true; } break; }
        if (ahead >= -2 - Math.abs(p.vx) * 0.02 || (onCrum && n.t !== "zig" && ahead > -40 && Math.abs(p.vx) > 100)) { inp.b = inp.bP = true; R.ph = 1; R.jt = 0; R.backed = false; }
      } else {
        R.jt += dt;
        inp.b = n.short ? R.jt < 0.08 : true;
        if (!p.ground) {
          const over = p.x > n.l + 4 && p.x < n.r - 4;
          if (over) { const dx = n.x - p.x; inp.x = Math.abs(dx) > 10 ? Math.sign(dx) : 0; } else inp.x = Math.sign(n.x - p.x) || n.dir;
          if (n.from0 && !over) inp.x = p.y > n.y + 2 ? Math.sign(n.x - p.x) : 0;
        } else if (R.jt > 0.12) {
          if (onLedge(p, n)) next(); else { R.ph = 0; R.tries++; }
        }
      }
      break;
    }
    case "climb": {
      if (onLedge(p, n)) { if (walkTo(n.x)) next(); break; }
      if (p.ground && !p.cling) {
        const w = wallInfo(p, n.side);
        inp.x = n.side;
        // kivisade: odotetaan, että kivi on juuri pudonnut
        const sp = n.rk != null ? M.spawners[n.rk] : null;
        if (sp && Math.abs(p.x - n.fx) < 40) {
          const tPass = Math.sqrt((2 * Math.max(0, sp.y - p.y)) / 1200) + 0.15, tTop = Math.sqrt((2 * Math.max(0, sp.y - n.y)) / 1200);
          const climbT = (n.y - p.y) / CLIMB + 0.6;
          const flying = S.G.rocks.some((r) => Math.abs(r.x - sp.x) < 30 && r.y > p.y);
          if (flying || sp.t < tPass || sp.t > sp.per + tTop - climbT) { inp.x = 0; break; }
        }
        if (w.grip || Math.abs(p.x - n.fx) < 4) { inp.a = true; inp.y = -1; }
        break;
      }
      // yläreunan yli noustessa irrotetaan ote, jotta laskeudutaan tasanteelle
      if (!p.cling && !p.ground && p.y >= n.y - 4) { inp.x = Math.abs(n.x - p.x) > 6 ? Math.sign(n.x - p.x) : 0; break; }
      inp.a = true; inp.y = -1; inp.x = n.side;
      if (p.cling && p.st > 14) {
        // jäävyö yläpuolella: syöksy (W + SPACE)
        const fcx = Math.floor((p.x + p.cling * (PW + 2)) / T);
        const iceUp = tile(fcx, Math.floor((p.y + PH + 6) / T)) === ICE || tile(fcx, Math.floor((p.y + PH / 2 + 12) / T)) === ICE;
        if (iceUp && !wallInfo(p, p.cling, 6).grip) { inp.b = inp.bP = true; }
      }
      if (!p.cling && !p.ground && p.vy < -60 && !p.lunge) inp.x = n.side;
      break;
    }
    case "chim": {
      inp.b = true;
      if (onLedge(p, n)) { if (walkTo(n.x)) next(); break; }
      const nearTop = p.y >= n.top - 8;
      // päädyttiin väärän pylvään päälle: hypätään kuilun yli uloskäynnille
      if (p.ground && Math.abs(p.y - n.top) < 6) {
        inp.x = n.exit;
        const edge = n.exit < 0 ? n.xr : n.xl;
        if ((n.exit < 0 && p.x - PW <= edge + 6) || (n.exit > 0 && p.x + PW >= edge - 6)) inp.bP = true;
        break;
      }
      if (p.ground) {
        // pohjalta: hypätään kohti seinää, joka ei ole uloskäynti
        const mid = (n.xl + n.xr) / 2;
        if (R.ph === 0) { R.aim = n.door ? -n.door : p.x < mid ? -1 : 1; inp.bP = true; R.ph = 1; }
        else { R.ph = 0; }
        inp.x = R.aim;
        break;
      }
      if (nearTop && !p.cling) { inp.x = R.aim || n.exit; break; }
      // kivipinnasta saa otteen: kiivetään; jäästä potkaistaan
      inp.a = true; inp.y = -1;
      if (p.cling && p.y >= n.top - 6 && p.cling === -n.exit) { inp.bP = true; R.aim = n.exit; inp.x = n.exit; break; } // ylhäältä loikka uloskäynnille
      if (p.cling) {
        const fcx = Math.floor((p.x + p.cling * (PW + 2)) / T);
        const iceUp = tile(fcx, Math.floor((p.y + PH + 6) / T)) === ICE || tile(fcx, Math.floor((p.y + PH / 2 + 12) / T)) === ICE;
        if (iceUp && !wallInfo(p, p.cling, 6).grip && p.st > 8) { inp.bP = true; R.aim = -p.cling; }
        inp.x = p.cling;
        break;
      }
      const tl = wallInfo(p, -1).any, tr = wallInfo(p, 1).any;
      const touchS = tl ? -1 : tr ? 1 : 0;
      // potku seinästä toiseen; viimeinen potku vastakkaiselta seinältä kohti uloskäyntiä
      if (touchS && wallInfo(p, touchS).grip && !(p.kickLock > 0 && p.kickSide === touchS)) inp.x = touchS; // kivi: tartutaan
      else if (touchS && p.kickCd <= 0 && p.vy < 420) { inp.bP = true; R.aim = -touchS; inp.x = -touchS; }
      else inp.x = R.aim || 1;
      if (!touchS && R.aim === n.exit && p.y >= n.top - 2) inp.x = n.exit;
      break;
    }
  }
  return inp;
}

// ---------- botti (yksinpelin kaveri) ----------
// Botti kulkee samaa reittiä pelaajan perässä, pitää kiinni kun pelaaja putoaa,
// kiipeää ketjua pitkin ja näyttää tietä, jos pelaaja jää jumiin.
function botInput(B, H, dt) {
  const G = S.G;
  const inp = blankIn();
  const bs = G.bot || (G.bot = { R: mkRunner(1), hIdx: 1, hold: 0, sayT: 2, stuckT: 0, bestY: H.y, crossT: 0, lead: 0, idleT: 0, by: B.y, bT: 0 });
  bs.sayT -= dt;
  const say = (m, t = 5) => { if (bs.sayT <= 0) { bs.sayT = t; S.emit("botSay", m); } };
  if (B.stun > 0) return inp;
  // pelaajan eteneminen reitillä
  const hj = locate(H, bs.hIdx);
  if (hj > 0) bs.hIdx = hj;
  const d = Math.hypot(H.x - B.x, H.y - B.y);
  const Hfree = !H.ground && !H.cling && !H.atPiton;
  const Hfalling = Hfree && !H.hang && H.vy < -220 && H.fallTop - H.y > 1.5 * T;
  // 1) pelaaja putoaa tai roikkuu: pidä kiinni
  if (!B.hang && (H.hang || (Hfalling && d > G.len - 90) || bs.hold > 0)) {
    if (H.hang || Hfalling) bs.hold = 0.4; else bs.hold -= dt;
    if (H.hang && bs.sayT <= 0 && Math.abs(H.vx) < 60) say(H.y < B.y - 2 * T ? "Got you! Hold W to climb the chain." : "Swing with A/D, SPACE to leap!", 6);
    inp.a = true;
    if (B.cling) inp.x = B.cling;
    return inp;
  }
  // 2) botti roikkuu: kiipeää ketjua
  if (B.hang) { inp.y = -1; return inp; }
  // pelaaja jumissa: botti saa mennä edelle
  if (H.y > bs.bestY + T * 0.8) { bs.bestY = H.y; bs.stuckT = 0; bs.lead = 0; }
  else if ((H.ground || H.cling) && !Hfree) bs.stuckT += dt;
  if (H.y < bs.bestY - 5 * T) bs.bestY = H.y;
  if (bs.stuckT > 12 && !bs.lead && bs.R.ri >= bs.hIdx) { bs.lead = 1; bs.stuckT = 0; say("Let me show you the way!"); }
  const R = bs.R;
  const n = M.route[R.ri];
  // botti on pelaajaa ylempänä ja kiinni: pelaaja voi kiivetä ketjua
  if (bs.lead && (B.ground || B.cling) && B.y - H.y > 2 * T) {
    inp.a = true; if (B.cling) inp.x = B.cling;
    say("I'm holding on. Hold W to climb the chain!", 6);
    if (H.y >= B.y - T) bs.lead = 0;
    return inp;
  }
  // 3) heilautus rotkon yli
  if (n && n.k === "swing") {
    if (onLedge(H, n) || (H.y >= n.y - 4 && H.x > n.l - PW && H.x < n.r + PW && H.ground)) {
      // pelaaja on jo toisella puolella: botti hyppää ketjun varaan, kun pelaaja jarruttaa
      if (onFrom(B, n)) {
        if (H.brace || H.cling || H.atPiton) { inp.x = n.dir; bs.crossT = 0; }
        else { bs.crossT += dt; say("Hold SHIFT so I can cross on the chain!", 5); walkToEdge(B, n, inp); }
        return inp;
      }
      // putosi rotkoon: kiipeää ketjua tai odottaa
      if (B.ground && anchoredW(H) === 0 && H.y - B.y > 1.5 * T) { inp.y = -1; return inp; }
      if (B.ground) { const j = locate(B, R.ri); if (j > 0) { R.ri = j; R.ph = 0; } }
      return inp;
    }
    // pelaaja ei ole vielä ylittänyt: botti odottaa reunalla
    if (onFrom(B, n)) {
      if (Hfree) { inp.a = true; return inp; }
      if (onFrom(H, n) && bs.sayT <= 0) say("Too far to jump. Hop off the edge, I'll hold you!", 7);
      walkToEdge(B, n, inp, 2.2 * T);
      return inp;
    }
  }
  // 4) seuraa reittiä pelaajan perässä (tai edellä, jos näyttää tietä)
  const limit = bs.hIdx + (H.ground ? 0 : 1) + (bs.lead ? 2 : 0);
  if (R.ri < limit && n && n.k !== "swing") {
    const e = exec(B, R, dt, { pitons: false });
    // jos ketju kiristyy ja pelaaja on alempana, ei vedetä pelaajaa irti: odotetaan
    if (!bs.lead && d > G.len - 12 && H.y < B.y - T && (H.cling || Hfree)) { const w = blankIn(); w.a = true; if (B.cling) w.x = B.cling; return w; }
    // jumissa: kiivetään ketjua, jos pelaaja on ylempänä kiinni
    if (Math.abs(B.y - bs.by) > T * 0.5 || B.cling) { bs.by = B.y; bs.bT = 0; } else bs.bT += dt;
    if (bs.bT > 5 && B.ground && anchoredW(H) === 0 && H.y - B.y > 1.5 * T && d > 2.2 * T) { bs.bT = 0; return Object.assign(blankIn(), { y: -1 }); }
    return e;
  }
  // 5) odottaa pelaajan lähellä (ja kiipeää ketjua, jos jää kauas alle)
  bs.idleT = B.ground ? bs.idleT + dt : 0;
  if (B.ground && bs.idleT > 2.5 && anchoredW(H) === 0 && H.y - B.y > 2 * T && d > 2.2 * T) { inp.y = -1; return inp; }
  if (B.ground && Math.abs(H.y - B.y) < T && Math.abs(H.x - B.x) > 2.5 * T) {
    const dir = Math.sign(H.x - B.x), fx = B.x + dir * (PW + 8);
    const below = Math.floor((B.y - 1) / T);
    if (solidC(Math.floor(fx / T), below) || tile(Math.floor(fx / T), below) === PLAT) inp.x = dir;
  }
  return inp;
}
function walkToEdge(B, n, inp, keep = 0.6 * T) {
  const ex = n.dir > 0 ? n.fr : n.fl;
  const want = ex - n.dir * keep;
  const dx = want - B.x;
  if (Math.abs(dx) > 6) inp.x = Math.sign(dx);
}

root.CC = {
  T, PW, PH, GRAV, JUMP, CLIMB, WALK, AIR, ROCK, ICE, CRUM, PLAT, SLAB, W, IN0, IN1, CHAIN, CHAIN_MIN, Z, ZNAME, MOUNTS,
  M, S, mountain, zonesFor, buildMap, tile, solidC, solidAt, zoneAt, boxHit, moveP, wallInfo, tileUnder, mkP, newG, step, placeAt, startSegment, stormReset,
  exec, mkRunner, locate, botInput, anchoredW, NOIN, blankIn, clamp, mulberry32, windForce, windy, gripT,
};
})(typeof window !== "undefined" ? window : globalThis);
