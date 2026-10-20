// Pelipajan co-op-pohja: kaksinpeli samalla koneella tai netissä liittymiskoodilla.
//
// Peli antaa Coop.start({...}) -kutsulle oman logiikkansa:
//   game.init(seed, level)     rakentaa maailman (sama siemen -> sama maailma molemmilla koneilla)
//   game.step(dt, inputs)      pelilogiikka (ajetaan vain isännällä tai samalla koneella pelattaessa)
//   game.snapshot()            pelitilanne kaverille (20 kertaa sekunnissa)
//   game.apply(snap)           kaveri ottaa pelitilanteen vastaan
//   game.render(dt, now)       piirto (molemmilla)
//   game.onEvent(name, args)   äänet ja efektit, jotka Coop.emit() välittää myös kaverille
//
// Syötteet: inputs[i] = { x, y, a, b, aP, bP }  (x/y -1..1, a/b pohjassa, aP/bP = painettiin juuri)
// Isäntä pyörittää koko pelin. Kaveri lähettää vain näppäimensä.
(() => {
  "use strict";
  const PREFIX = "rr-pelipaja-";
  const CODE_CH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  let cfg = null;
  let game = null;
  const C = {
    mode: "local", // local | host | client
    me: 0, // nettipelissä oma pelaaja (isäntä 0, kaveri 1)
    phase: "menu", // menu | play | pause | end
    level: 1,
    seed: 0,
    inputs: [blankInput(), blankInput()],
  };
  function blankInput() {
    return { x: 0, y: 0, a: false, b: false, ac: 0, bc: 0, aP: false, bP: false };
  }

  // ---------- näppäimet ----------
  const down = new Set();
  const counts = { a: [0, 0], b: [0, 0] };
  let keys = null;
  function keyset(i) {
    return keys[i];
  }
  function onKey(e, isDown) {
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT") return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(e.code)) e.preventDefault();
    if (isDown && !down.has(e.code)) {
      // painallukset lasketaan, ettei lyhyt napautus huku nettipelissä
      for (const i of [0, 1]) {
        if (keyset(i).a.includes(e.code)) counts.a[i]++;
        if (keyset(i).b.includes(e.code)) counts.b[i]++;
      }
      if (e.code === "Escape" && (C.phase === "play" || C.phase === "pause")) setPause(C.phase === "play");
      if (e.code === "KeyM") toggleMute();
    }
    if (isDown) down.add(e.code);
    else down.delete(e.code);
  }
  addEventListener("keydown", (e) => onKey(e, true));
  addEventListener("keyup", (e) => onKey(e, false));
  addEventListener("blur", () => down.clear());

  const any = (codes) => codes.some((c) => down.has(c));
  function readKeys(i, merged) {
    const ks = merged ? mergedKeys() : keyset(i);
    const x = (any(ks.right) ? 1 : 0) - (any(ks.left) ? 1 : 0);
    const y = (any(ks.down) ? 1 : 0) - (any(ks.up) ? 1 : 0);
    const inp = { x, y, a: any(ks.a), b: any(ks.b), ac: merged ? counts.a[0] + counts.a[1] : counts.a[i], bc: merged ? counts.b[0] + counts.b[1] : counts.b[i] };
    // peliohjain: samalla koneella ohjain 1 = pelaaja 1, ohjain 2 = pelaaja 2; netissä ensimmäinen ohjain
    const pad = pads()[merged ? 0 : i];
    if (pad) {
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const b = (n) => !!(pad.buttons[n] && pad.buttons[n].pressed);
      if (Math.abs(ax) > 0.25) inp.x = ax;
      if (Math.abs(ay) > 0.25) inp.y = ay;
      if (b(14)) inp.x = -1;
      if (b(15)) inp.x = 1;
      if (b(12)) inp.y = -1;
      if (b(13)) inp.y = 1;
      const pa = b(0) || b(5), pb = b(1) || b(2) || b(4);
      const key = merged ? 0 : i;
      if (pa && !padPrev.a[key]) counts.a[key]++;
      if (pb && !padPrev.b[key]) counts.b[key]++;
      padPrev.a[key] = pa;
      padPrev.b[key] = pb;
      inp.a = inp.a || pa;
      inp.b = inp.b || pb;
      inp.ac = merged ? counts.a[0] + counts.a[1] : counts.a[i];
      inp.bc = merged ? counts.b[0] + counts.b[1] : counts.b[i];
    }
    return inp;
  }
  const padPrev = { a: [false, false], b: [false, false] };
  function pads() {
    try {
      return [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter((p) => p && p.connected);
    } catch {
      return [];
    }
  }
  function mergedKeys() {
    const u = (k) => keys[0][k].concat(keys[1][k]);
    return { left: u("left"), right: u("right"), up: u("up"), down: u("down"), a: u("a"), b: u("b") };
  }
  // painallukset (aP/bP) lasketaan isännällä edellisen askeleen laskureista
  const prevCounts = [{ ac: 0, bc: 0 }, { ac: 0, bc: 0 }];
  function finishInput(i, raw) {
    const p = prevCounts[i];
    const out = { x: clamp(+raw.x || 0, -1, 1), y: clamp(+raw.y || 0, -1, 1), a: !!raw.a, b: !!raw.b, ac: raw.ac | 0, bc: raw.bc | 0 };
    out.aP = out.ac !== p.ac;
    out.bP = out.bc !== p.bc;
    p.ac = out.ac;
    p.bc = out.bc;
    return out;
  }

  // ---------- äänet ----------
  let AC = null, master = null, muted = false;
  try {
    muted = localStorage.getItem("coop:muted") === "1";
  } catch {}
  function audio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain();
        master.gain.value = muted ? 0 : 0.6;
        master.connect(AC.destination);
      } catch {}
    }
    if (AC && AC.state === "suspended") AC.resume();
  }
  addEventListener("pointerdown", audio);
  addEventListener("keydown", audio);
  function toggleMute() {
    muted = !muted;
    try {
      localStorage.setItem("coop:muted", muted ? "1" : "0");
    } catch {}
    if (master) master.gain.value = muted ? 0 : 0.6;
    toast(muted ? "Sound off" : "Sound on", 900, true);
  }
  function tone(f, d = 0.1, type = "square", v = 0.08, f2 = null, delay = 0) {
    if (!AC || muted) return;
    const t = AC.currentTime + delay;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + d);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + d);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + d + 0.03);
  }
  function noise(v = 0.2, d = 0.2, freq = 1200) {
    if (!AC || muted) return;
    const t = AC.currentTime;
    const len = Math.floor(AC.sampleRate * d);
    const buf = AC.createBuffer(1, len, AC.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = AC.createBufferSource();
    s.buffer = buf;
    const f = AC.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    const g = AC.createGain();
    g.gain.value = v;
    s.connect(f).connect(g).connect(master);
    s.start(t);
  }

  // ---------- käyttöliittymä ----------
  function css(t) {
    const th = t || {};
    return `
    :root{--c-bg:${th.bg || "rgba(14,17,22,.86)"};--c-card:${th.card || "#171b22"};--c-ink:${th.ink || "#eef1f5"};--c-muted:${th.muted || "#9aa3b0"};
      --c-acc:${th.accent || "#3fbf5f"};--c-acc-ink:${th.accentInk || "#06210f"};--c-line:${th.line || "rgba(255,255,255,.1)"};
      --c-p1:${cfg.colors[0]};--c-p2:${cfg.colors[1]};--c-font:${th.font || '"Segoe UI",system-ui,sans-serif'};--c-display:${th.display || '"Segoe UI Black","Arial Black",system-ui,sans-serif'}}
    .co-ov{position:fixed;inset:0;display:grid;place-items:center;background:var(--c-bg);z-index:50;font-family:var(--c-font);color:var(--c-ink);padding:16px;overflow:auto}
    .co-ov[hidden],.co-hide{display:none!important}
    .co-card{width:min(760px,100%);background:var(--c-card);border:1px solid var(--c-line);border-radius:18px;padding:28px 30px;box-shadow:0 30px 80px rgba(0,0,0,.5);position:relative}
    .co-kick{font:800 12px var(--c-font);letter-spacing:.16em;text-transform:uppercase;color:var(--c-acc)}
    .co-card h1,.co-card h2{font-family:var(--c-display);margin:.15em 0 .2em;line-height:1.02}
    .co-card h1{font-size:clamp(38px,6vw,62px)}.co-card h2{font-size:clamp(28px,4vw,40px)}
    .co-card p{color:var(--c-muted);margin:.4em 0 .9em;line-height:1.5}
    .co-rules{margin:0 0 16px;padding:0;list-style:none;display:grid;gap:6px}
    .co-rules li{color:var(--c-ink);opacity:.9;font-size:14.5px;line-height:1.4;padding-left:18px;position:relative}
    .co-rules li::before{content:"";position:absolute;left:2px;top:.55em;width:7px;height:7px;border-radius:2px;background:var(--c-acc)}
    .co-ctl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 18px}
    .co-ctl>div{background:rgba(255,255,255,.04);border:1px solid var(--c-line);border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.7}
    .co-ctl b{display:flex;align-items:center;gap:8px;font-size:15px;margin-bottom:2px}
    .co-ctl b i{width:12px;height:12px;border-radius:50%}
    .co-ctl .r{color:var(--c-muted);font-size:12.5px}
    kbd{display:inline-block;min-width:18px;text-align:center;font:700 12px var(--c-font);padding:1px 6px;border-radius:5px;background:rgba(255,255,255,.1);border:1px solid var(--c-line);margin:0 1px}
    .co-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .co-btn{font:800 16px var(--c-font);border:0;border-radius:11px;padding:13px 20px;cursor:pointer;background:var(--c-acc);color:var(--c-acc-ink);box-shadow:0 4px 0 rgba(0,0,0,.35)}
    .co-btn:hover{filter:brightness(1.08)}.co-btn:active{transform:translateY(2px);box-shadow:0 2px 0 rgba(0,0,0,.35)}
    .co-btn.ghost{background:transparent;color:var(--c-ink);border:1px solid var(--c-line);box-shadow:none}
    .co-btn:disabled{opacity:.45;cursor:default}
    .co-btn:focus-visible,.co-in:focus-visible{outline:3px solid var(--c-ink);outline-offset:2px}
    .co-small{font-size:12.5px;color:var(--c-muted)}
    .co-code{font:900 34px var(--c-display);letter-spacing:.18em;margin:4px 0;user-select:text;-webkit-user-select:text}
    .co-in{font:800 24px var(--c-display);letter-spacing:.16em;text-transform:uppercase;width:170px;padding:8px 10px;border-radius:10px;border:1px solid var(--c-line);background:rgba(255,255,255,.06);color:var(--c-ink)}
    .co-status{min-height:22px;font-weight:700;margin:10px 0}.co-status.bad{color:#ff7a6b}
    .co-stats{display:grid;grid-template-columns:1fr auto;gap:6px 24px;margin:12px 0 18px;font-size:15px}
    .co-stats span:nth-child(even){font-weight:800;text-align:right}
    .co-stamp{position:absolute;right:24px;top:22px;transform:rotate(8deg);border:3px solid currentColor;font:900 15px var(--c-display);letter-spacing:.1em;padding:4px 10px;border-radius:6px}
    #coToast{position:fixed;left:50%;top:16%;transform:translate(-50%,-10px);background:rgba(10,12,16,.86);color:var(--c-ink);font:900 26px var(--c-display);padding:14px 26px;border-radius:14px;
      text-align:center;opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:60;max-width:90vw}
    #coToast small{display:block;font:700 14px var(--c-font);color:var(--c-muted);margin-top:4px}
    #coToast.on{opacity:1;transform:translate(-50%,0)}
    @media (max-width:640px){.co-ctl{grid-template-columns:1fr}}`;
  }
  function k(list) {
    return list.map((x) => `<kbd>${x}</kbd>`).join("");
  }
  function buildUi() {
    const st = document.createElement("style");
    st.textContent = css(cfg.theme);
    document.head.appendChild(st);
    const L = cfg.labels;
    const rules = (cfg.rules || []).map((r) => `<li>${r}</li>`).join("");
    const role = (i) => (cfg.roles ? `<div class="r">${cfg.roles[i]}</div>` : "");
    const wrap = document.createElement("div");
    wrap.innerHTML = `
    <div class="co-ov" id="coMenu"><div class="co-card">
      <div class="co-kick">${cfg.kicker || "Co-op · 2 players"}</div>
      <h1>${cfg.title}</h1>
      <p>${cfg.description || ""}</p>
      <ul class="co-rules">${rules}</ul>
      <div class="co-ctl">
        <div><b><i style="background:var(--c-p1)"></i>${cfg.names[0]}</b>${role(0)}${cfg.help[0]}</div>
        <div><b><i style="background:var(--c-p2)"></i>${cfg.names[1]}</b>${role(1)}${cfg.help[1]}</div>
      </div>
      <div class="co-row">
        <button class="co-btn" id="coLocal">Play on this computer</button>
        <button class="co-btn ghost" id="coNetBtn">Play online</button>
        <button class="co-btn ghost co-hide" id="coCont"></button>
      </div>
      <p class="co-small" style="margin-top:14px">Esc = pause · M = sound · gamepads work too</p>
    </div></div>
    <div class="co-ov" id="coNet" hidden><div class="co-card">
      <div class="co-kick">Online · two computers</div>
      <h2>Play online with a friend</h2>
      <p>One of you creates a game and gets a join code, the other types the code and joins. You both play on your own computer: ${L.move}, ${L.a} and ${L.b}.</p>
      <div class="co-ctl">
        <div><b><i style="background:var(--c-p1)"></i>Create game</b><div class="r">You play: ${cfg.names[0]}${cfg.roles ? " (" + cfg.roles[0].toLowerCase() + ")" : ""}</div>
          <button class="co-btn" id="coHost" style="margin-top:8px">Create game</button>
          <div id="coCodeWrap" hidden><div class="co-small" style="margin-top:10px">Join code</div><div class="co-code" id="coCode">·····</div>
          <button class="co-btn ghost" id="coCopy">Copy code</button></div></div>
        <div><b><i style="background:var(--c-p2)"></i>Join game</b><div class="r">You play: ${cfg.names[1]}${cfg.roles ? " (" + cfg.roles[1].toLowerCase() + ")" : ""}</div>
          <input class="co-in" id="coJoinCode" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false" style="margin-top:8px">
          <button class="co-btn" id="coJoin" style="margin-top:8px">Join</button></div>
      </div>
      <div class="co-status" id="coStatus" role="status"></div>
      <div class="co-row"><button class="co-btn co-hide" id="coNetStart">Start</button><button class="co-btn ghost" id="coNetBack">Back</button></div>
    </div></div>
    <div class="co-ov" id="coPause" hidden><div class="co-card" style="width:min(460px,100%)">
      <div class="co-kick">Paused</div><h2>Catch your breath</h2><p id="coPauseTxt">The game is waiting.</p>
      <div class="co-row"><button class="co-btn" id="coResume">Resume</button><button class="co-btn ghost" id="coQuit">Main menu</button></div>
    </div></div>
    <div class="co-ov" id="coResult" hidden><div class="co-card" style="width:min(560px,100%)">
      <div class="co-stamp" id="coStamp"></div>
      <div class="co-kick" id="coResKick"></div><h2 id="coResTitle"></h2><p id="coResText"></p>
      <div class="co-stats" id="coResStats"></div>
      <div class="co-row"><button class="co-btn" id="coNext"></button><button class="co-btn ghost" id="coResMenu">Main menu</button></div>
    </div></div>
    <div id="coToast"></div>`;
    document.body.appendChild(wrap);
    $("coLocal").onclick = () => {
      audio();
      C.mode = "local";
      begin(1);
    };
    $("coCont").onclick = () => {
      audio();
      C.mode = "local";
      begin(savedLevel());
    };
    $("coNetBtn").onclick = () => {
      audio();
      openNet();
    };
    $("coNetBack").onclick = closeNet;
    $("coHost").onclick = hostGame;
    $("coJoin").onclick = joinGame;
    $("coJoinCode").addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinGame();
    });
    $("coCopy").onclick = () => {
      const t = $("coCode").textContent;
      try {
        navigator.clipboard.writeText(t).then(() => ($("coCopy").textContent = "Copied!"), () => {});
      } catch {}
    };
    $("coNetStart").onclick = () => begin(1);
    $("coResume").onclick = () => setPause(false);
    $("coQuit").onclick = toMenu;
    $("coResMenu").onclick = toMenu;
    $("coNext").onclick = () => {
      if (C.mode === "client") return;
      begin(C.result && C.result.ok ? C.level + 1 : C.level);
    };
    refreshMenu();
  }
  function show(id) {
    for (const x of ["coMenu", "coNet", "coPause", "coResult"]) $(x).hidden = x !== id;
  }
  function savedLevel() {
    try {
      return Math.max(1, +localStorage.getItem(cfg.id + ":level") || 1);
    } catch {
      return 1;
    }
  }
  function refreshMenu() {
    const lv = savedLevel();
    const b = $("coCont");
    b.classList.toggle("co-hide", lv < 2);
    b.textContent = `Continue: ${cfg.levelName ? cfg.levelName(lv) : "level " + lv}`;
  }

  let toastT = 0;
  function toast(html, dur, local) {
    if (!local) emitNet("__toast", [html, dur]);
    const t = $("coToast");
    t.innerHTML = html;
    t.classList.add("on");
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove("on"), dur || 1600);
  }

  // ---------- pelin kulku ----------
  function begin(level) {
    C.level = level;
    C.seed = (Math.random() * 1e9) | 0;
    C.result = null;
    if (C.mode === "host") {
      net.ev = [];
      send({ t: "start", seed: C.seed, level });
    }
    startLocal();
  }
  function startLocal() {
    show(null);
    C.inputs = [blankInput(), blankInput()];
    // vanhat painallukset (esim. valikon Enter) eivät saa näkyä pelissä
    if (C.mode === "local") {
      prevCounts[0] = { ac: counts.a[0], bc: counts.b[0] };
      prevCounts[1] = { ac: counts.a[1], bc: counts.b[1] };
    } else {
      prevCounts[0] = { ac: counts.a[0] + counts.a[1], bc: counts.b[0] + counts.b[1] };
      prevCounts[1] = { ac: net.remote.ac | 0, bc: net.remote.bc | 0 };
    }
    game.init(C.seed, C.level);
    C.phase = "play";
    last = performance.now();
    acc = 0;
  }
  function setPause(on, fromNet) {
    if (on && C.phase !== "play") return;
    if (!on && C.phase !== "pause") return;
    if (!fromNet && C.mode !== "local") send({ t: on ? "pause" : "resume" });
    C.phase = on ? "pause" : "play";
    $("coPauseTxt").textContent = C.mode === "local" ? "The game is waiting." : fromNet ? "Your friend paused the game." : "The game is paused for both of you.";
    show(on ? "coPause" : null);
    last = performance.now();
    if (game.onPause) game.onPause(on);
  }
  function toMenu() {
    if (C.mode !== "local") {
      send({ t: "menu" });
      setTimeout(netCleanup, 250);
    }
    C.mode = "local";
    C.phase = "menu";
    if (game.onMenu) game.onMenu();
    refreshMenu();
    show("coMenu");
  }
  // isäntä/samalla koneella: tason loppu
  function end(r) {
    if (C.phase !== "play") return;
    C.phase = "end";
    C.result = r;
    if (r.ok) {
      try {
        if (C.level + 1 > savedLevel()) localStorage.setItem(cfg.id + ":level", String(C.level + 1));
      } catch {}
    }
    if (C.mode === "host") {
      net.ev = [];
      send({ t: "end", r });
    }
    showResult(r);
  }
  function showResult(r) {
    $("coResKick").textContent = r.kicker || "";
    $("coResTitle").textContent = r.title || "";
    $("coResText").textContent = (r.text || "") + (C.mode === "client" ? " Waiting for your friend to continue." : "");
    $("coStamp").textContent = r.stamp || (r.ok ? "SUCCESS" : "NOT THIS TIME");
    $("coStamp").style.color = r.ok ? "#58d46a" : "#ff6b5e";
    $("coResStats").innerHTML = (r.stats || []).map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join("");
    $("coNext").textContent = r.ok ? r.next || "Next" : r.retry || "Try again";
    $("coNext").classList.toggle("co-hide", C.mode === "client");
    show("coResult");
    (r.ok ? win : lose)();
    setTimeout(() => (C.mode !== "client" ? $("coNext") : $("coResMenu")).focus(), 50);
  }
  function win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, "triangle", 0.1, null, i * 0.12));
  }
  function lose() {
    [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, "triangle", 0.1, null, i * 0.16));
  }

  // efektit: isännällä toistetaan heti ja lähetetään kaverille seuraavan tilannekuvan mukana
  function emit(name, ...args) {
    if (C.mode === "client") return;
    if (game.onEvent) game.onEvent(name, args);
    emitNet(name, args);
  }
  function emitNet(name, args) {
    if (C.mode === "host" && net.connected && (C.phase === "play" || C.phase === "end")) net.ev.push([name, args]);
  }
  function playEvent(name, args) {
    if (name === "__toast") return toast(args[0], args[1], true);
    if (game.onEvent) game.onEvent(name, args);
  }

  // ---------- silmukka ----------
  const STEP = 1 / 60;
  let last = performance.now(), acc = 0;
  function simulate(dt) {
    acc = Math.min(acc + dt, 0.25);
    while (acc >= STEP) {
      acc -= STEP;
      let raw;
      if (C.mode === "local") raw = [readKeys(0, false), readKeys(1, false)];
      else {
        raw = [null, null];
        raw[0] = readKeys(0, true);
        raw[1] = net.remote;
      }
      C.inputs = [finishInput(0, raw[0]), finishInput(1, raw[1])];
      game.step(STEP, C.inputs);
      if (C.phase !== "play") break;
    }
  }
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (C.phase === "play") {
      if (C.mode === "client") clientInput(dt);
      else simulate(dt);
    }
    game.render(dt, now, C.phase);
    requestAnimationFrame(frame);
  }
  // isännän peli jatkuu, vaikka ikkuna olisi taustalla (selain pysäyttää silloin ruudunpäivityksen)
  setInterval(() => {
    if (document.hidden && C.mode === "host" && C.phase === "play") {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      simulate(dt);
    }
  }, 50);

  // ---------- nettipeli ----------
  const net = { peer: null, conn: null, connected: false, remote: blankInput(), ev: [], lastRx: 0, sendT: 0, inT: 0, lastSent: "", ping: 0, pingT: 0 };
  function send(o) {
    if (net.conn && net.conn.open) {
      try {
        net.conn.send(o);
      } catch {}
    }
  }
  function netCleanup() {
    const c = net.conn, p = net.peer;
    net.conn = null;
    net.peer = null;
    net.connected = false;
    try {
      c && c.close();
    } catch {}
    try {
      p && p.destroy();
    } catch {}
    C.mode = "local";
  }
  const hasNet = () => typeof window.Peer === "function" && typeof window.RTCPeerConnection === "function";
  function status(t, bad) {
    $("coStatus").textContent = t;
    $("coStatus").classList.toggle("bad", !!bad);
  }
  function netErr(err) {
    const m = {
      "peer-unavailable": "No game found with that code. Check the code and that your friend's game is open.",
      network: "Can't reach the relay server. Check your internet connection.",
      "server-error": "The relay server isn't responding right now. Try again in a moment.",
      "socket-error": "The relay server isn't responding right now. Try again in a moment.",
      "socket-closed": "Lost connection to the relay server.",
      webrtc: "A direct connection couldn't be opened. The network may be blocking it.",
    };
    return m[err && err.type] || "Connection error: " + ((err && (err.message || err.type)) || "unknown");
  }
  function netButtons(on) {
    $("coHost").disabled = !on;
    $("coJoin").disabled = !on;
  }
  function openNet() {
    show("coNet");
    $("coCodeWrap").hidden = true;
    $("coNetStart").classList.add("co-hide");
    netButtons(true);
    status("");
    if (!hasNet()) {
      netButtons(false);
      status("Online play isn't available in this window.", true);
    }
  }
  function closeNet() {
    netCleanup();
    show("coMenu");
    refreshMenu();
  }
  function newCode() {
    let c = "";
    for (let i = 0; i < 5; i++) c += CODE_CH[Math.floor(Math.random() * CODE_CH.length)];
    return c;
  }
  function hostGame() {
    if (!hasNet()) return;
    netCleanup();
    netButtons(false);
    $("coCodeWrap").hidden = true;
    status("Creating game…");
    const code = newCode();
    const peer = new Peer(PREFIX + cfg.id + "-" + code, { debug: 0 });
    net.peer = peer;
    peer.on("open", () => {
      if (net.peer !== peer) return;
      $("coCode").textContent = code;
      $("coCodeWrap").hidden = false;
      $("coCopy").textContent = "Copy code";
      status("Send the code to your friend. Waiting for them to join…");
    });
    peer.on("connection", (conn) => {
      if (net.peer !== peer) return;
      if (net.conn && net.conn.open) {
        conn.on("open", () => {
          conn.send({ t: "full" });
          setTimeout(() => conn.close(), 400);
        });
        return;
      }
      net.conn = conn;
      bind(conn, "host");
    });
    peer.on("error", (err) => {
      if (net.peer !== peer) return;
      if (err.type === "unavailable-id") {
        peer.destroy();
        net.peer = null;
        hostGame();
        return;
      }
      if (C.phase !== "menu" && net.connected) return netLost(netErr(err));
      status(netErr(err), true);
      netButtons(true);
    });
    peer.on("disconnected", () => {
      if (net.peer === peer && !peer.destroyed) {
        try {
          peer.reconnect();
        } catch {}
      }
    });
  }
  function joinGame() {
    if (!hasNet()) return;
    const code = $("coJoinCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 5) {
      status("The join code has 5 characters.", true);
      $("coJoinCode").focus();
      return;
    }
    netCleanup();
    netButtons(false);
    status("Connecting…");
    const peer = new Peer({ debug: 0 });
    net.peer = peer;
    peer.on("open", () => {
      if (net.peer !== peer) return;
      const conn = peer.connect(PREFIX + cfg.id + "-" + code, { reliable: true, serialization: "json" });
      net.conn = conn;
      bind(conn, "client");
      setTimeout(() => {
        if (net.conn === conn && !net.connected) {
          status("Couldn't connect. Check the code or try another network.", true);
          netCleanup();
          netButtons(true);
        }
      }, 15000);
    });
    peer.on("error", (err) => {
      if (net.peer !== peer) return;
      if (C.phase !== "menu" && net.connected) return netLost(netErr(err));
      status(netErr(err), true);
      netCleanup();
      netButtons(true);
    });
  }
  function bind(conn, role) {
    conn.on("open", () => {
      if (role === "client") conn.send({ t: "hello", v: cfg.netVersion });
    });
    conn.on("data", (d) => {
      if (net.conn === conn) onNet(d, role);
    });
    conn.on("close", () => {
      if (net.conn !== conn) return;
      if (C.phase === "menu" && !$("coNet").hidden) {
        status("Your friend left.", true);
        netCleanup();
        netButtons(true);
        $("coNetStart").classList.add("co-hide");
      } else if (net.connected) netLost("Your friend left the game or the connection dropped.");
    });
    conn.on("error", () => {});
  }
  function onNet(d, role) {
    if (!d || typeof d !== "object") return;
    net.lastRx = performance.now();
    if (role === "host") {
      switch (d.t) {
        case "hello":
          if (d.v !== cfg.netVersion) {
            send({ t: "bad" });
            status("Your friend has a different version of the game. Both of you should update Pelipaja.", true);
            return;
          }
          net.connected = true;
          C.mode = "host";
          C.me = 0;
          send({ t: "welcome" });
          status(`${cfg.names[1]} joined! Start when you're both ready.`);
          $("coNetStart").classList.remove("co-hide");
          $("coNetStart").focus();
          tone(1320, 0.09, "square", 0.07);
          break;
        case "in":
          net.remote = { x: +d.x || 0, y: +d.y || 0, a: !!d.a, b: !!d.b, ac: d.ac | 0, bc: d.bc | 0 };
          if (d.p != null) net.ping = d.p;
          break;
        case "ping":
          send({ t: "pong", ts: d.ts });
          break;
        case "pause":
          setPause(true, true);
          break;
        case "resume":
          setPause(false, true);
          break;
        case "menu":
          netLost("Your friend went back to the main menu.");
          break;
      }
    } else {
      switch (d.t) {
        case "welcome":
          net.connected = true;
          C.mode = "client";
          C.me = 1;
          status("Connected! Waiting for your friend to start…");
          tone(1320, 0.09, "square", 0.07);
          break;
        case "bad":
          status("Game versions don't match. Both of you should update Pelipaja.", true);
          break;
        case "full":
          status("The game already has two players.", true);
          break;
        case "start":
          C.seed = d.seed;
          C.level = d.level;
          C.result = null;
          startLocal();
          snapOk = false;
          break;
        case "s":
          if (C.phase === "play" || C.phase === "pause") {
            game.apply(d.s, !snapOk);
            snapOk = true;
            for (const e of d.ev || []) playEvent(e[0], e[1]);
          }
          break;
        case "end":
          if (C.phase === "menu") return;
          C.phase = "end";
          C.result = d.r;
          showResult(d.r);
          break;
        case "pong":
          net.ping = Math.round(performance.now() - d.ts);
          break;
        case "pause":
          setPause(true, true);
          break;
        case "resume":
          setPause(false, true);
          break;
        case "menu":
          netLost("Your friend went back to the main menu.");
          break;
      }
    }
  }
  let snapOk = false;
  function netLost(msg) {
    netCleanup();
    C.phase = "menu";
    if (game.onMenu) game.onMenu();
    refreshMenu();
    show("coMenu");
    toast("CONNECTION LOST<small>" + msg + "</small>", 3800, true);
  }
  function clientInput(dt) {
    const inp = readKeys(0, true);
    const sig = [inp.x.toFixed(2), inp.y.toFixed(2), inp.a, inp.b, inp.ac, inp.bc].join(",");
    net.inT -= dt;
    if (sig !== net.lastSent || net.inT <= 0) {
      send({ t: "in", x: inp.x, y: inp.y, a: inp.a, b: inp.b, ac: inp.ac, bc: inp.bc, p: net.ping });
      net.lastSent = sig;
      net.inT = 0.1;
    }
    net.pingT -= dt;
    if (net.pingT <= 0) {
      net.pingT = 2;
      send({ t: "ping", ts: performance.now() });
    }
  }
  // tilannekuva kaverille 20 kertaa sekunnissa
  setInterval(() => {
    if (C.mode === "host" && net.connected && (C.phase === "play" || C.phase === "pause")) {
      send({ t: "s", s: game.snapshot(), ev: net.ev });
      net.ev = [];
    }
  }, 50);
  // sydämenlyönti
  setInterval(() => {
    if (!net.connected) return;
    send({ t: "hb" });
    if (performance.now() - net.lastRx > 8000) netLost("Your friend isn't responding. Connection lost.");
  }, 1000);

  // ---------- julkinen rajapinta ----------
  window.Coop = Object.assign(C, {
    tone,
    noise,
    toast,
    emit,
    end,
    clamp,
    net,
    get localPlayers() {
      return C.mode === "local" ? [0, 1] : [C.me];
    },
    start(config) {
      cfg = Object.assign(
        {
          names: ["Player 1", "Player 2"],
          colors: ["#ff8a3d", "#33d1c4"],
          labels: { move: "WASD/arrows", a: "F/Enter", b: "Space" },
        },
        config
      );
      game = cfg.game;
      keys = cfg.keys || [
        { left: ["KeyA"], right: ["KeyD"], up: ["KeyW"], down: ["KeyS"], a: ["KeyF"], b: ["Space"] },
        { left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"], a: ["Enter", "NumpadEnter"], b: ["ShiftRight", "Numpad0"] },
      ];
      buildUi();
      if (game.preview) game.preview();
      requestAnimationFrame(frame);
      window.rrSaveGame = () => (game.save ? game.save() : true);
    },
  });
})();
