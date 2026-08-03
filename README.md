# Mariahoeve Tommy live sync service

Een klein, altijd actief programma dat de Tommy iCal feed periodiek ophaalt en aankomst, vertrek en wissel codes levert aan de housekeeping app. Vervangt het handmatig downloaden en uploaden van het .ics bestand.

## Wat je nodig hebt

- De volledige iCal link die je al van Tommy hebt, inclusief de lange sleutel aan het einde
- Een plek om dit altijd aan te laten staan, bijvoorbeeld Render.com of Railway.app, beide hebben een gratis proeflaag die hiervoor ruim voldoende is, of je eigen server als je die al hebt
- Vijf minuten om twee omgevingsvariabelen in te stellen

## Lokaal proberen, bijvoorbeeld op de MacBook
E
```
cd tommy-live-service
npm install
TOMMY_ICS_URL="https://www.tommybookingsupport.com/iCal/availability/ErikdeRuiter/JOUW-SLEUTEL" ACCESS_KEY="kies-zelf-een-wachtwoord" npm start
```

Test daarna in de browser:

```
http://localhost:3000/status
http://localhost:3000/day/2026-08-01?key=kies-zelf-een-wachtwoord
```

Let op, dit blijft alleen live zolang je computer aan staat en het programma draait. Voor echt altijd actief, zonder dat de MacBook aan hoeft te staan, gebruik je hosting zoals hieronder.

## Hosten op Render.com, gratis laag

1. Zet deze map (`tommy-live-service`) in een eigen GitHub repository
2. Maak een account op render.com, kies New, Web Service, koppel de repository
3. Als Build Command: `npm install`, als Start Command: `npm start`
4. Zet bij Environment Variables:
   - `TOMMY_ICS_URL` met de volledige iCal link
   - `ACCESS_KEY` met een zelf gekozen wachtwoord
5. Na het opstarten krijg je een adres zoals `https://mariahoeve-housekeeping.onrender.com`

Dat adres, samen met je gekozen ACCESS_KEY, vul je in bij de housekeeping app zelf, in de Team tab onder Live koppeling.

## Belangrijk om te weten

- Dit levert alleen aankomst, vertrek en wissel, precies wat de iCal feed bevat
- Linnen, handdoeken, vroege incheck en late uitcheck zitten hier niet in, dat vraagt de volledige Tommy koppeling uit de eerdere technische spec
- Als de accommodatielijst in de app verandert, werk de lijst in `server.js` dan ook bij, ze moeten gelijk blijven
- De gratis laag van Render of Railway kan na een tijd van inactiviteit in slaap gaan en pas bij het eerste verzoek weer opstarten, dat kan de eerste keer een paar seconden vertraging geven, dat is normaal
