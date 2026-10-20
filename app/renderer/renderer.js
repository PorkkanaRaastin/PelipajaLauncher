// Pelipaja – käyttöliittymä
const api = window.launcher;
const $ = (id) => document.getElementById(id);

let games = [];
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
  if (!ts) return "Ei vielä";
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Tänään";
  if (d.toDateString() === yesterday.toDateString()) return "Eilen";
  return d.toLocaleDateString("fi-FI");
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
  for (const g of games) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    if (g.id === selectedId) btn.classList.add("selected");
    btn.append(cover(g));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = g.name;
    btn.append(name);
    if (runningIds.includes(g.id)) {
      const dot = document.createElement("span");
      dot.className = "dot-running";
      dot.title = "Käynnissä";
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
    $("heroTitle").textContent = "Ei pelejä vielä";
    $("heroDesc").textContent = "Pelit tulevat Pelipajan päivitysten mukana.";
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
  playBtn.querySelector(".play-label").textContent = isRunning ? "SULJE PELI" : "PELAA";
  $("playSub").textContent = isRunning ? "Peli on käynnissä" : "Käynnistyy omaan ikkunaan";

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
  const list = games.filter((g) => !q || g.name.toLowerCase().includes(q) || (g.tags || []).join(" ").toLowerCase().includes(q));
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
    span.textContent = st && st.playtimeMs ? `Pelattu ${formatTime(st.playtimeMs)}` : "Ei pelattu vielä";
    body.append(b, span);
    card.append(body);
    card.addEventListener("click", () => selectGame(g.id));
    grid.append(card);
  }
  if (!q && devMode) {
    const add = document.createElement("button");
    add.className = "card add";
    add.textContent = "+ Lisää peli";
    add.addEventListener("click", () => api.openGamesFolder());
    grid.append(add);
  }
}

function renderAll() {
  if (!games.find((g) => g.id === selectedId)) selectedId = games[0] ? games[0].id : null;
  renderSidebar();
  renderHero();
  renderGrid();
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

api.onRunningChanged((ids) => { runningIds = ids; renderSidebar(); renderHero(); });
api.onStatsChanged((s) => { stats = s; renderHero(); renderGrid(); });

// ---------- Käynnistys kirjautumisen jälkeen ----------
async function startApp(u) {
  user = u;
  document.body.classList.remove("locked");
  $("userAvatar").textContent = u.username.charAt(0).toUpperCase();
  $("userName").textContent = u.username;
  $("userEmail").textContent = u.email;
  $("accName").textContent = "Kirjautuneena: " + u.username;
  $("accInfo").textContent = `${u.email} · tili luotu ${new Date(u.createdAt).toLocaleDateString("fi-FI")}. Peliajat, käynnistykset ja pelien tallennukset tallentuvat tälle tilille.`;
  [games, stats, runningIds] = await Promise.all([api.getGames(), api.getStats(), api.getRunning()]);
  selectedId = null;
  try { selectedId = localStorage.getItem(selKey()); } catch {}
  const settings = await api.getSettings();
  $("optMinimize").checked = settings.minimizeOnLaunch;
  showView("home");
  renderAll();
}

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
  $(errId).textContent = res.error || "Jokin meni pieleen.";
  const inp = fieldMap && res.field && fieldMap[res.field];
  if (inp) { $(inp).classList.add("bad"); $(inp).focus(); }
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Odota…";
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
}
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showStep(b.dataset.go)));
document.querySelectorAll(".pw-toggle").forEach((b) => b.addEventListener("click", () => {
  const i = $(b.dataset.for); const show = i.type === "password";
  i.type = show ? "text" : "password"; b.textContent = show ? "Piilota" : "Näytä";
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
  toVerify(res.dev, res.reused ? "Koodi lähetettiin jo hetki sitten. Tarkista sähköpostisi." : "");
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
    btn.textContent = A.resendLeft > 0 ? `Lähetä uusi koodi (${A.resendLeft} s)` : "Lähetä uusi koodi";
    if (A.resendLeft-- <= 0) clearInterval(A.resendTimer);
  };
  tick(); A.resendTimer = setInterval(tick, 1000);
}
let verifying = false;
$("stepVerify").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (verifying) return;
  const code = codeValue();
  if (code.length !== 6) { $("verifyErr").textContent = "Syötä kaikki 6 numeroa."; return; }
  verifying = true;
  const res = await busy($("verifyBtn"), () => api.auth.verify({ email: A.email, code }));
  verifying = false;
  if (!res.ok) { $("verifyErr").textContent = res.error; boxes.forEach((b) => (b.value = "")); boxes[0].focus(); return; }
  clearInterval(A.resendTimer);
  A.token = res.token;
  $("pwLead").textContent = `Sähköposti vahvistettu! Luo vielä salasana tilille ${res.username}.`;
  $("suPw").value = ""; $("suPw2").value = ""; checkRules();
  showStep("stepPassword");
});
$("resendBtn").addEventListener("click", async () => {
  const res = await api.auth.resend({ email: A.email });
  if (!res.ok) { $("verifyErr").textContent = res.error; return; }
  $("verifyErr").textContent = "";
  toast("Uusi koodi lähetetty.", "ok");
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
  if (!r.len) return fail("pwErr", { error: "Salasanassa pitää olla vähintään 8 merkkiä.", field: "p" }, { p: "suPw" });
  if (!r.mix) return fail("pwErr", { error: "Lisää salasanaan kirjaimia ja numeroita tai erikoismerkkejä.", field: "p" }, { p: "suPw" });
  if (!r.match) return fail("pwErr", { error: "Salasanat eivät täsmää.", field: "p" }, { p: "suPw2" });
  const res = await busy($("pwBtn"), () => api.auth.setPassword({ email: A.email, token: A.token, password: $("suPw").value, remember: true }));
  if (!res.ok) {
    if (res.field === "password") return fail("pwErr", res, { password: "suPw" });
    showStep("stepSignup"); return fail("suErr", res);
  }
  $("suPw").value = ""; $("suPw2").value = ""; A.token = "";
  toast(`Tervetuloa Pelipajaan, ${res.user.username}!`, "ok");
  startApp(res.user);
});

// ---------- Päivitykset ----------
const UPDATE_TEXT = {
  ready: (s) => [`Päivitys ${s.version} on valmis`, "Uusi versio otetaan käyttöön, kun Pelipaja käynnistyy uudelleen.", "Käynnistä uudelleen"],
  manual: (s) => [`Pelipaja ${s.version} on julkaistu`, "Tämä päivitys vaatii uuden Pelipaja-latauksen.", "Avaa lataussivu"],
};
function renderUpdate(s) {
  if (!s) return;
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
    idle: "Päivitykset tulevat automaattisesti GitHubista.",
    uptodate: "Sinulla on uusin versio.",
    downloading: `Ladataan päivitystä ${s.version}…`,
    ready: `Päivitys ${s.version} on valmis. Käynnistä Pelipaja uudelleen.`,
    manual: `Versio ${s.version} vaatii uuden latauksen.`,
    error: "Päivitysten tarkistus ei onnistunut (ei nettiä?). Yritetään myöhemmin uudelleen.",
  }[s.state];
  if (info) $("updateInfo").textContent = devMode && s.state === "idle" ? "Kehitysversio ei päivity automaattisesti." : info;
}
$("updateBtn").addEventListener("click", async () => {
  if ($("updateBtn").dataset.action === "manual") return api.update.openPage();
  const res = await api.update.restart();
  if (!res.ok) toast(res.error);
});
$("updateCheckBtn").addEventListener("click", async () => {
  $("updateInfo").textContent = "Tarkistetaan…";
  renderUpdate(await api.update.check());
});
api.onUpdateStatus(renderUpdate);

(async function boot() {
  try {
    const info = await api.appInfo();
    devMode = !!info.dev;
    $("appVersion").textContent = info.version;
  } catch {}
  api.update.status().then(renderUpdate, () => {});
  document.querySelectorAll(".dev-only").forEach((el) => (el.hidden = !devMode));
  const st = await api.auth.status();
  if (st.user) startApp(st.user);
  else showAuth("stepLogin");
})();
