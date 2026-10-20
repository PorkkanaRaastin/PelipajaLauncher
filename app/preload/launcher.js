// Pelipaja – turvallinen silta käyttöliittymän ja pääprosessin välillä.
// Käyttöliittymä näkee vain nämä funktiot, ei Nodea eikä Electronia.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const listen = (channel) => (cb) => {
  ipcRenderer.on(channel, (_e, value) => cb(value));
};

contextBridge.exposeInMainWorld("launcher", {
  appInfo: invoke("app-info"),
  getGames: invoke("get-games"),
  getStats: invoke("get-stats"),
  getRunning: invoke("get-running"),
  launch: invoke("launch-game"),
  stop: invoke("stop-game"),
  openGamesFolder: invoke("open-games-folder"),
  getSettings: invoke("get-settings"),
  setSettings: invoke("set-settings"),
  auth: {
    status: invoke("auth-status"),
    start: invoke("auth-start"),
    resend: invoke("auth-resend"),
    verify: invoke("auth-verify"),
    setPassword: invoke("auth-password"),
    login: invoke("auth-login"),
    logout: invoke("auth-logout"),
  },
  update: {
    status: invoke("update-status"),
    check: invoke("update-check"),
    startup: invoke("update-startup"),
    restart: invoke("update-restart"),
    openPage: invoke("update-open-page"),
  },
  onUpdateStatus: listen("update-status"),
  onRunningChanged: listen("running-changed"),
  onStatsChanged: listen("stats-changed"),
});
