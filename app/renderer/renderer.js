// Pelipaja – käyttöliittymä
const api = window.launcher;
const $ = (id) => document.getElementById(id);

let games = [];
// uudet pelit (UUSI-merkki näkyy, kunnes Pelipaja käynnistetään uudelleen)
let newIds = new Set();
let whatsNew = null, whatsNewShown = false;
function newBadge() { const b = document.createElement("span"); b.className = "new-badge"; b.textContent = "NEW"; return b; }
const mainGames = () => games.filter((g) => g.category !== "minipeli");
const miniGames = () => games.filter((g) => g.category === "minipeli");
let stats = {};
let runningIds = [];
let selectedId = null;
let user = null;
let devMode = false; // "+ Lisää peli" -napit näkyvät vain kehitysversiossa (npm start)
const selKey = () => "selectedGame:" + (user ? user.id : "");

// ---------- Apufunktiot ----------
function formatTime(ms) {
  if (!ms) return "0 min";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

function formatDate(ts) {
  if (!ts) return "Never";
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB");
}

function cover(game, cls) {
  if (game.coverUrl) {
    const img = document.createElement("img");
    img.src = game.coverUrl;
    img.alt = "";
    return img;
  }
  // Ei kansikuvaa: värillinen laatta pelin alkukirjaimella
  const ph = document.createElement("div");
  ph.className = "ph " + (cls || "");
  ph.textContent = game.name.charAt(0).toUpperCase();
  ph.style.display = "grid";
  ph.style.placeItems = "center";
  ph.style.fontWeight = "800";
  ph.style.background = game.color || "#2a303b";
  return ph;
}

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("ok", kind === "ok");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- Näkymät ----------
function showView(name) {
  if (name === "updates") loadHistory(false);
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

function selectGame(id) {
  selectedId = id;
  try { localStorage.setItem(selKey(), id); } catch {}
  renderSidebar();
  renderHero();
  showView("home");
}

function renderSidebar() {
  const ul = $("sideGames");
  ul.replaceChildren();
  for (const g of mainGames()) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    if (g.id === selectedId) btn.classList.add("selected");
    btn.append(cover(g));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = g.name;
    btn.append(name);
    if (newIds.has(g.id)) btn.append(newBadge());
    if (runningIds.includes(g.id)) {
      const dot = document.createElement("span");
      dot.className = "dot-running";
      dot.title = "Running";
      btn.append(dot);
    }
    btn.addEventListener("click", () => selectGame(g.id));
    li.append(btn);
    ul.append(li);
  }
}

function renderHero() {
  const g = games.find((x) => x.id === selectedId);
  const playBtn = $("playBtn");
  if (!g) {
    $("heroTitle").textContent = "No games yet";
    $("heroDesc").textContent = "Games arrive with Pelipaja updates.";
    $("heroTags").replaceChildren();
    $("heroBg").style.backgroundImage = "";
    playBtn.disabled = true;
    $("notesWrap").hidden = true;
    return;
  }

  $("heroBg").style.backgroundImage = g.coverUrl ? `url("${g.coverUrl}")` : "";
  $("heroBg").style.backgroundColor = g.coverUrl ? "" : g.color || "";
  $("heroTitle").textContent = g.name;
  $("heroDesc").textContent = g.description || "";

  const tags = $("heroTags");
  tags.replaceChildren();
  if (newIds.has(g.id)) tags.append(newBadge());
  for (const t of g.tags || []) {
    const s = document.createElement("span");
    s.className = "tag";
    s.textContent = t;
    tags.append(s);
  }

  const s = stats[g.id] || {};
  $("statTime").textContent = formatTime(s.playtimeMs);
  $("statLast").textContent = formatDate(s.lastPlayed);
  $("statLaunches").textContent = s.launches || 0;
  $("statVersion").textContent = g.version || "–";

  const isRunning = runningIds.includes(g.id);
  playBtn.disabled = false;
  playBtn.classList.toggle("running", isRunning);
  playBtn.querySelector(".play-label").textContent = isRunning ? "CLOSE GAME" : "PLAY";
  $("playSub").textContent = isRunning ? "Game is running" : "Opens in its own window";

  const notes = $("notes");
  notes.replaceChildren();
  for (const n of g.updates || []) {
    const li = document.createElement("li");
    li.textContent = n;
    notes.append(li);
  }
  $("notesWrap").hidden = !(g.updates && g.updates.length);
}

function renderGrid() {
  const q = $("search").value.trim().toLowerCase();
  const grid = $("grid");
  grid.replaceChildren();
  const list = mainGames().filter((g) => !q || g.name.toLowerCase().includes(q) || (g.tags || []).join(" ").toLowerCase().includes(q));
  for (const g of list) {
    const card = document.createElement("button");
    card.className = "card";
    card.append(cover(g));
    const body = document.createElement("div");
    body.className = "card-body";
    const b = document.createElement("b");
    b.textContent = g.name;
    const span = document.createElement("span");
    const st = stats[g.id];
    span.textContent = st && st.playtimeMs ? `Played ${formatTime(st.playtimeMs)}` : "Not played yet";
    body.append(b, span);
    card.append(body);
    if (newIds.has(g.id)) { const nb = newBadge(); nb.classList.add("on-card"); card.append(nb); }
    card.addEventListener("click", () => selectGame(g.id));
    grid.append(card);
  }
  if (!q && devMode) {
    const add = document.createElement("button");
    add.className = "card add";
    add.textContent = "+ Add game";
    add.addEventListener("click", () => api.openGamesFolder());
    grid.append(add);
  }
}

// ---------- Minipelit ----------
function renderMinigames() {
  for (const [players, el] of [[1, $("miniSolo")], [2, $("miniDuo")]]) {
    el.replaceChildren();
    for (const g of miniGames().filter((x) => x.players === players)) {
      const card = document.createElement("button");
      card.className = "mini-card";
      const running = runningIds.includes(g.id);
      card.classList.toggle("running", running);
      const art = document.createElement("div");
      art.className = "mini-art";
      art.append(cover(g));
      const badge = document.createElement("span");
      badge.className = "mini-badge";
      badge.textContent = players === 2 ? "2 players" : "1 player";
      art.append(badge);
      if (newIds.has(g.id)) { const nb = newBadge(); nb.classList.add("on-card"); art.append(nb); }
      const body = document.createElement("div");
      body.className = "mini-body";
      const name = document.createElement("b");
      name.textContent = g.name;
      const desc = document.createElement("p");
      desc.textContent = g.description || "";
      const foot = document.createElement("div");
      foot.className = "mini-foot";
      const ctl = document.createElement("span");
      ctl.className = "mini-controls";
      ctl.textContent = g.controls || "";
      const play = document.createElement("span");
      play.className = "mini-play";
      play.textContent = running ? "Running" : "Play";
      foot.append(ctl, play);
      body.append(name, desc, foot);
      card.append(art, body);
      card.addEventListener("click", async () => {
        if (runningIds.includes(g.id)) return api.stop(g.id);
        const res = await api.launch(g.id);
        if (!res.ok) toast(res.error);
      });
      el.append(card);
    }
  }
}

function renderAll() {
  const main = mainGames();
  if (!main.find((g) => g.id === selectedId)) selectedId = main[0] ? main[0].id : null;
  renderSidebar();
  renderHero();
  renderGrid();
  renderMinigames();
}

// ---------- Tapahtumat ----------
$("playBtn").addEventListener("click", async () => {
  if (!selectedId) return;
  if (runningIds.includes(selectedId)) {
    await api.stop(selectedId);
    return;
  }
  const res = await api.launch(selectedId);
  if (!res.ok) toast(res.error);
});

document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
$("search").addEventListener("input", renderGrid);
$("openFolder").addEventListener("click", () => api.openGamesFolder());
$("openFolder2").addEventListener("click", () => api.openGamesFolder());
$("optMinimize").addEventListener("change", (e) => api.setSettings({ minimizeOnLaunch: e.target.checked }));

api.onRunningChanged((ids) => { runningIds = ids; renderSidebar(); renderHero(); renderMinigames(); });
api.onStatsChanged((s) => { stats = s; renderHero(); renderGrid(); });

// ---------- Käynnistys kirjautumisen jälkeen ----------
async function startApp(u) {
  user = u;
  document.body.classList.remove("locked");
  $("userAvatar").textContent = u.username.charAt(0).toUpperCase();
  $("userName").textContent = u.username;
  $("userEmail").textContent = u.email;
  $("accName").textContent = "Signed in as " + u.username;
  $("accInfo").textContent = `${u.email} · account created ${new Date(u.createdAt).toLocaleDateString("en-GB")}. Playtime, launches and game saves are stored on this account.`;
  [games, stats, runningIds] = await Promise.all([api.getGames(), api.getStats(), api.getRunning()]);
  selectedId = null;
  try { selectedId = localStorage.getItem(selKey()); } catch {}
  const settings = await api.getSettings();
  $("optMinimize").checked = settings.minimizeOnLaunch;
  showView("home");
  renderAll();
  showWhatsNew();
}

// ---------- Mitä uutta ----------
function showWhatsNew() {
  if (!whatsNew || whatsNewShown) return;
  whatsNewShown = true;
  $("wnVersion").textContent = "Pelipaja " + whatsNew.version;
  $("wnDate").textContent = whatsNew.date ? new Date(whatsNew.date).toLocaleDateString("en-GB") : "";
  const ul = $("wnNotes");
  ul.replaceChildren();
  for (const n of whatsNew.notes.length ? whatsNew.notes : ["Small fixes and improvements"]) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
  const ng = games.filter((g) => newIds.has(g.id));
  $("wnGamesWrap").hidden = !ng.length;
  const box = $("wnGames");
  box.replaceChildren();
  for (const g of ng) {
    const b = document.createElement("button");
    b.className = "wn-game";
    b.append(cover(g));
    const t = document.createElement("span");
    t.textContent = g.name;
    b.append(t, newBadge());
    b.addEventListener("click", () => {
      $("whatsNew").hidden = true;
      if (g.category === "minipeli") showView("minigames");
      else selectGame(g.id);
    });
    box.append(b);
  }
  $("whatsNew").hidden = false;
  setTimeout(() => $("wnClose").focus(), 50);
}
$("wnClose").addEventListener("click", () => { $("whatsNew").hidden = true; setTimeout(retryPrompt, 300); });

async function logout() {
  const res = await api.auth.logout();
  if (!res.ok) { toast(res.error); return; }
  user = null; stats = {};
  showAuth("stepLogin");
}
$("logoutBtn").addEventListener("click", logout);
$("logoutBtn2").addEventListener("click", logout);

// ---------- Kirjautuminen ja tilin luonti ----------
// Rekisteröinti: 1) käyttäjänimi + sähköposti → 2) koodi sähköpostista → 3) salasana
const A = { email: "", username: "", token: "", resendTimer: 0, resendLeft: 0 };
function showStep(id) {
  document.querySelectorAll(".auth-step").forEach((f) => (f.hidden = f.id !== id));
  document.querySelectorAll(".auth-step .auth-err").forEach((e) => (e.textContent = ""));
  document.querySelectorAll(".field input").forEach((i) => i.classList.remove("bad"));
  const first = $(id).querySelector("input");
  if (first) setTimeout(() => first.focus(), 30);
}
function showAuth(step) {
  document.body.classList.add("locked");
  $("loginPw").value = "";
  showStep(step);
}
function fail(errId, res, fieldMap) {
  $(errId).textContent = res.error || "Something went wrong.";
  const inp = fieldMap && res.field && fieldMap[res.field];
  if (inp) { $(inp).classList.add("bad"); $(inp).focus(); }
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Please wait…";
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showStep(b.dataset.go)));
document.querySelectorAll(".pw-toggle").forEach((b) => b.addEventListener("click", () => {
  const i = $(b.dataset.for); const show = i.type === "password";
  i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show";
}));

// Kirjaudu
$("stepLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await busy($("loginBtn"), () => api.auth.login({ login: $("loginId").value, password: $("loginPw").value, remember: $("loginRemember").checked }));
  if (res.ok) return startApp(res.user);
  fail("loginErr", res);
  $("loginPw").select();
});

// 1/3: käyttäjänimi ja sähköposti → koodi lähtee
$("stepSignup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = $("suName").value.trim(), email = $("suEmail").value.trim();
  const res = await busy($("suBtn"), () => api.auth.start({ username, email }));
  if (!res.ok) return fail("suErr", res, { username: "suName", email: "suEmail" });
  A.username = username; A.email = res.email;
  toVerify(res.dev, res.reused ? "A code was sent a moment ago. Check your email." : "");
});

// 2/3: 6-numeroinen koodi
const boxes = [...document.querySelectorAll("#codeBoxes input")];
function codeValue() { return boxes.map((b) => b.value).join(""); }
function setCode(str) {
  const d = str.replace(/\D/g, "").slice(0, 6);
  boxes.forEach((b, i) => (b.value = d[i] || ""));
  boxes[Math.min(d.length, 5)].focus();
  if (d.length === 6) $("stepVerify").requestSubmit();
}
boxes.forEach((b, i) => {
  b.addEventListener("input", () => {
    const v = b.value.replace(/\D/g, "");
    if (v.length > 1) return setCode(codeValue().slice(0, i) + v);
    b.value = v;
    if (v && i < 5) boxes[i + 1].focus();
    if (codeValue().length === 6) $("stepVerify").requestSubmit();
  });
  b.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !b.value && i > 0) { boxes[i - 1].value = ""; boxes[i - 1].focus(); e.preventDefault(); }
    if (e.key === "ArrowLeft" && i > 0) boxes[i - 1].focus();
    if (e.key === "ArrowRight" && i < 5) boxes[i + 1].focus();
  });
  b.addEventListener("paste", (e) => { e.preventDefault(); setCode((e.clipboardData || window.clipboardData).getData("text")); });
  b.addEventListener("focus", () => b.select());
});
function toVerify(dev, note) {
  $("verifyEmail").textContent = A.email;
  boxes.forEach((b) => (b.value = ""));
  showStep("stepVerify");
  if (note) $("verifyErr").textContent = note;
  startResendTimer(45);
}
function startResendTimer(sec) {
  clearInterval(A.resendTimer);
  A.resendLeft = sec;
  const btn = $("resendBtn");
  const tick = () => {
    btn.disabled = A.resendLeft > 0;
    btn.textContent = A.resendLeft > 0 ? `Send a new code (${A.resendLeft} s)` : "Send a new code";
    if (A.resendLeft-- <= 0) clearInterval(A.resendTimer);
  };
  tick(); A.resendTimer = setInterval(tick, 1000);
}
let verifying = false;
$("stepVerify").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (verifying) return;
  const code = codeValue();
  if (code.length !== 6) { $("verifyErr").textContent = "Enter all 6 digits."; return; }
  verifying = true;
  const res = await busy($("verifyBtn"), () => api.auth.verify({ email: A.email, code }));
  verifying = false;
  if (!res.ok) { $("verifyErr").textContent = res.error; boxes.forEach((b) => (b.value = "")); boxes[0].focus(); return; }
  clearInterval(A.resendTimer);
  A.token = res.token;
  $("pwLead").textContent = `Email verified! Now create a password for ${res.username}.`;
  $("suPw").value = ""; $("suPw2").value = ""; checkRules();
  showStep("stepPassword");
});
$("resendBtn").addEventListener("click", async () => {
  const res = await api.auth.resend({ email: A.email });
  if (!res.ok) { $("verifyErr").textContent = res.error; return; }
  $("verifyErr").textContent = "";
  toast("New code sent.", "ok");
  startResendTimer(45);
});

// 3/3: salasana → tili valmis
function checkRules() {
  const pw = $("suPw").value, pw2 = $("suPw2").value;
  const rules = { len: pw.length >= 8, mix: /[A-Za-zÅÄÖåäö]/.test(pw) && /[^A-Za-zÅÄÖåäö]/.test(pw), match: pw.length > 0 && pw === pw2 };
  document.querySelectorAll("#pwRules li").forEach((li) => li.classList.toggle("ok", rules[li.dataset.rule]));
  return rules;
}
$("suPw").addEventListener("input", checkRules);
$("suPw2").addEventListener("input", checkRules);
$("stepPassword").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = checkRules();
  if (!r.len) return fail("pwErr", { error: "Your password needs at least 8 characters.", field: "p" }, { p: "suPw" });
  if (!r.mix) return fail("pwErr", { error: "Use letters plus numbers or special characters.", field: "p" }, { p: "suPw" });
  if (!r.match) return fail("pwErr", { error: "Passwords don't match.", field: "p" }, { p: "suPw2" });
  const res = await busy($("pwBtn"), () => api.auth.setPassword({ email: A.email, token: A.token, password: $("suPw").value, remember: true }));
  if (!res.ok) {
    if (res.field === "password") return fail("pwErr", res, { password: "suPw" });
    showStep("stepSignup"); return fail("suErr", res);
  }
  $("suPw").value = ""; $("suPw2").value = ""; A.token = "";
  toast(`Welcome to Pelipaja, ${res.user.username}!`, "ok");
  startApp(res.user);
});

// ---------- Päivitykset ----------
const UPDATE_TEXT = {
  ready: (s) => [`Update ${s.version} is ready`, "The new version starts the next time Pelipaja restarts.", "Restart now"],
  manual: (s) => [`Pelipaja ${s.version} is out`, "This update needs a fresh Pelipaja download.", "Open download page"],
};
let updStatus = null;
function renderUpdate(s) {
  if (!s) return;
  updStatus = s;
  renderHistStatus();
  maybePrompt(s);
  const card = $("updateCard");
  const t = UPDATE_TEXT[s.state];
  card.hidden = !t;
  if (t) {
    const [title, text, btn] = t(s);
    $("updateTitle").textContent = title;
    $("updateText").textContent = text;
    $("updateBtn").textContent = btn;
    $("updateBtn").dataset.action = s.state;
  }
  const info = {
    idle: "Updates arrive automatically from GitHub.",
    uptodate: "You have the latest version.",
    downloading: `Downloading update ${s.version}…`,
    ready: `Update ${s.version} is ready. Restart Pelipaja.`,
    manual: `Version ${s.version} needs a fresh download.`,
    error: "Couldn't check for updates (no internet?). Trying again later.",
  }[s.state];
  if (info) $("updateInfo").textContent = devMode && s.state === "idle" ? "Development build doesn't update automatically." : info;
}
$("updateBtn").addEventListener("click", async () => {
  if ($("updateBtn").dataset.action === "manual") return api.update.openPage();
  const res = await api.update.restart();
  if (!res.ok) toast(res.error);
});
$("updateCheckBtn").addEventListener("click", async () => {
  $("updateInfo").textContent = "Checking…";
  renderUpdate(await api.update.check());
});
api.onUpdateStatus(renderUpdate);

// ---------- Päivitysehdotus (taustatarkistus 10 s välein) ----------
let appStarted = false, promptedVersion = null, pendingPrompt = null;
function maybePrompt(s) {
  if (!appStarted || !s || !(s.state === "ready" || s.state === "manual") || s.version === promptedVersion) return;
  // ei keskeytetä peliä eikä "What's new" -ikkunaa: ehdotus näytetään, kun peli on suljettu
  if (runningIds.length || !$("whatsNew").hidden) { pendingPrompt = s; return; }
  pendingPrompt = null;
  promptedVersion = s.version;
  const manual = s.state === "manual";
  $("updTitle").textContent = (manual ? "Pelipaja " : "Pelipaja ") + s.version + (manual ? " is out" : " is ready");
  $("updSub").textContent = manual
    ? "This update needs a fresh download of Pelipaja."
    : "Pelipaja restarts in a moment. Your account, playtime and saves stay as they are.";
  const ul = $("updNotes");
  ul.replaceChildren();
  const notes = (s.notes && s.notes.length ? s.notes : manual ? [] : ["Small fixes and improvements"]).slice();
  if (s.newGames && s.newGames.length) notes.push(s.newGames.length === 1 ? "1 new game" : s.newGames.length + " new games");
  for (const n of notes) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
  ul.hidden = !notes.length;
  $("updNow").textContent = manual ? "Open download page" : "Update now";
  $("updNow").dataset.action = s.state;
  $("updPrompt").hidden = false;
  setTimeout(() => $("updNow").focus(), 30);
}
function retryPrompt() { if (pendingPrompt) maybePrompt(pendingPrompt); }
api.onRunningChanged(() => setTimeout(retryPrompt, 50));
async function doUpdateNow(action) {
  if (action === "manual") return api.update.openPage();
  const res = await api.update.restart();
  if (!res.ok) toast(res.error);
}
$("updNow").addEventListener("click", () => {
  $("updPrompt").hidden = true;
  doUpdateNow($("updNow").dataset.action);
});
$("updLater").addEventListener("click", () => {
  $("updPrompt").hidden = true;
  toast("You can update later from the sidebar or the Updates page.", "ok");
});

// ---------- Päivityshistoria ----------
const verCmp = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
function renderHistStatus() {
  const s = updStatus;
  if (!s) return;
  const info = {
    checking: "Checking for updates…",
    uptodate: "You have the latest version. Pelipaja checks for updates every 10 seconds.",
    downloading: `Downloading update ${s.version}…`,
    installing: `Installing update ${s.version}…`,
    ready: `Update ${s.version} is ready to install.`,
    manual: `Version ${s.version} needs a fresh download.`,
    error: "Couldn't reach GitHub right now. Trying again in a moment.",
    dev: "Development build: no automatic updates.",
    idle: devMode ? "Development build: no automatic updates." : "Pelipaja checks for updates every 10 seconds.",
  }[s.state];
  if (info) $("histInfo").textContent = info;
  renderChecked();
  const btn = $("histUpdateBtn");
  btn.hidden = !(s.state === "ready" || s.state === "manual");
  btn.textContent = s.state === "manual" ? "Open download page" : "Update now";
  btn.dataset.action = s.state;
}
// "Last checked 4 s ago" – näyttää, että taustatarkistus on käynnissä
function renderChecked() {
  const el = $("histChecked");
  const s = updStatus;
  if (!s || !s.checkedAt) { el.textContent = ""; return; }
  const sec = Math.max(0, Math.round((Date.now() - s.checkedAt) / 1000));
  const ago = sec < 2 ? "just now" : sec < 90 ? sec + " s ago" : Math.round(sec / 60) + " min ago";
  el.textContent = `Last checked ${ago}` + (s.latest ? ` · newest on GitHub: ${s.latest}` : "");
}
setInterval(() => { if ($("view-updates").classList.contains("active")) renderChecked(); }, 1000);
$("histUpdateBtn").addEventListener("click", () => doUpdateNow($("histUpdateBtn").dataset.action));
$("histRefresh").addEventListener("click", () => loadHistory(true));
let histLoading = false;
async function loadHistory(force) {
  if (histLoading) return;
  histLoading = true;
  const list = $("histList");
  if (!list.children.length || force) $("histMsg").textContent = "Loading the update history…";
  let h;
  try {
    h = await api.update.history(force);
  } catch {
    h = { ok: false, error: "Couldn't load the update history." };
  }
  histLoading = false;
  if (h.current) $("histCur").textContent = h.current;
  if (!h.ok) { $("histMsg").textContent = h.error; return; }
  $("histMsg").textContent = h.offline && h.at ? "Offline – showing the history saved on " + new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "." : "";
  const names = new Map(games.map((g) => [g.id, g.name]));
  list.replaceChildren();
  if (!h.releases.length) { $("histMsg").textContent = "No releases yet."; return; }
  for (const r of h.releases) {
    const cmp = h.current ? verCmp(r.version, h.current) : -1;
    const item = document.createElement("article");
    item.className = "hist-item" + (cmp === 0 ? " current" : cmp > 0 ? " newer" : "");
    const top = document.createElement("div");
    top.className = "hist-top";
    const h3 = document.createElement("h3");
    h3.textContent = "Pelipaja " + r.version;
    top.append(h3);
    if (cmp === 0 || cmp > 0) {
      const tag = document.createElement("span");
      tag.className = "hist-tag " + (cmp === 0 ? "cur" : "new");
      tag.textContent = cmp === 0 ? "Installed" : updStatus && updStatus.state === "ready" && updStatus.version === r.version ? "Ready to install" : "New";
      top.append(tag);
    }
    const date = document.createElement("span");
    date.className = "hist-date";
    date.textContent = r.date ? new Date(r.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
    top.append(date);
    item.append(top);
    if (r.notes.length) {
      const ul = document.createElement("ul");
      for (const n of r.notes) { const li = document.createElement("li"); li.textContent = n; ul.append(li); }
      item.append(ul);
    } else {
      const p = document.createElement("div");
      p.className = "hist-empty";
      p.textContent = "No release notes for this version.";
      item.append(p);
    }
    if (r.newGames.length) {
      const g = document.createElement("div");
      g.className = "hist-games";
      const b = document.createElement("b");
      b.textContent = "New games: ";
      g.append(b, document.createTextNode(r.newGames.map((x) => names.get(x) || x).join(", ")));
      item.append(g);
    }
    list.append(item);
  }
}

// ---------- Käynnistysnäkymä: uusin versio ladataan ennen launcheria ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bootShow(s) {
  if (!s) return;
  const bar = $("bootBar");
  const wrap = bar.parentElement;
  const pct = Math.round((s.progress || 0) * 100);
  const msg = {
    checking: "Checking for updates…",
    downloading: `Downloading Pelipaja ${s.version}… ${pct}%`,
    installing: `Installing Pelipaja ${s.version}…`,
    ready: `Pelipaja ${s.version} installed`,
    restarting: `Starting Pelipaja ${s.version}…`,
    uptodate: "Pelipaja is up to date",
    manual: `Pelipaja ${s.version} needs a fresh download. Continuing with this version.`,
    error: "Couldn't reach the update server. Continuing without updating.",
    dev: "Development build: no updates",
  }[s.state];
  if (msg) $("bootText").textContent = msg;
  wrap.classList.toggle("indeterminate", s.state === "checking");
  bar.style.width = ["downloading"].includes(s.state) ? pct + "%" : ["installing", "ready", "restarting", "uptodate", "dev", "manual", "error"].includes(s.state) ? "100%" : "0%";
}
async function bootUpdate() {
  const started = Date.now();
  const off = (s) => bootShow(s);
  api.onUpdateStatus(off);
  let s;
  try {
    s = await api.update.startup();
  } catch {
    s = { state: "error" };
  }
  bootShow(s);
  if (s.state === "restarting") return false; // Pelipaja käynnistyy uudelleen uudella versiolla
  await sleep(Math.max(0, 1100 - (Date.now() - started)) + (s.state === "error" || s.state === "manual" ? 1200 : 350));
  $("bootScreen").classList.add("out");
  setTimeout(() => ($("bootScreen").hidden = true), 400);
  return true;
}

(async function boot() {
  try {
    const info = await api.appInfo();
    devMode = !!info.dev;
    $("appVersion").textContent = info.version;
    $("histCur").textContent = info.version;
    $("bootVer").textContent = "Version " + info.version;
  } catch {}
  if (!(await bootUpdate())) return;
  try {
    whatsNew = await api.whatsNew();
    if (whatsNew) newIds = new Set(whatsNew.newGames || []);
  } catch {}
  appStarted = true;
  api.update.status().then(renderUpdate, () => {});
  document.querySelectorAll(".dev-only").forEach((el) => (el.hidden = !devMode));
  const st = await api.auth.status();
  if (st.user) startApp(st.user);
  else showAuth("stepLogin");
})();
