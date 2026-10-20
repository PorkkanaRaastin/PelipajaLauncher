// Pelipajan minipelien yhteinen pohja
//
// Jokainen minipeli kutsuu Mini.run({...}). Pohja hoitaa:
//   - canvasin (960 × 600, skaalautuu ikkunaan), näppäimet ja pelisilmukan
//   - aloitusruudun, tauon (Esc / P), loppuruudun ja uuden pelin (R)
//   - ennätykset (localStorage, käyttäjäkohtainen) ja äänet (M = äänet pois/päälle)
//   - Save & End Game -tuen (window.rrSaveGame)
(() => {
  const W = 960;
  const H = 600;
  const C = {
    bg: "#101318",
    panel: "#171b22",
    panel2: "#1d222b",
    line: "#2a313c",
    text: "#eef1f5",
    muted: "#8b94a3",
    accent: "#3fbf5f",
    accentDark: "#2a8c43",
    p1: "#3fbf5f",
    p2: "#f0b429",
    danger: "#e5534b",
    blue: "#4aa3ff",
  };
  const FONT = '"Segoe UI", system-ui, sans-serif';

  // ---------- canvas ----------
  const style = document.createElement("style");
  style.textContent = `html,body{margin:0;height:100%;background:${C.bg};overflow:hidden}
    canvas{display:block;width:100vw;height:100vh;cursor:default}`;
  document.head.appendChild(style);
  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let scale = 1, ox = 0, oy = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    scale = Math.min(canvas.width / W, canvas.height / H);
    ox = (canvas.width - W * scale) / 2;
    oy = (canvas.height - H * scale) / 2;
  }
  addEventListener("resize", resize);
  resize();

  // ---------- näppäimet ----------
  const down = new Set();
  const hit = new Set();
  const BLOCK = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"];
  addEventListener("keydown", (e) => {
    if (BLOCK.includes(e.code)) e.preventDefault();
    if (!down.has(e.code)) hit.add(e.code);
    down.add(e.code);
    audio(); // selain sallii äänet vasta käyttäjän painalluksen jälkeen
  });
  addEventListener("keyup", (e) => down.delete(e.code));
  addEventListener("blur", () => {
    down.clear();
    if (state === "play") state = "pause";
  });
  const key = (...codes) => codes.some((c) => down.has(c));
  const pressed = (...codes) => codes.some((c) => hit.has(c));

  // hiiri pelikoordinaatteina
  const mouse = { x: W / 2, y: H / 2, down: false, clicked: false, moved: false };
  canvas.addEventListener("mousemove", (e) => {
    const dpr = window.devicePixelRatio || 1;
    mouse.x = (e.clientX * dpr - ox) / scale;
    mouse.y = (e.clientY * dpr - oy) / scale;
    mouse.moved = true;
  });
  canvas.addEventListener("mousedown", () => {
    mouse.down = mouse.clicked = true;
    audio();
  });
  addEventListener("mouseup", () => (mouse.down = false));

  // ---------- äänet ----------
  let ac = null;
  let muted = false;
  try {
    muted = localStorage.getItem("mini:muted") === "1";
  } catch {}
  function audio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
      } catch {}
    }
    if (ac && ac.state === "suspended") ac.resume();
  }
  function beep(freq = 440, dur = 0.08, type = "square", vol = 0.05, slide = 0) {
    if (muted || !ac) return;
    const t = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ---------- piirtoapurit ----------
  function text(str, x, y, size = 20, color = C.text, align = "left", weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(str, x, y);
  }
  function rect(x, y, w, h, color, r = 0) {
    ctx.fillStyle = color;
    if (!r) return ctx.fillRect(x, y, w, h);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }
  function circle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function grid(step = 40, color = "rgba(255,255,255,0.025)") {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
    }
    for (let y = step; y < H; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
    }
    ctx.stroke();
  }
  function keycap(label, x, y, color = C.text) {
    ctx.font = `700 14px ${FONT}`;
    const w = Math.max(28, ctx.measureText(label).width + 16);
    rect(x, y - 14, w, 28, C.panel2, 6);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y - 13.5, w - 1, 27, 6);
    ctx.stroke();
    text(label, x + w / 2, y + 1, 14, color, "center");
    return w;
  }

  // Erän tulos tms. keskelle ruutua taustalaatan kanssa
  function banner(str, color = C.text, y = H / 2) {
    ctx.font = `800 30px ${FONT}`;
    const w = ctx.measureText(str).width + 56;
    rect(W / 2 - w / 2, y - 32, w, 64, "rgba(16,19,24,0.88)", 14);
    rect(W / 2 - w / 2, y + 28, w, 4, color, [0, 0, 14, 14]);
    text(str, W / 2, y, 30, color, "center", 800);
  }

  // ---------- ennätykset ----------
  let gameId = "mini";
  function best() {
    try {
      return Number(localStorage.getItem(`mini:${gameId}:best`)) || 0;
    } catch {
      return 0;
    }
  }
  function submitScore(score, lowerIsBetter = false) {
    const b = best();
    const better = b === 0 ? score > 0 : lowerIsBetter ? score < b : score > b;
    if (better) {
      try {
        localStorage.setItem(`mini:${gameId}:best`, String(score));
      } catch {}
    }
    return better;
  }

  // ---------- pelin tila ----------
  let game = null;
  let state = "menu"; // menu | play | pause | over
  let result = null; // { title, lines, color }
  let shakeT = 0;
  let shakeAmp = 0;
  const cover = location.hash === "#cover";

  function start() {
    game.reset();
    state = "play";
    result = null;
    beep(520, 0.07, "square", 0.04, 200);
  }
  function over(r) {
    if (state !== "play") return;
    state = "over";
    result = r;
    beep(220, 0.35, "sawtooth", 0.05, -150);
  }
  function shake(amp = 6, t = 0.2) {
    shakeAmp = amp;
    shakeT = t;
  }

  function overlay() {
    ctx.fillStyle = "rgba(10,12,16,0.72)";
    ctx.fillRect(0, 0, W, H);
    const pw = 560;
    const lines = state === "over" ? result.lines || [] : [];
    const ctrl = state === "menu" ? game.controls || [] : [];
    const ph = 190 + lines.length * 30 + ctrl.length * 38 + (state === "menu" && game.description ? 30 : 0);
    const px = (W - pw) / 2;
    const py = (H - ph) / 2;
    rect(px, py, pw, ph, C.panel, 16);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(px + 0.5, py + 0.5, pw - 1, ph - 1, 16);
    ctx.stroke();
    rect(px, py, pw, 5, state === "over" ? result.color || C.accent : C.accent, [16, 16, 0, 0]);

    let y = py + 52;
    if (state === "menu") {
      text(game.players === 2 ? "2 PLAYERS · SAME COMPUTER" : "1 PLAYER", W / 2, y - 18, 12, C.muted, "center", 800);
      text(game.title, W / 2, y + 12, 38, C.text, "center", 800);
      y += 52;
      if (game.description) {
        text(game.description, W / 2, y, 15, C.muted, "center", 500);
        y += 30;
      }
      for (const row of ctrl) {
        // [kenen, [näppäimet], mitä tekee, väri]
        const [who, keys, what, color] = row;
        let x = px + 40;
        if (who != null) {
          if (who) text(who, x, y + 6, 14, color || C.text, "left", 800);
          x += 90;
        }
        for (const k of keys) x += keycap(k, x, y + 6, color || C.text) + 6;
        text(what, x + 8, y + 6, 14, C.muted, "left", 500);
        y += 38;
      }
      y += 16;
      if (game.players === 1 && best() > 0) {
        text(`Best: ${game.formatScore ? game.formatScore(best()) : best()}`, W / 2, y, 15, C.accent, "center", 700);
        y += 26;
      } else y += 10;
      text("Press SPACE or ENTER to start", W / 2, y + 8, 16, C.text, "center", 700);
    } else if (state === "pause") {
      text("Paused", W / 2, y + 12, 36, C.text, "center", 800);
      text("Esc / P = resume   ·   R = restart   ·   M = sound", W / 2, y + 70, 15, C.muted, "center", 500);
      text(muted ? "Sound: off" : "Sound: on", W / 2, y + 100, 14, C.muted, "center", 500);
    } else if (state === "over") {
      text(result.title, W / 2, y + 12, 36, result.color || C.text, "center", 800);
      y += 64;
      for (const l of lines) {
        text(l, W / 2, y, 17, C.text, "center", 600);
        y += 30;
      }
      text("SPACE / ENTER = new game", W / 2, y + 24, 15, C.muted, "center", 600);
    }
  }

  function frame(dt) {
    // yleiset näppäimet
    if (pressed("KeyM")) {
      muted = !muted;
      try {
        localStorage.setItem("mini:muted", muted ? "1" : "0");
      } catch {}
    }
    if (state === "menu" || state === "over") {
      if (pressed("Space", "Enter", "NumpadEnter") || (mouse.clicked && state === "menu")) start();
    } else if (state === "play") {
      if (pressed("Escape", "KeyP")) state = "pause";
      else if (pressed("KeyR")) start();
      else game.update(dt);
    } else if (state === "pause") {
      if (pressed("Escape", "KeyP", "Space", "Enter")) state = "play";
      else if (pressed("KeyR")) start();
    }

    // piirto
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0b0d11";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let sx = 0, sy = 0;
    if (shakeT > 0) {
      shakeT -= dt;
      sx = (Math.random() - 0.5) * shakeAmp * 2;
      sy = (Math.random() - 0.5) * shakeAmp * 2;
    }
    ctx.setTransform(scale, 0, 0, scale, ox + sx * scale, oy + sy * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    rect(0, 0, W, H, C.bg);
    game.draw(ctx, state);
    ctx.restore();
    if (!cover && state !== "play") overlay(); // kansikuvatilassa (#cover) pelkkä pelinäkymä
    hit.clear();
    mouse.clicked = false;
  }

  let last = 0;
  function loop(t) {
    const dt = Math.min(1 / 30, (t - last) / 1000 || 0);
    last = t;
    frame(dt);
    requestAnimationFrame(loop);
  }

  // Save & End Game: ennätykset tallentuvat heti, joten tässä ei tarvitse tehdä muuta
  window.rrSaveGame = () => true;

  window.Mini = {
    W, H, C, FONT, ctx, key, pressed, mouse, beep, text, rect, banner, circle, grid, keycap, best, submitScore, over, shake,
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    get state() {
      return state;
    },
    run(g) {
      game = g;
      gameId = g.id;
      document.title = g.title;
      game.reset();
      if (cover && game.coverSetup) game.coverSetup();
      requestAnimationFrame(loop);
    },
  };
})();
