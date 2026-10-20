// Pelipaja – kaikki sovelluksen kansiot yhdessä paikassa
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

module.exports = {
  ROOT,
  GAMES_DIR: path.join(ROOT, "games"),
  GAMES_FILE: path.join(ROOT, "games", "games.json"),
  RENDERER_DIR: path.join(ROOT, "app", "renderer"),
  PRELOAD_DIR: path.join(ROOT, "app", "preload"),
  ASSETS_DIR: path.join(ROOT, "app", "assets"),
  ICON: path.join(ROOT, "app", "assets", "icon.png"),
  // Käynnissä olevan version numero (voi olla GitHubista ladattu päivitys)
  APP_VERSION: require(path.join(ROOT, "package.json")).version,
};
