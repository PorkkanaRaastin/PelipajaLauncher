# Pelipaja

Rasmuksen oma pelilauncher. Kaikki pelit, tallennukset ja peliajat ovat yhdessä paikassa,
ja käyttäjätili toimii millä tahansa koneella.
Tehty Electronilla (HTML, CSS ja JavaScript).

## Kansiot

```
pelipaja/
├─ app/
│  ├─ main/            pääprosessi (Node.js)
│  │  ├─ index.js        käynnistys, launcher-ikkuna ja IPC-kanavat
│  │  ├─ security.js     ikkunoiden, sivujen ja IPC:n suojaukset
│  │  ├─ accounts.js     kirjautuminen ja rekisteröinti
│  │  ├─ cloud.js        Supabase-yhteys (tilit ja peliajat pilvessä)
│  │  ├─ cloud-config.js Supabasen julkinen osoite ja julkinen avain
│  │  ├─ games.js        pelien käynnistys ja Save & End Game
│  │  ├─ catalog.js      games.json-pelilistan luku ja tarkistus
│  │  ├─ stats.js        peliajat ja käynnistykset
│  │  ├─ settings.js     asetukset
│  │  ├─ storage.js      salattu tallennus koneelle
│  │  ├─ paths.js        sovelluksen kansiot
│  │  └─ state.js        yhteinen tila (kirjautunut käyttäjä jne.)
│  ├─ preload/
│  │  ├─ launcher.js     turvallinen silta käyttöliittymän ja pääprosessin välillä
│  │  └─ game.js         ladataan peli-ikkunoihin: Save & End Game -nappi ja F10
│  ├─ renderer/        launcherin käyttöliittymä (index.html, style.css, renderer.js)
│  └─ assets/          kuvake
├─ games/              pelit ja games.json-pelilista
│  └─ _shared/           pelien yhteiset kirjastot (three.js, PeerJS), toimii ilman nettiä
├─ scripts/check.js    tarkistus: npm test
└─ supabase/           tietokannan SQL-päivitykset
```

## Käynnistys kehitysversiona

1. Asenna [Node.js](https://nodejs.org) (LTS-versio).
2. Avaa kansio komentoriville ja asenna riippuvuudet (vain ensimmäisellä kerralla): `npm install`
3. Käynnistä: `npm start`

## Valmis Windows-versio

```
npm run dist
```
Ajaa ensin tarkistuksen (`npm test`) ja tekee sitten kansion `dist/win-unpacked`,
jossa on `Pelipaja.exe`.

## Uuden pelin lisääminen

1. Tee pelille kansio `games`-kansioon, esim. `games/kuutiomaa/`, ja laita pelin tiedostot sinne
   (ja halutessasi kansikuva, esim. `cover.png`).
2. Lisää peli `games/games.json`-tiedostoon:

```json
{
  "id": "kuutiomaa",
  "name": "Kuutiomaa",
  "type": "html",
  "path": "kuutiomaa/index.html",
  "cover": "kuutiomaa/cover.png",
  "version": "0.1",
  "endButton": "top-left",
  "tags": ["3D", "Hiekkalaatikko"],
  "description": "Lyhyt kuvaus pelistä.",
  "updates": ["Mitä uutta tässä versiossa"]
}
```

3. Aja `npm test`. Se kertoo, jos jokin on vialla.

| Kenttä      | Mitä                                                                     |
|-------------|--------------------------------------------------------------------------|
| `id`        | pienet kirjaimet, numerot, `-` ja `_` (esim. `syva-vesi`)                  |
| `type`      | `html` = peli games-kansiossa, `url` = nettipeli (`path` on `https://`-osoite) |
| `endButton` | Save & End -napin paikka: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center` |
| `color`     | laatan väri, jos kansikuvaa ei ole (esim. `"#4a7bd0"`)                   |

Kehitysversiossa (`npm start`) launcherissa on **+ Lisää peli** -nappi, joka avaa games-kansion.
Valmiissa versiossa pelit ovat lukittuina sovelluspaketin sisällä, joten uudet pelit tulevat
uuden version mukana.

## Save & End Game

Jokaisessa pelissä on nurkassa **Save & End Game** -nappi (ja pikanäppäin **F10**).
Launcher kutsuu pelin funktiota `window.rrSaveGame()`, sulkee pelin ja tuo launcherin esiin.
Uuteen peliin riittää tällainen funktio:

```js
window.rrSaveGame = () => {
  localStorage.setItem("mun_peli_save", JSON.stringify({ rahat, taso, x, y }));
};
```

Funktio saa olla `async`, launcher odottaa sitä enintään 4 sekuntia.
**F11** vaihtaa koko näytön tilaa.

## Käyttäjätilit (Supabase)

Rekisteröinti: käyttäjänimi + sähköposti → 6-numeroinen koodi sähköpostiin → salasana.
Kirjautuminen: sähköposti tai käyttäjänimi + salasana.

- Peliajat ja käynnistykset tallentuvat pilveen. Ilman nettiä ne jonotetaan ja lähetetään myöhemmin.
- Pelien omat tallennukset ovat konekohtaisia ja käyttäjäkohtaisia.
- Salasanat hashaa Supabase (bcrypt). Kirjautumistieto tallennetaan koneelle Windowsin
  salauksella (`%APPDATA%/pelipaja`).
- `cloud-config.js` sisältää vain julkiset tunnukset, joten se saa olla GitHubissa.
  **Supabasen secret/service_role-avainta tai Brevon avaimia ei koskaan laiteta tähän projektiin.**
  `npm test` tarkistaa tämän.

## Tietoturva

Valmis `Pelipaja.exe`:
- Exe on täsmälleen Electronin alkuperäinen tiedosto uudella nimellä. Siksi Windows tunnistaa
  sen, eikä "Windows suojasi tietokoneesi" -varoitusta tule. Exeä ei siis muokata.
  (Jos Pelipaja joskus saa koodiallekirjoituksen, exeen voi lisätä myös app.asar-tarkistuksen,
  jolloin muokattu sovellus ei käynnistyisi.)
- Kehittäjätyökalut on poistettu käytöstä valmiissa versiossa.
- Käyttöliittymällä ja peleillä ei ole pääsyä Nodeen tai tiedostoihin. Ne toimivat
  hiekkalaatikossa ja saavat ladata vain Pelipajan omia tiedostoja.
- Ikkunat eivät voi avata uusia ikkunoita tai siirtyä muille sivuille. Pelit pysyvät omassa kansiossaan.
- Salaamattomat http-yhteydet on estetty. Kamera, mikrofoni, sijainti ja ilmoitukset on estetty.
- Pääprosessi hyväksyy viestit vain oikeasta ikkunasta ja tarkistaa jokaisen arvon.
- Palvelimella (`supabase/01-turvapaivitys.sql`) käyttäjänimellä kirjautuminen lukittuu
  15 minuutiksi viiden väärän salasanan jälkeen, eikä peliaikoja voi väärentää.
