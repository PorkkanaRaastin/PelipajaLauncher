// Pelipaja – käyttäjäkohtaiset asetukset
const state = require("./state");
const { readUserJson, writeUserJson } = require("./storage");

// Vain nämä asetukset ovat olemassa; muut avaimet hylätään.
const DEFAULTS = { minimizeOnLaunch: true };

const currentUser = () => state.session && state.session.user;

function readSettings() {
  const saved = readUserJson(currentUser(), "settings.json", {}) || {};
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) out[k] = saved[k];
  return out;
}

function updateSettings(patch) {
  const next = readSettings();
  if (patch && typeof patch === "object") {
    for (const k of Object.keys(DEFAULTS)) if (typeof patch[k] === typeof DEFAULTS[k]) next[k] = patch[k];
  }
  if (currentUser()) writeUserJson(currentUser(), "settings.json", next);
  return next;
}

module.exports = { readSettings, updateSettings };
