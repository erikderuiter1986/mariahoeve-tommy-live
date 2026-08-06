// Mariahoeve Tommy live sync service + app data opslag
//
// Dit doet twee dingen:
// 1. Haalt elke X minuten de Tommy iCal feed op en levert aankomst, vertrek en
//    wissel codes per accommodatie, zie de eindpunten /status en /day/:datum.
// 2. Biedt een simpele gedeelde opslag voor de housekeeping app zelf, zodat de
//    app werkt ongeacht waar hij geopend wordt, in plaats van afhankelijk te zijn
//    van opslag die alleen binnen Claude's eigen weergave bestaat.

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// De housekeeping app zelf, als gewone website, geen bestand meer nodig op elk toestel
app.use(express.static(path.join(__dirname, "public")));

// --- Instellingen, via omgevingsvariabelen zodat er geen geheimen in de code staan ---

const ICS_URL = process.env.TOMMY_ICS_URL;
const ACCESS_KEY = process.env.ACCESS_KEY || "verander-dit-wachtwoord";
const REFRESH_CRON = process.env.REFRESH_CRON || "*/15 * * * *";

if (!ICS_URL) {
  console.error("Zet TOMMY_ICS_URL in de omgevingsvariabelen voordat je start.");
  process.exit(1);
}

const KNOWN_ACCOMMODATIONS = [
  "Blikveld", "Boszicht", "Commer", "Dome Galaxy", "Dome Terra",
  "Escape", "Flow", "Hubus", "Kwaak", "Neef Herbert & het Kornuitenhuisje", "Nomad",
  "Oehoe", "Onder Zeil", "Veldzicht", "Walden", "Wodan", "Yurt Odana", "Yurt Tiaki", "Yurt Trikan",
  "Zeezicht"
];
const KNOWN_LOWER = KNOWN_ACCOMMODATIONS.map(n => n.toLowerCase());

// Tommy gebruikt soms een andere naam intern dan de naam die wij gebruiken.
// Linkerkant is de naam zoals die in Tommy's boekingen staat, rechterkant is
// onze eigen naam. Voeg hier gerust meer aan toe als dit vaker voorkomt.
const NAME_ALIASES = {
  "boshut": "Oehoe"
};

let latestEvents = [];
let lastFetchedAt = null;
let lastError = null;

function parseIcs(text) {
  const events = [];
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  blocks.forEach(block => {
    const summaryMatch = block.match(/SUMMARY:([^\r\n]*)/);
    const startMatch = block.match(/DTSTART[^:]*:(\d{8})/);
    const endMatch = block.match(/DTEND[^:]*:(\d{8})/);
    if (summaryMatch && startMatch && endMatch) {
      events.push({
        name: summaryMatch[1].trim(),
        start: startMatch[1],
        end: endMatch[1]
      });
    }
  });
  return events;
}

async function refreshFromTommy() {
  try {
    const res = await fetch(ICS_URL);
    if (!res.ok) {
      throw new Error("Tommy iCal antwoordde met status " + res.status);
    }
    const text = await res.text();
    latestEvents = parseIcs(text);
    lastFetchedAt = new Date().toISOString();
    lastError = null;
    console.log(`[${lastFetchedAt}] Ververst, ${latestEvents.length} reserveringen gevonden.`);
  } catch (err) {
    lastError = err.message;
    console.error("Verversen mislukt:", err.message);
  }
}

function computeForDate(dateStr) {
  const target = dateStr.replace(/-/g, "");
  const perAccom = {};
  latestEvents.forEach(ev => {
    const lower = ev.name.toLowerCase();
    const aliasName = NAME_ALIASES[lower];
    const idx = aliasName
      ? KNOWN_LOWER.indexOf(aliasName.toLowerCase())
      : KNOWN_LOWER.indexOf(lower);
    if (idx === -1) return;
    const realName = KNOWN_ACCOMMODATIONS[idx];
    if (!perAccom[realName]) perAccom[realName] = { arrival: false, departure: false };
    if (ev.start === target) perAccom[realName].arrival = true;
    if (ev.end === target) perAccom[realName].departure = true;
  });
  return Object.keys(perAccom).map(name => {
    const f = perAccom[name];
    let code = "";
    if (f.arrival && f.departure) code = "W";
    else if (f.arrival) code = "A";
    else if (f.departure) code = "V";
    return { accommodatie: name, code };
  }).filter(item => item.code);
}

function checkAccess(req, res, next) {
  if (req.query.key !== ACCESS_KEY) {
    return res.status(401).json({ error: "Ongeldige of ontbrekende sleutel" });
  }
  next();
}

// --- Gedeelde opslag voor de housekeeping app ---
// Dit gebruikt Upstash, een blijvend gratis opslagdienst, zodat de gegevens een
// nieuwe uitrol of een herstart van Render overleven. Werkt de koppeling met
// Upstash om wat voor reden dan ook niet, dan valt dit terug op een lokaal
// bestand, dat wel gewist kan worden bij een nieuwe uitrol, puur als noodgreep
// zodat de app blijft werken.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_KEY = "mariahoeve-store";
const DATA_FILE = path.join(__dirname, "store.json");

let store = {};

async function loadStore() {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const res = await fetch(`${UPSTASH_URL}/get/${UPSTASH_KEY}`, {
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
      });
      const data = await res.json();
      store = data.result ? JSON.parse(data.result) : {};
      console.log(`Opslag geladen vanuit Upstash, ${Object.keys(store).length} sleutels gevonden.`);
      return;
    } catch (err) {
      console.error("Kon Upstash niet lezen, val terug op lokaal bestand:", err.message);
    }
  }
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      console.log(`Opslag geladen vanuit lokaal bestand, ${Object.keys(store).length} sleutels gevonden.`);
    }
  } catch (err) {
    console.error("Kon opslagbestand niet lezen, begin leeg:", err.message);
    store = {};
  }
}

async function persistStore() {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await fetch(`${UPSTASH_URL}/set/${UPSTASH_KEY}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
        body: JSON.stringify(store)
      });
      return;
    } catch (err) {
      console.error("Kon niet naar Upstash wegschrijven, val terug op lokaal bestand:", err.message);
    }
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store));
  } catch (err) {
    console.error("Kon opslagbestand niet wegschrijven:", err.message);
  }
}

// --- Eindpunten ---

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    lastFetchedAt,
    lastError,
    aantalReserveringen: latestEvents.length,
    aantalOpgeslagenSleutels: Object.keys(store).length
  });
});

app.get("/day/:date", checkAccess, (req, res) => {
  const items = computeForDate(req.params.date);
  res.json({ date: req.params.date, items });
});

app.post("/refresh", checkAccess, async (req, res) => {
  await refreshFromTommy();
  res.json({ ok: true, lastFetchedAt, lastError });
});

// Generieke opslag voor de app zelf
app.get("/data/:key", checkAccess, (req, res) => {
  const key = req.params.key;
  if (!(key in store)) {
    return res.json({ key, value: null });
  }
  res.json({ key, value: store[key] });
});

app.put("/data/:key", checkAccess, async (req, res) => {
  const key = req.params.key;
  store[key] = req.body ? req.body.value : null;
  await persistStore();
  res.json({ ok: true, key });
});

app.delete("/data/:key", checkAccess, async (req, res) => {
  delete store[req.params.key];
  await persistStore();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Mariahoeve Tommy live service draait op poort ${PORT}`);
  await loadStore();
  refreshFromTommy();
  cron.schedule(REFRESH_CRON, refreshFromTommy);
});

