# Datenschutz beim Mindmap Editor

> **ENTWURF – keine Rechtsberatung.**
> Dieses Dokument beschreibt, welche Daten die App verarbeitet und wie sie geschützt
> werden. Es ersetzt keine rechtliche Prüfung. **Vor dem Einsatz mit der bzw. dem
> Datenschutzbeauftragten der Schule abstimmen.** Ob und wie die App eingesetzt wird,
> entscheidet die Schule (Schulleitung, Datenschutzbeauftragte), nicht die App.

Die App ist **datenschutzfreundlich konzipiert**: so wenig Daten wie möglich, nur für
einen klaren Zweck, für alle sichtbar und jederzeit löschbar.

## 1. Wofür werden Daten verarbeitet? (Zweck)

- **Mindmap und Plan:** Ideen sammeln, ordnen und Aufgaben planen (Unterricht, z. B.
  Projektarbeit in NIT/NwT).
- **Gemeinsames Bearbeiten:** Mehrere Personen arbeiten gleichzeitig an einer Mindmap.
- **Protokoll im Kanban-Modus „Prozess“:** Es hält fest, wer wann welche Karte angelegt,
  verschoben oder geändert hat. Es kann die **Reflexion** der Gruppenarbeit unterstützen
  und – wenn die Schule das so festlegt – auch die **Bewertung der Gruppenarbeit**.
  Den genauen Zweck trägt die Lehrkraft in der Datei ein (Knopf „Datenschutz“ im
  Kanban). Er wird allen beim ersten Öffnen angezeigt und mit der Datei weitergegeben.

Das Protokoll ist ein **Arbeitsnachweis, kein Beweis**: Es entsteht ohne Anmeldung, jede
Person wählt ihr Kürzel selbst, und wer die Datei hat, kann sie verändern. Es darf
deshalb nicht als alleinige Grundlage für eine Note dienen.

## 2. Welche Daten? (Kategorien)

| Daten | Beispiel | Personenbezug |
|---|---|---|
| Inhalte der Mindmap | Ideen, Notizen, Bilder, Links | nur wenn jemand Persönliches hineinschreibt |
| Zuständige / Mitglieder | `AB`, `Lena` | ja – darum **nur Kürzel oder Spitzname**, kein Klarname nötig, kein E-Mail-Feld |
| Aufgaben | Status, Termine, Priorität, Aufwand, Tags | über die Zuständigen |
| Retrospektiven (nur Modus „Prozess“) | Antworten der Gruppe auf die Leitfragen | nur wenn jemand Namen hineinschreibt – Hinweis in der App: keine Bewertungen einzelner Personen |
| Protokoll (nur Modus „Prozess“) | „14:05 AB: Karte ‚Platine löten‘ verschoben: In Arbeit → Review“ | ja, mit **Bewertungsbezug** – abschaltbar („personenbezogen führen: aus“) |
| Punkte (Dot-Voting) | wer wie viele Punkte vergeben hat | ja (zufällige Geräte-ID und ggf. Kürzel) |
| Anwesenheit in einer Sitzung | Kürzel, Farbe, markierter Punkt | ja, nur während der Sitzung |
| Technisch | zufällige Geräte-ID (`mm-client-id`), IP-Adresse im Zugriffsprotokoll des Webservers | ja (IP-Adresse) |

Ins Protokoll kommen **keine Inhalte** von Titeln oder Notizen (nur „Titel geändert“),
keine Begründungen von Blockern und keine Bilder. Reine Mindmap-Arbeit (Ideen,
Layout, Farben) wird nicht protokolliert.

## 3. Wer ist betroffen?

Schülerinnen und Schüler (in der Regel minderjährig) und Lehrkräfte.

## 4. Wo liegen die Daten? (Datenfluss)

**Standard: alles lokal.**

```
 Gerät (Browser oder Desktop-Version)
 ├─ Datei „Speichern“ (.json) ............ dort, wo man sie speichert
 └─ Zwischenspeicher des Browsers ........ localStorage: zuletzt geöffnete Mindmap + Einstellungen

 nur während einer gemeinsamen Sitzung:
 Gerät ⇄ eigener Webserver der Schule (api/collab.php bzw. Flask)
         └─ eine Datei je Sitzung: aktueller Stand (inkl. Protokoll) + letzte Änderungen
```

- **Ohne gemeinsame Sitzung** verlässt nichts das Gerät.
- **In einer gemeinsamen Sitzung** liegt auf dem Server: der komplette Stand der Mindmap
  (alle Inhalte, Zuständige, Mitglieder, Protokoll, Punkte), die letzten 3000 Änderungen
  mit der zufälligen Geräte-ID, der Bearbeiten-Schlüssel und der Startzeitpunkt. Dazu
  eine kleine Anwesenheitsliste (Kürzel, Farbe, markierter Punkt, Ansicht); Einträge
  verschwinden 15 Sekunden nach dem letzten Lebenszeichen.
- **Keine Dritten:** keine CDN, keine fremden Schriftarten, keine Analyse- oder
  Tracking-Werkzeuge, keine externen Bilder (auch nicht in Markdown – Bilder erscheinen
  nur als Link). QR-Codes werden im Browser erzeugt. Eine Content-Security-Policy
  verhindert Verbindungen zu fremden Servern.
  **Einzige Ausnahme:** Der Klick auf „Desktop-Version“ fragt bei GitHub nach dem
  neuesten Paket (nur bei reinem PHP-Webspace; mit Flask-Backend fragt der Server).
- **Links** in Notizen öffnen fremde Seiten nur, wenn man sie anklickt.
- **Keine Cookies.** `localStorage` enthält nur das Dokument und Einstellungen
  (`mm-autosave` = eigene Mindmap, `mm-session-copy` = Kopie der letzten gemeinsamen
  Sitzung, `mm-name`, `mm-client-id`, `mm-color`, `mm-theme`, `mm-view`,
  `mm-inspector`, `mm-grid`, `mm-kanban-compact`, `mm-kanban-notice`, `mm-kanban-pane`,
  `mm-board-templates` = eigene Board-Vorlagen ohne Karten und Personen).

## 5. Wie lange? (Speicherdauer und Löschung)

| Ort | Löschung |
|---|---|
| Sitzung auf dem Server | automatisch **24 Stunden nach der letzten Nutzung** (einstellbar, `MINDMAP_ROOM_TTL_HOURS`), oder **sofort** mit „Sitzung beenden und Serverdaten löschen“ |
| Anwesenheit | 15 Sekunden nach dem letzten Lebenszeichen; mit der Sitzung gelöscht |
| Zugriffsprotokoll des Webservers (IP) | nach den Einstellungen des Servers – Empfehlung: IP kürzen, höchstens 7 Tage (siehe `web/DEPLOY.md`) |
| Zwischenspeicher im Browser | bis zum nächsten Dokument oder per „Alle lokalen Daten dieser App löschen“ (Kanban › Datenschutz) |
| Datei | liegt dort, wo sie gespeichert wurde – Verantwortung der Person bzw. Schule |
| Protokoll in der Datei | „Projekt abschließen“: behalten, **anonymisieren** (Personen → „Person 1, 2 …“, auch bei den Zuständigen) oder **löschen** |

## 6. Technische und organisatorische Maßnahmen

**In der App umgesetzt**
1. Datensparsamkeit: Kürzel statt Namen (Hinweis „Kürzel oder Spitzname genügt“), kein
   E-Mail-Feld, keine Konten, keine Inhalte im Protokoll.
2. Lokal als Standard; Server nur während einer Sitzung.
3. Automatische Löschung von Sitzungen nach 24 Stunden ohne Nutzung, sofortiges Löschen
   per Knopf; keine Datenbank, keine dauerhafte Ablage.
4. Keine Verbindungen zu Dritten (CSP), Markdown ohne HTML und ohne Bilder.
5. Keine Cookies.
6. Sitzungen: Kennung mit 22 zufälligen Zeichen (≈ 109 Bit), getrennter Schlüssel
   zum Bearbeiten (96 Bit), Nur-Ansehen-Links mit Warnung „nicht öffentlich
   weitergeben“, Header `Content-Security-Policy`, `Referrer-Policy: no-referrer`,
   `X-Content-Type-Options: nosniff`, Betrieb nur über HTTPS (Voraussetzung, siehe
   `web/DEPLOY.md`). Das Protokoll ist auf dem Server nur anhängbar.
7. Transparenz: Hinweis beim ersten Öffnen im Prozess-Modus (was, wer sieht es, Zweck).
8. Schalter „Protokoll personenbezogen führen“ – aus: nur Zeit und Art, keine Person.
9. Löschen und Anonymisieren („Projekt abschließen“), „Alle lokalen Daten löschen“.
10. Auskunft: „Alles zu Person X exportieren“ (Aufgaben und Protokolleinträge als JSON);
    der normale JSON-Export enthält alle Daten.
11. Die geplante Gruppenübersicht (Etappe 3) arbeitet nur lokal im Browser.

**Aufgabe der Schule bzw. des Betriebs**
- Webserver mit HTTPS, Zugriffsprotokolle gekürzt bzw. kurz aufbewahrt (`web/DEPLOY.md`).
- Sitzungsablage außerhalb des Web-Verzeichnisses (`api/config.php`).
- Klare Regeln in der Klasse: Kürzel statt Namen, keine persönlichen Inhalte,
  Bearbeiten-Links nur in der Gruppe teilen.

## 7. Offene Punkte für die Schule

- [ ] **Rechtsgrundlage** klären und **Freigabe** durch Schulleitung und
      Datenschutzbeauftragte(n), besonders wenn das Protokoll zur **Bewertung** dient.
- [ ] **Information** der Schülerinnen und Schüler und der Eltern (Muster unten); ggf.
      **Einwilligung** bei Minderjährigen klären.
- [ ] Wird die App von einem **Dritten gehostet** (z. B. Webspace-Anbieter), einen
      Vertrag zur **Auftragsverarbeitung** (Art. 28 DSGVO) abschließen.
- [ ] Eintrag ins **Verzeichnis der Verarbeitungstätigkeiten**.
- [ ] Festlegen, wer die Dateien mit Protokoll aufbewahrt und wann sie gelöscht werden
      (z. B. nach Ende des Schuljahres bzw. nach der Bewertung).
- [ ] Festlegen, ob das Protokoll personenbezogen geführt wird oder nicht.

## 8. Muster: Information für Schülerinnen, Schüler und Eltern (Entwurf)

> **Projektarbeit mit dem Mindmap Editor**
>
> Im Fach ____ arbeiten die Gruppen mit dem Mindmap Editor. Damit sammelt ihr Ideen und
> plant eure Aufgaben auf einem Kanban-Board.
>
> **Was wird gespeichert?** Eure Ideen und Aufgaben, wer für eine Aufgabe zuständig ist
> (nur ein **Kürzel**, kein vollständiger Name) und – im Kanban-Modus „Prozess“ – ein
> **Protokoll**: wer wann eine Karte angelegt, verschoben oder geändert hat. Inhalte von
> Notizen kommen nicht ins Protokoll.
>
> **Wozu?** ____________________ (z. B. „damit ihr euren Arbeitsprozess reflektieren
> könnt und als eine Grundlage für die Bewertung der Gruppenarbeit“). Das Protokoll ist
> ein Arbeitsnachweis, kein Beweis, und nie die einzige Grundlage einer Note.
>
> **Wo?** Normalerweise nur auf eurem Gerät bzw. in der gespeicherten Datei. Wenn ihr
> gemeinsam arbeitet, liegt die Mindmap vorübergehend auf dem Server der Schule und wird
> spätestens 24 Stunden nach der letzten Nutzung gelöscht. Es werden keine Daten an
> andere Firmen weitergegeben, es gibt keine Konten und keine Werbung.
>
> **Wer sieht es?** Alle in eurer Gruppe und die Lehrkraft.
>
> **Löschen und Auskunft:** Am Projektende wird das Protokoll ____ (gelöscht /
> anonymisiert / bis ____ aufbewahrt). Ihr könnt jederzeit fragen, welche Einträge es zu
> euch gibt.
>
> Fragen an: ____ (Lehrkraft) bzw. ____ (Datenschutzbeauftragte/r der Schule)
