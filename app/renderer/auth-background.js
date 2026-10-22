// Pelipaja – kirjautumisruudun tausta: pajan piirustuspöytä.
// Ruutupaperille luonnostellut peliaiheiset piirrokset leijuvat hitaasti ylöspäin,
// ja alhaalta ahjon hehku nostaa kipinöitä.
(function () {
  const cv = document.getElementById("authCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, dpr = 1, raf = 0, last = performance.now();

  // Piirrokset viivoina (koordinaatit noin -1..1)
  const SHAPES = {
    pad(g) { g.beginPath(); g.moveTo(-0.6, -0.35); g.lineTo(0.6, -0.35); g.quadraticCurveTo(0.95, -0.35, 1, 0.1); g.lineTo(1.05, 0.45); g.quadraticCurveTo(1.05, 0.8, 0.75, 0.8); g.quadraticCurveTo(0.55, 0.8, 0.45, 0.55); g.lineTo(-0.45, 0.55); g.quadraticCurveTo(-0.55, 0.8, -0.75, 0.8); g.quadraticCurveTo(-1.05, 0.8, -1.05, 0.45); g.lineTo(-1, 0.1); g.quadraticCurveTo(-0.95, -0.35, -0.6, -0.35); g.stroke(); g.strokeRect(-0.62, -0.08, 0.1, 0.34); g.strokeRect(-0.74, 0.04, 0.34, 0.1); g.beginPath(); g.arc(0.5, -0.02, 0.07, 0, 7); g.moveTo(0.73, 0.18); g.arc(0.66, 0.18, 0.07, 0, 7); g.stroke(); },
    stick(g) { g.strokeRect(-0.7, 0.35, 1.4, 0.4); g.beginPath(); g.moveTo(0, 0.35); g.lineTo(0, -0.45); g.stroke(); g.beginPath(); g.arc(0, -0.6, 0.22, 0, 7); g.stroke(); g.beginPath(); g.arc(0.45, 0.2, 0.1, 0, 7); g.stroke(); },
    heart(g) { const p = [[-2,-3],[-1,-3],[0,-2],[1,-3],[2,-3],[3,-2],[3,0],[2,1],[1,2],[0,3],[-1,2],[-2,1],[-3,0],[-3,-2]]; g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(x * 0.25, y * 0.25) : g.moveTo(x * 0.25, y * 0.25))); g.closePath(); g.stroke(); },
    gear(g) { g.beginPath(); for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 0.62 : 0.85; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); g.beginPath(); g.arc(0, 0, 0.28, 0, 7); g.stroke(); },
    star(g) { g.beginPath(); for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.38 : 0.9; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); },
    wrench(g) { g.beginPath(); g.moveTo(-0.7, 0.7); g.lineTo(0.25, -0.25); g.stroke(); g.beginPath(); g.arc(0.42, -0.42, 0.3, 2.4, 0.9 + Math.PI * 2 - 0.3); g.stroke(); },
    coin(g) { g.beginPath(); g.ellipse(0, 0, 0.7, 0.7, 0, 0, 7); g.stroke(); g.beginPath(); g.ellipse(0, 0, 0.45, 0.45, 0, 0, 7); g.stroke(); g.beginPath(); g.moveTo(0, -0.25); g.lineTo(0, 0.25); g.stroke(); },
  };
  const NAMES = Object.keys(SHAPES);
  let sketches = [], sparks = [];

  function resize() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const n = Math.round((W * H) / 26000);
    sketches = Array.from({ length: Math.max(10, n) }, (_, i) => newSketch(true, i));
  }
  function newSketch(anywhere, i) {
    return {
      kind: NAMES[(i ?? Math.floor(Math.random() * 99)) % NAMES.length],
      x: Math.random() * W, y: anywhere ? Math.random() * H : H + 60,
      s: 16 + Math.random() * 30, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.15,
      vy: 6 + Math.random() * 10, a: 0.10 + Math.random() * 0.14,
    };
  }
  function spark() {
    return { x: W * (0.15 + Math.random() * 0.7), y: H + 4, vx: (Math.random() - 0.5) * 30, vy: -(50 + Math.random() * 90), life: 1.5 + Math.random() * 2.5, t: 0, r: 0.8 + Math.random() * 1.6 };
  }

  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#07060d"; ctx.fillRect(0, 0, W, H);
    // ruutupaperi
    ctx.strokeStyle = "rgba(140,90,255,0.07)"; ctx.lineWidth = 1;
    for (let x = 0.5; x < W; x += 28) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0.5; y < H; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // ahjon hehku alhaalla
    const glow = ctx.createRadialGradient(W * 0.5, H * 1.08, 10, W * 0.5, H * 1.08, Math.max(W, H) * 0.75);
    glow.addColorStop(0, "rgba(255,43,214,0.40)"); glow.addColorStop(0.35, "rgba(139,92,255,0.16)"); glow.addColorStop(1, "rgba(0,240,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    // piirrokset
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const k of sketches) {
      k.y -= k.vy * dt; k.rot += k.vr * dt;
      if (k.y < -60) Object.assign(k, newSketch(false));
      const heat = Math.max(0, 1 - k.y / H) * 0; // tasainen sävy
      ctx.save(); ctx.translate(k.x, k.y); ctx.rotate(k.rot); ctx.scale(k.s, k.s);
      ctx.lineWidth = 1.4 / k.s;
      const warm = Math.min(1, Math.max(0, (k.y - H * 0.55) / (H * 0.45)));
      ctx.strokeStyle = `rgba(${Math.round(0 + 255 * warm)},${Math.round(240 - 197 * warm)},${Math.round(255 - 41 * warm)},${k.a + heat})`;
      SHAPES[k.kind](ctx);
      ctx.restore();
    }
    // kipinät
    if (!reduce && Math.random() < dt * 22) sparks.push(spark());
    for (const p of sparks) {
      p.t += dt; p.x += p.vx * dt + Math.sin(p.t * 3 + p.r) * 12 * dt; p.y += p.vy * dt; p.vy *= 1 - dt * 0.15;
      const k = 1 - p.t / p.life;
      ctx.fillStyle = k > .5 ? `rgba(0,240,255,${Math.max(0, k)})` : `rgba(255,43,214,${Math.max(0, k * 1.6)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (0.6 + k * 0.6), 0, 7); ctx.fill();
    }
    sparks = sparks.filter((p) => p.t < p.life);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!document.body.classList.contains("locked")) { raf = 0; return; } // ei piirretä turhaan kirjautumisen jälkeen
    draw(dt);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    resize();
    if (reduce) { draw(0); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }
  addEventListener("resize", () => { resize(); if (reduce) draw(0); });
  new MutationObserver(() => { if (document.body.classList.contains("locked")) start(); }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  start();
})();
