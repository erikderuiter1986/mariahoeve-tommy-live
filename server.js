// Mariahoeve Tommy live sync service
//
// Wat dit doet:
// 1. Haalt elke X minuten de Tommy iCal feed op (dezelfde link die je nu handmatig download)
// 2. Rekent per accommodatie uit of er vandaag, of een andere gevraagde dag, een
//    aankomst (A), vertrek (V) of wissel (W) is
// 3. Levert dat op via een simpel GET eindpunt dat de housekeeping app kan bevragen
//
// Dit vervangt alleen het handmatige downloaden en uploaden van het .ics bestand.
// Voor de arrangementen zoals linnen en handdoeken, of vroege incheck en late uitcheck,
// is dit bestand niet genoeg, die zitten niet in de iCal feed, zie de eerdere spec
// voor de volledige Tommy koppeling als dat straks nodig is.

const express = require("express");
const cors = require("cors");
const cron = require("node-cron");

const app = express();
app.use(cors());

// --- Instellingen, via omgevingsvariabelen zodat er geen geheimen in de code staan ---

// De volledige iCal link die je van Tommy hebt gekregen, inclusief de lange sleutel aan het einde
const ICS_URL = process.env.TOMMY_ICS_URL;

// Een zelf gekozen wachtwoord waarmee de app zich bij dit service moet identificeren
const ACCESS_KEY = process.env.ACCESS_KEY || "verander-dit-wachtwoord";

// Hoe vaak opnieuw ophalen bij Tommy, standaard elke 15 minuten
const REFRESH_CRON = process.env.REFRESH_CRON || "*/15 * * * *";

if (!ICS_URL) {
  console.error("Zet TOMMY_ICS_URL in de omgevingsvariabelen voordat je start.");
  process.exit(1);
}

// Houd deze lijst gelijk aan de accommodatielijst in de housekeeping app zelf.
// Namen die hier niet in staan (kampeerplaatsen, inactieve accommodaties) worden genegeerd.
const KNOWN_ACCOMMODATIONS = [
  "Blikveld", "Boszicht", "Commer", "Dome Galaxy", "Dome Terra",
  "Escape", "Flow", "Hubus", "Kwaak", "Neef Herbert & het Kornuitenhuisje", "Nomad",
  "Oehoe", "Onder Zeil", "Veldzicht", "Walden", "Wodan", "Yurt Odana", "Yurt Tiaki", "Yurt Trikan",
  "Zeezicht"
];
const KNOWN_LOWER = KNOWN_ACCOMMODATIONS.map(n => n.toLowerCase());

// --- In-memory opslag van de laatst opgehaalde reserveringen ---
// Geen database nodig, dit past ruim in het geheugen en wordt elke verversing herbouwd.
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
  // dateStr in de vorm JJJJ-MM-DD, omzetten naar JJJJMMDD zoals in de iCal
  const target = dateStr.replace(/-/g, "");
  const perAccom = {};
  latestEvents.forEach(ev => {
    const idx = KNOWN_LOWER.indexOf(ev.name.toLowerCase());
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

// --- Simpele beveiliging: vraag om de sleutel als querystring parameter ---
function checkAccess(req, res, next) {
  if (req.query.key !== ACCESS_KEY) {
    return res.status(401).json({ error: "Ongeldige of ontbrekende sleutel" });
  }
  next();
}

// --- Eindpunten ---

// Statuscheck, geen sleutel nodig, handig om te zien of de service leeft
app.get("/status", (req, res) => {
  res.json({
    ok: true,
    lastFetchedAt,
    lastError,
    aantalReserveringen: latestEvents.length
  });
});

// De data die de app nodig heeft, bijvoorbeeld /day/2026-08-01?key=jouw-sleutel
app.get("/day/:date", checkAccess, (req, res) => {
  const items = computeForDate(req.params.date);
  res.json({ date: req.params.date, items });
});

// Handmatig een verversing afdwingen, bijvoorbeeld na een wijziging in Tommy
app.post("/refresh", checkAccess, async (req, res) => {
  await refreshFromTommy();
  res.json({ ok: true, lastFetchedAt, lastError });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mariahoeve Tommy live service draait op poort ${PORT}`);
  refreshFromTommy();
  cron.schedule(REFRESH_CRON, refreshFromTommy);
});
