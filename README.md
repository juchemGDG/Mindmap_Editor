# Mindmap Editor

Mindmaps erstellen – und schnell vom Brainstorming zum Plan kommen.
Schwester-App zum [PAP-Editor](https://github.com/juchemGDG/PAP_Editor) und zum
IBD-Editor: gleicher Aufbau (Web-Version + Desktop-Version, JSON-Dateien,
Prüfregeln, Einbettung per `?embed=1`), gleiche Gestaltungslinie.

## Der Weg: Sammeln › Ordnen › Planen

Oben in der Leiste stehen drei Phasen. Sie verändern, was angezeigt und geprüft
wird – die Daten bleiben dieselben.

| Phase | Was passiert |
|---|---|
| **1 Sammeln** | Ideen ungefiltert festhalten: Eingabefeld „Ideen sammeln“ (Enter, Enter, Enter …) oder direkt in der Mindmap (`Tab`/`Enter`). Brainstorming-Timer (3/5/10 min, läuft in einer gemeinsamen Sitzung bei allen). Keine Abzeichen, keine Prüfung – nichts lenkt ab. |
| **2 Ordnen** | Gruppieren (`Strg/⌘+G`), Äste verschieben, Querverbindungen, Rahmen. **Punkte vergeben** (Dot-Voting, Anzahl pro Person einstellbar), nach Punkten sortieren. „Prüfen“ gibt Tipps zur Struktur (M-Regeln). |
| **3 Planen** | **„Zum Plan machen“** wandelt Ideen in Aufgaben um (ganze Mindmap oder ein Ast; Endpunkte, alle Unterpunkte oder nur Ideen mit Punkten; Punkte → Prioritäten). Status, Zuständige, Termine, Priorität; Fortschritt wird nach oben summiert (z. B. 3/5). Prüfung der P-Regeln. |

## Funktionen

**Mindmap**
- Drei Anordnungen: Mindmap (beidseitig), Logik-Diagramm (nach rechts),
  **Strukturplan (PSP)**; Linien geschwungen/gerade/eckig; Astfarben dezent oder grau;
  Design hell, dunkel, schwarz-weiß
- Schnell schreiben: markieren und lostippen, `Tab` Unterpunkt, `Enter` Nachbar
  (bei neuen Punkten legt `Enter` gleich den nächsten an), `Shift+Tab` ausrücken,
  Pfeiltasten zum Wandern, `Strg/⌘+↑/↓` verschieben, `Leertaste` ein-/ausklappen
- Ziehen: auf einen Punkt = dort anhängen, an den oberen/unteren Rand = davor/dahinter,
  auf freie Fläche = frei verschieben (Hauptäste wechseln ggf. die Seite)
- Querverbindungen mit Beschriftung, Rahmen um Äste, Notizen, Links, einfarbige Symbole,
  Astfarben, Schriftgröße je Punkt (A−/A+), Formen (Kasten, abgerundet, unterstrichen,
  nur Text), Bilder
- Mehrfachauswahl (Shift-Klick, Shift-Rahmen), Gruppieren, Duplizieren, Sortieren,
  Kopieren/Einfügen – eine eingefügte Textliste wird zur Struktur
- Fokus-Modus (nur ein Ast), Suche (`Strg/⌘+F`), Zoom, Einpassen, Rückgängig/Wiederholen
- iPad: Ziehen mit dem Finger, zwei Finger zum Verschieben/Zoomen, langes Tippen =
  Kontextmenü, Knopfleiste unten für den markierten Punkt

**Ansichten derselben Daten**
- **Gliederung** – die Mindmap als Liste, Bedienung wie in einem Textprogramm
- **Kanban** – Spalten Ideen / Offen / In Arbeit / Erledigt, Karten ziehen, Filter nach Ast und Person.
  Im Modus **Prozess** eigene Spalten mit WIP-Limit, Karteneditor, Tags, Blocker und
  Protokoll (siehe [Kanban-Prozess-Modus](#kanban-prozess-modus))
- **Zeitplan** – zwei Planungsarten:
  - *einfach*: Aufgaben nach Fälligkeit (überfällig, diese Woche, nächste Woche, später)
  - *Projekt*: Start/Ende, Dauer, Meilensteine, Abhängigkeiten, **Gantt-Diagramm**
    (Balken ziehen/verlängern), „Automatisch planen“

**Präsentieren** – Ast für Ast oder Punkt für Punkt aufbauen, Kamerafahrt, Notizen als
Bildunterschrift, Vollbild; in einer gemeinsamen Sitzung „Live für alle“.

**Gemeinsam bearbeiten** (Web-Version) – Sitzung starten, Link bzw. QR-Code zum
Mitmachen oder nur Ansehen (Beamer), Änderungen erscheinen bei allen, farbige Rahmen
zeigen, wer wo arbeitet. Keine Anmeldung, keine Datenbank.

**Dateien** – Speichern/Öffnen als JSON (Web und Desktop identisch); Export als PNG, JPG,
SVG, Drucken/PDF, Markdown-Gliederung, OPML, Aufgabenliste (Markdown, CSV) und Termine
(ICS für den Kalender); Import von Markdown/Textlisten, OPML und FreeMind (`.mm`).
Vorlagen: W-Fragen, Projektplanung, Unterrichtsvorbereitung, Pro & Contra,
Ursachen (Ishikawa), Referat.

## Aufbau

```
mindmap_editor.py         Desktop-Version (pywebview-Fenster um web/static)
mindmap_editor.spec       PyInstaller
packaging/                Build-Skripte macOS/Windows/Linux, Icons
.github/workflows/        Pakete auf GitHub bauen und ans Release hängen
web/app.py                Flask-Backend: Seite, gemeinsames Bearbeiten, Desktop-Downloads
web/static/               die eigentliche App (läuft auch rein statisch)
  index.html, mindmap.css
  js/mm-core.js           Datenmodell, Operationen, Undo/Redo
  js/mm-layout.js         Layout und Zeichnen (Canvas, PNG und SVG aus derselben Routine)
  js/mm-map.js            Mindmap-Ansicht: Maus, Touch, Tastatur, Kontextmenü
  js/mm-inspector.js      Eigenschaften, Ideen-Eingabe, Timer, Punkte
  js/mm-views.js          Gliederung, Kanban (Modus einfach), Zeitplan/Gantt
  js/mm-markdown.js       sicheres Markdown für Karteninhalte (ohne HTML und Bilder)
  js/mm-kanban-model.js   Kanban-Prozess: Spalten, Abgleich Spalte ↔ Status, Protokoll, Datenschutz
  js/mm-kanban.js         Kanban-Prozess: Board, Karteneditor, Dialoge
  js/mm-check.js          Prüfregeln, „Zum Plan machen“
  js/mm-io.js             Speichern/Laden, Import/Export, Vorlagen, Einbettung, Downloads
  js/mm-collab.js         gemeinsames Bearbeiten (Client)
  js/mm-present.js        Präsentation
  api/collab.php          gemeinsames Bearbeiten für PHP-Webspace
tests/                    Browsertests (Playwright), siehe tests/README.md
DATENSCHUTZ.md            Datenschutz (Entwurf für die Schule)
CHANGELOG.md              Änderungen je Version
```

**Unterschied zum PAP-Editor:** Dort gibt es die Logik zweimal (Tkinter und
JavaScript), die von Hand synchron gehalten werden müssen. Der Mindmap Editor hat
nur **eine** Codebasis: Die Desktop-Version zeigt `web/static` in einem nativen
Fenster und ergänzt echte Öffnen/Speichern-Dialoge. Funktionen kommen dadurch
automatisch in beiden Versionen an.

### Datenmodell und Änderungen

Eine Mindmap besteht aus Sammlungen von Objekten mit ID (`meta`, `nodes`, `links`,
`votes`, seit 1.1.0 auch `columns`, `members`, `events`). Jede Änderung läuft über
`mutate()`; daraus entstehen Operationen auf Feldebene (`put`, `del`, `set`). Dieselben
Operationen dienen für Rückgängig/Wiederholen und für das gemeinsame Bearbeiten – zwei
Personen kommen sich nur in die Quere, wenn sie gleichzeitig **dasselbe Feld desselben
Punktes** ändern (dann gewinnt die spätere Änderung). Weil jede Sammlung ein Objekt
„ID → Eintrag“ ist (keine Liste), gehen Protokolleinträge beim gleichzeitigen Arbeiten
nie verloren.

Dateiformat (`Speichern`), `version` = Schema-Version (1 = 1.0.0, 2 = ab 1.1.0):

```json
{ "format": "mindmap-editor", "version": 2, "schemaVersion": 2, "doc": {
    "meta":  { "m": { "title": "", "layout": "map", "phase": "collect", "planMode": "simple",
                      "kanbanMode": "process", "kanbanPersonal": false, "kanbanPurpose": "…", … } },
    "nodes": { "root": { "id": "root", "parent": null, "order": 0, "text": "Thema" },
               "n…":   { "id": "n…", "parent": "root", "order": 1, "text": "Idee",
                         "task": true, "status": "todo|doing|done", "owner": "AB, CD",
                         "start": "2026-10-20", "due": "2026-10-24", "prio": 1,
                         "deps": ["n…"], "ms": false, "note": "…", "link": "…",
                         "icon": "★", "color": "c3", "shape": "box", "fs": 2, "boundary": "",
                         "collapsed": false, "side": "L", "dx": 0, "dy": 0, "img": "data:…",
                         "columnId": "k…", "tags": ["Holz"], "estimate": "S|M|L",
                         "blocked": { "flag": true, "reason": "…", "since": 1767000000000 } } },
    "links": { "l…": { "id": "l…", "from": "n…", "to": "n…", "label": "führt zu" } },
    "votes": { "n…|c…": { "node": "n…", "voter": "c…", "n": 2 } },
    "columns": { "k…": { "id": "k…", "order": 1, "title": "Review", "statusKey": "idea|todo|doing|done",
                         "wip": 2, "color": "c2" } },
    "members": { "p…": { "id": "p…", "name": "AB" } },
    "events":  { "e…": { "id": "e…", "t": 1767000000000, "who": "AB", "type": "task.moved",
                         "task": "n…", "title": "…", "from": "In Arbeit", "to": "Review" } } } }
```

Mehrere Zuständige stehen durch Komma getrennt im bisherigen Feld `owner` – so zeigen
auch ältere Versionen sie an. Dateien aus 1.0.0 öffnen unverändert; Teile, die eine
Version nicht kennt, bleiben beim Speichern erhalten (Ausnahme: **1.0.0 selbst** verwirft
beim Öffnen die Sammlungen `columns`, `members` und `events` – eine 1.1-Datei, die in
1.0.0 gespeichert wird, verliert Board und Protokoll).

## Prüfregeln

„Prüfen“ (bzw. das Abzeichen am Knopf) wertet einen festen Regelkatalog aus –
bewusst milde, fast alles sind Hinweise. Einzelne Regeln lassen sich in der Liste
ausblenden (wird in der Datei gespeichert).

| Gruppe | Regeln |
|---|---|
| Struktur (ab „Ordnen“) | `M01` leere Punkte · `M02` Dubletten unter einem Ast · `M03` lange Sätze statt Stichworte · `M04`/`M05` zu wenige/viele Hauptäste · `M06` Hauptast ohne Unterpunkte · `M07` zu tiefe Verschachtelung · `M08` unausgewogene Äste · `M09` unbeschriftete Querverbindung · `M10` gleicher Begriff an mehreren Stellen |
| Aufgaben („Planen“) | `P01` ohne Zuständige · `P02` ohne Termin · `P03` überfällig · `P04` alle Unteraufgaben erledigt, Oberaufgabe nicht · `P05` Oberaufgabe erledigt, Unteraufgaben offen · `P06` Hauptast ohne Aufgabe |
| Projekt („Planen“, Projektmodus) | `P07` Start nach Ende · `P08` Abhängigkeit verletzt · `P09` Kreis in den Abhängigkeiten · `P10` Unteraufgabe außerhalb der Oberaufgabe |
| Kanban (Kanban-Modus „Prozess“) | `K01` WIP-Limit einer Spalte überschritten (mit Reflexionsfrage) · `K02` Karte überfällig (nur wenn `P03` nicht schon meldet) · `K03` Karte seit mehr als 3 Tagen blockiert |

Neue Regel: Funktion `checkXX…()` in `web/static/js/mm-check.js` schreiben, in
`evaluateMap()` aufrufen und in `RULES` eintragen.

## Start

```bash
bash start_mindmap.sh          # Desktop-Version aus dem Quellcode
bash web/start_web.sh          # Web-Version mit Flask auf http://localhost:5000
```

Für die Desktop-Version: `pip install -r requirements.txt` (pywebview; unter Linux
zusätzlich PySide6). Pakete bauen: siehe `packaging/README.md`. Auf den Server
bringen: siehe `web/DEPLOY.md`.

**Tests** (Playwright; die App selbst braucht kein npm): einmalig `npm install`,
`npx playwright install chromium` und ein venv mit Flask, dann `npm test`.
Details in `tests/README.md`.

## Gemeinsames Bearbeiten

Server-Teil gibt es zweimal mit **demselben Protokoll** – die Web-App merkt keinen
Unterschied:

- `web/static/api/collab.php` für normalen PHP-Webspace (z. B. Bitpalast/Plesk)
- `/api/collab.php` im Flask-Backend `web/app.py`

Pro Sitzung eine Datei mit aktuellem Stand und den letzten Operationen; die
Teilnehmenden fragen etwa jede Sekunde nach Neuem (kein WebSocket nötig, läuft
deshalb auf jedem Webspace). Links: `?room=…` = ansehen, `?room=…&k=…` = bearbeiten
(Raum-Kennung mit 22 zufälligen Zeichen; alte 8-stellige Links gehen weiter).
Unbenutzte Sitzungen werden nach **24 Stunden** gelöscht (`MINDMAP_ROOM_TTL_HOURS`),
„Sitzung beenden und Serverdaten löschen“ löscht sofort (Aktion `close`, nur mit
Schlüssel). Das Protokoll (`events`) nimmt der Server nur als **neue** Einträge an
(kein Ändern, kein Löschen, keine Doppel). Jedes Gerät behält eine Kopie im Browser.
Es werden keine Konten angelegt; gespeichert wird nur, was in der Mindmap steht, plus
das selbst gewählte Kürzel.

## Kanban-Prozess-Modus

Wer die Mindmap nur zum Brainstormen nutzt, merkt davon nichts: Alles steckt hinter dem
Schalter **Kanban › Einfach / Prozess** (Standard: einfach, wie in 1.0.0). Der Modus
begleitet Projektphasen im NIT/NwT-Unterricht mit dem, was Kanban in der Wirtschaft
ausmacht: begrenzte gleichzeitige Arbeit (WIP-Limits), sichtbare Blockaden und ein
nachvollziehbarer Ablauf als Grundlage für Reflexion.

### Kurzanleitung für Lehrkräfte

1. Mindmap anlegen, „Zum Plan machen“ (oder Aufgaben von Hand markieren).
2. **Kanban** öffnen und oben **Prozess** wählen. Es entsteht das Board *Backlog /
   Geplant / In Arbeit (Limit 3) / Review (Limit 2) / Erledigt*; vorhandene Aufgaben
   werden nach ihrem Status einsortiert.
3. Über **⚙** an jeder Spalte: Name, Status-Kategorie, WIP-Limit, Farbe, Position,
   Löschen (die Karten wandern in eine Zielspalte, keine geht verloren). **+ Spalte**
   legt neue an – z. B. „Ideen“ mit der Kategorie „Ideen (noch keine Aufgabe)“.
4. **Datenschutz**: Zweck des Protokolls eintragen (wird allen beim ersten Öffnen
   angezeigt), entscheiden, ob es **personenbezogen** geführt wird. Am Ende **Projekt
   abschließen**: Protokoll behalten, anonymisieren oder löschen.
5. **Gemeinsam** › Sitzung starten, Link/QR-Code an die Gruppe. Am Ende speichern und
   **Sitzung beenden und Serverdaten löschen**.

### Kurzanleitung für Schülerinnen und Schüler

- Oben **„Ich bin …“** dein Kürzel wählen (in einer gemeinsamen Sitzung ist es schon
  gesetzt). Ein Kürzel oder Spitzname genügt.
- **Karte antippen** öffnet sie: Titel, Inhalt (Markdown), Tags, Farbe, Zuständige,
  Aufwand S/M/L, Fälligkeit, Priorität, Checkliste (= Unterpunkte in der Mindmap),
  Blocker mit Begründung.
- **Verschieben:** Karte ziehen – oder **⋯** › „Verschieben nach …“ – oder mit der
  Tastatur: Karte anwählen, <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd>. Pfeiltasten
  wandern, <kbd>Enter</kbd> öffnet, <kbd>M</kbd> öffnet das Menü.
- Steht im Spaltenkopf **⚠ 4/3**, ist das WIP-Limit überschritten. Frage dich: *Was
  hindert uns, etwas abzuschließen, bevor wir Neues beginnen?*
- **⛔ blockiert** heißt: Die Karte wartet auf eine andere Aufgabe oder hängt fest.
  Holt euch Hilfe!

### Spalte und Status

Jede Spalte gehört zu einer **Status-Kategorie** des bisherigen Modells (Ideen / Offen /
In Arbeit / Erledigt). Die **Spalte ist die Wahrheit für das Kanban, der Status bleibt
die Wahrheit für alle anderen Ansichten** (Zeitplan, Gantt, Exporte, Prüfregeln,
Automatisch planen):

- Wird eine Karte verschoben, setzt die App den Status passend zur Spalte
  (Review → „In Arbeit“).
- Ändert sich der Status woanders (Eigenschaften-Feld, Gliederung, Gantt), kommt die
  Karte in eine Spalte dieser Kategorie – bei mehreren in die **zuletzt benutzte**
  (laut Protokoll), sonst in die erste.

Beides passiert im selben Schritt (`kanbanReconcile()` in `mm-kanban-model.js`) und ist
damit auch zusammen rückgängig zu machen.

### Protokoll – was es ist und was nicht

Jede **aufgabenbezogene** Änderung erzeugt automatisch einen Eintrag (wer, wann, was,
welche Karte, von → nach) – egal ob im Kanban, im Eigenschaften-Feld, im Zeitplan oder
in der Gliederung. Reine Mindmap-Arbeit (Ideen, Layout, Farben) wird nicht
protokolliert; Inhalte von Titeln und Notizen werden nicht kopiert. Rückgängig löscht
keine Einträge, sondern ergänzt einen neuen.

> **Das Protokoll ist ein Arbeitsnachweis, kein Beweis.** Es gibt keine Anmeldung:
> Jede Person wählt ihr Kürzel selbst, und wer die Datei hat, kann sie verändern. Es
> eignet sich als Gesprächsgrundlage und zur Reflexion, aber nicht als alleinige
> Grundlage für eine Note.

### Datenschutz

Datenschutzfreundlich konzipiert: lokal als Standard, Kürzel statt Namen, keine Cookies
(nur `localStorage` für Dokument und Einstellungen), keine Verbindungen zu Dritten,
Sitzungen nach 24 Stunden gelöscht, Protokoll abschaltbar, anonymisierbar und löschbar,
Auskunft „Alles zu Person X exportieren“. Ob der Einsatz zulässig ist, entscheidet die
Schule. Ausführlich: [`DATENSCHUTZ.md`](DATENSCHUTZ.md) (Entwurf, mit Muster für die
Information von Schülerinnen, Schülern und Eltern).

## Einbettung in andere Web-Apps (`?embed=1`)

Wie beim PAP-Editor (z. B. für das Projektmanagement-Tool). Mit `?embed=1`
erscheinen „In Projekt übernehmen“ und „Schließen“; Desktop-Download und
gemeinsames Bearbeiten entfallen.

| Richtung | Nachricht |
|---|---|
| Editor → Host | `{source:'mindmap-editor', event:'ready'}` |
| Host → Editor | `{target:'mindmap-editor', action:'load', mindmap:<JSON wie "Speichern" oder null>, title, downloads:true}` |
| Editor → Host | `{source:'mindmap-editor', event:'save', mindmap:<JSON>, svg:<SVG-Text>}` |
| Editor → Host | `{source:'mindmap-editor', event:'exit'}` |
| Editor → Host | `{source:'mindmap-editor', event:'download', name, mime, blob:<Blob>}` |

Statt `mindmap` wird auch `diagram` angenommen und mitgeschickt (wie beim PAP-Editor).
Mit `downloads:true` übergibt der Editor Dateien an den Host, statt sie selbst
herunterzuladen (Browser blockieren Downloads im iframe oft). Der Editor nimmt nur
Nachrichten seines Eltern-Fensters an und schickt Daten nur an dessen Origin.
