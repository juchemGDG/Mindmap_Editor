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
- **Kanban** – Spalten Ideen / Offen / In Arbeit / Erledigt, Karten ziehen, Filter nach Ast und Person
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
  js/mm-views.js          Gliederung, Kanban, Zeitplan/Gantt
  js/mm-check.js          Prüfregeln, „Zum Plan machen“
  js/mm-io.js             Speichern/Laden, Import/Export, Vorlagen, Einbettung, Downloads
  js/mm-collab.js         gemeinsames Bearbeiten (Client)
  js/mm-present.js        Präsentation
  api/collab.php          gemeinsames Bearbeiten für PHP-Webspace
```

**Unterschied zum PAP-Editor:** Dort gibt es die Logik zweimal (Tkinter und
JavaScript), die von Hand synchron gehalten werden müssen. Der Mindmap Editor hat
nur **eine** Codebasis: Die Desktop-Version zeigt `web/static` in einem nativen
Fenster und ergänzt echte Öffnen/Speichern-Dialoge. Funktionen kommen dadurch
automatisch in beiden Versionen an.

### Datenmodell und Änderungen

Eine Mindmap besteht aus Sammlungen von Objekten mit ID (`meta`, `nodes`, `links`,
`votes`). Jede Änderung läuft über `mutate()`; daraus entstehen Operationen auf
Feldebene (`put`, `del`, `set`). Dieselben Operationen dienen für Rückgängig/
Wiederholen und für das gemeinsame Bearbeiten – zwei Personen kommen sich nur in die
Quere, wenn sie gleichzeitig **dasselbe Feld desselben Punktes** ändern (dann gewinnt
die spätere Änderung).

Dateiformat (`Speichern`):

```json
{ "format": "mindmap-editor", "version": 1, "doc": {
    "meta":  { "m": { "title": "", "layout": "map", "phase": "collect", "planMode": "simple", … } },
    "nodes": { "root": { "id": "root", "parent": null, "order": 0, "text": "Thema" },
               "n…":   { "id": "n…", "parent": "root", "order": 1, "text": "Idee",
                         "task": true, "status": "todo|doing|done", "owner": "…",
                         "start": "2026-10-20", "due": "2026-10-24", "prio": 1,
                         "deps": ["n…"], "ms": false, "note": "…", "link": "…",
                         "icon": "★", "color": "c3", "shape": "box", "fs": 2, "boundary": "",
                         "collapsed": false, "side": "L", "dx": 0, "dy": 0, "img": "data:…" } },
    "links": { "l…": { "id": "l…", "from": "n…", "to": "n…", "label": "führt zu" } },
    "votes": { "n…|c…": { "node": "n…", "voter": "c…", "n": 2 } } } }
```

## Prüfregeln

„Prüfen“ (bzw. das Abzeichen am Knopf) wertet einen festen Regelkatalog aus –
bewusst milde, fast alles sind Hinweise. Einzelne Regeln lassen sich in der Liste
ausblenden (wird in der Datei gespeichert).

| Gruppe | Regeln |
|---|---|
| Struktur (ab „Ordnen“) | `M01` leere Punkte · `M02` Dubletten unter einem Ast · `M03` lange Sätze statt Stichworte · `M04`/`M05` zu wenige/viele Hauptäste · `M06` Hauptast ohne Unterpunkte · `M07` zu tiefe Verschachtelung · `M08` unausgewogene Äste · `M09` unbeschriftete Querverbindung · `M10` gleicher Begriff an mehreren Stellen |
| Aufgaben („Planen“) | `P01` ohne Zuständige · `P02` ohne Termin · `P03` überfällig · `P04` alle Unteraufgaben erledigt, Oberaufgabe nicht · `P05` Oberaufgabe erledigt, Unteraufgaben offen · `P06` Hauptast ohne Aufgabe |
| Projekt („Planen“, Projektmodus) | `P07` Start nach Ende · `P08` Abhängigkeit verletzt · `P09` Kreis in den Abhängigkeiten · `P10` Unteraufgabe außerhalb der Oberaufgabe |

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

## Gemeinsames Bearbeiten

Server-Teil gibt es zweimal mit **demselben Protokoll** – die Web-App merkt keinen
Unterschied:

- `web/static/api/collab.php` für normalen PHP-Webspace (z. B. Bitpalast/Plesk)
- `/api/collab.php` im Flask-Backend `web/app.py`

Pro Sitzung eine Datei mit aktuellem Stand und den letzten Operationen; die
Teilnehmenden fragen etwa jede Sekunde nach Neuem (kein WebSocket nötig, läuft
deshalb auf jedem Webspace). Links: `?room=…` = ansehen, `?room=…&k=…` = bearbeiten.
Unbenutzte Sitzungen werden nach 60 Tagen gelöscht. Es werden keine Konten angelegt;
gespeichert wird nur, was in der Mindmap steht, plus der selbst gewählte Anzeigename.

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
