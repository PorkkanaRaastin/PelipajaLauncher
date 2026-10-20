// Pelipaja – pelien käynnistys, peli-ikkunat ja Save & End Game
const { app, BrowserWindow, session: electronSession } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const state = require("./state");
const { GAMES_DIR, GAMES_FILE, PRELOAD_DIR } = require("./paths");
const { loadCatalog } = require("./catalog");
const { hardenSession, setRole } = require("./security");
const stats = require("./stats");
const { readSettings } = require("./settings");

const running = new Map(); // pelin id -> { startedAt, user, close() }
const gameWindows = new Map(); // webContents.id -> { win, game, ending }

// ---------- Pelilista ----------
let catalog = { games: [], errors: [] };
function reloadCatalog() {
  try {
    catalog = loadCatalog(GAMES_FILE, GAMES_DIR);
  } catch (err) {
    catalog = { games: [], errors: ["games.json ei aukea: " + err.message] };
  }
  for (const e of catalog.errors) console.warn("[games.json]", e);
  return catalog.games;
}
const findGame = (id) => catalog.games.find((g) => g.id === id);

// Käyttöliittymälle annetaan vain näytettävät tiedot, ei tiedostopolkuja
function publicGames() {
  return reloadCatalog().map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    version: g.version,
    description: g.description,
    tags: g.tags,
    updates: g.updates,
    color: g.color,
    coverUrl: g.coverPath && fs.existsSync(g.coverPath) ? pathToFileURL(g.coverPath).href : null,
  }));
}

function runningIds() {
  return [...running.keys()];
}

function notifyRunning() {
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) {
    win.webContents.send("running-changed", runningIds());
    stats.sendStats();
  }
}

function finishGame(id) {
  const r = running.get(id);
  if (!r) return;
  running.delete(id);
  stats.addPlaytime(r.user, id, Date.now() - r.startedAt);
  notifyRunning();
  const win = state.launcherWin;
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

// ---------- Save & End Game ----------
// Pyytää peliä tallentamaan (window.rrSaveGame) ja sulkee sen sitten.
// Jos peli ei vastaa 4 sekunnissa, ikkuna suljetaan silti.
async function saveAndEnd(win) {
  if (!win || win.isDestroyed()) return;
  const info = gameWindows.get(win.webContents.id);
  if (!info || info.ending) return;
  info.ending = true;
  win.webContents.send("rr-saving");
  const save = win.webContents
    .executeJavaScript("Promise.resolve(typeof window.rrSaveGame==='function'?window.rrSaveGame():null).then(()=>true,()=>false)", true)
    .catch(() => false);
  const timeout = new Promise((res) => setTimeout(() => res(false), 4000));
  await Promise.race([save, timeout]);
  if (!win.isDestroyed()) win.destroy();
}

function saveAndEndSender(wc) {
  const info = gameWindows.get(wc.id);
  if (info) saveAndEnd(info.win);
}
function buttonCorner(wc) {
  const info = gameWindows.get(wc.id);
  return (info && info.game.endButton) || "top-left";
}

// ---------- Käynnistys ----------
function launch(id) {
  const user = state.session && state.session.user;
  if (!user) return { ok: false, error: "Kirjaudu sisään ennen pelaamista." };
  if (running.has(id)) return { ok: false, error: "Peli on jo käynnissä." };
  reloadCatalog();
  const game = findGame(id);
  if (!game) return { ok: false, error: "Peliä ei löytynyt." };
  if (game.type === "html" && !fs.existsSync(game.target)) {
    return { ok: false, error: `Pelin tiedostoa ei löytynyt (${path.relative(GAMES_DIR, game.target)}).` };
  }

  // Jokaisella käyttäjällä oma tallennustila: pelien omat tallennukset eivät sekoitu
  const partition = state.session.partition || "";
  hardenSession(partition ? electronSession.fromPartition(partition) : electronSession.defaultSession);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: game.name,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(PRELOAD_DIR, "game.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
      // nettipelit eivät saa jäätyä, vaikka ikkuna olisi taustalla
      backgroundThrottling: false,
      ...(partition ? { partition } : {}),
    },
  });
  win.setMenu(null);
  const wcId = win.webContents.id;
  setRole(
    win.webContents,
    game.type === "html" ? { kind: "game", root: path.dirname(game.target) } : { kind: "game", origin: new URL(game.target).origin }
  );
  gameWindows.set(wcId, { win, game, ending: false });
  if (game.fullscreen) win.setFullScreen(true);
  win.loadURL(game.type === "html" ? pathToFileURL(game.target).href : game.target);

  // F11 = koko näyttö, F10 = Save & End Game. Esc jätetään peleille.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === "F10") {
      saveAndEnd(win);
      e.preventDefault();
    }
  });
  // Myös ikkunan sulkeminen ruksista tallentaa ensin
  win.on("close", (e) => {
    const info = gameWindows.get(wcId);
    if (info && !info.ending) {
      e.preventDefault();
      saveAndEnd(win);
    }
  });
  win.on("closed", () => {
    gameWindows.delete(wcId);
    finishGame(id);
  });

  stats.countLaunch(user, id);
  running.set(id, { startedAt: Date.now(), user, close: () => !win.isDestroyed() && win.close() });
  notifyRunning();
  if (readSettings().minimizeOnLaunch && state.launcherWin) state.launcherWin.minimize();
  return { ok: true };
}

function stop(id) {
  const r = running.get(id);
  if (r) r.close();
  return true;
}

module.exports = { publicGames, runningIds, launch, stop, saveAndEndSender, buttonCorner, hasRunning: () => running.size > 0 };
