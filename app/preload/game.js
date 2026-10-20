// Ladataan jokaiseen peli-ikkunaan.
// Lisää "Save & End Game" -napin ja antaa pelille yhteyden launcheriin.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rrLauncher", {
  saveAndEnd: () => ipcRenderer.send("game-save-and-end"),
});

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
  btn.title = "Tallentaa pelin ja palaa launcheriin (F10)";
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
    btn.querySelector("span").textContent = "Tallennetaan…";
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
    btn.querySelector("span").textContent = "Tallennetaan…";
  }
});

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", addButton);
} else {
  addButton();
}
