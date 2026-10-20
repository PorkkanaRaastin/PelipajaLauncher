// Pelipaja – pääprosessin yhteinen tila (yksi paikka, ettei moduulien välillä kulje globaaleja)
module.exports = {
  /** Pilviyhteys (cloud.js), luodaan kun sovellus on valmis */
  cloud: null,
  /** Kirjautunut käyttäjä: { user, partition } tai null */
  session: null,
  /** Launcherin pääikkuna */
  launcherWin: null,
};
