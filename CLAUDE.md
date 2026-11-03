# CLAUDE.md – Mindmap Editor

## Projektüberblick

Mindmap-App für den Unterricht (Sammeln › Ordnen › Planen) mit Gliederung, Kanban,
Zeitplan/Gantt, Präsentation und gemeinsamem Bearbeiten ohne Anmeldung. **Eine
Codebasis** in `web/static/`: läuft im Browser (statisch, mit PHP oder Flask) und als
Desktop-Version (`mindmap_editor.py`, pywebview-Fenster um denselben Web-Code).
Schwester-App zum PAP-Editor. Ausführlich: `README.md`.

## Konventionen

- **Reines HTML/CSS/JavaScript, kein Build-Schritt, keine CDN.** Skripte sind normale
  `<script>`-Dateien mit globalen Funktionen (keine Module); Reihenfolge in
  `index.html` beachten. Bibliotheken lokal in `vendor/`.
- **Alle Oberflächentexte und Kommentare auf Deutsch.** Der Betreuer programmiert
  JavaScript nur rudimentär: einfacher Code, kurze Funktionen, Kommentare zum „Warum“.
- **Jede Änderung am Dokument über `mutate(label, fn, opts)`** (mm-core.js). Nie `doc`
  außerhalb davon ändern – sonst fehlen Rückgängig, Zusammenarbeit, Kanban-Abgleich und
  Protokoll. `opts.merge` fasst Tippen zusammen, `opts.noUndo` ohne Rückgängig.
- Sammlungen sind **Objekte „ID → Eintrag“, nie Listen** (sonst gehen bei gleichzeitigem
  Arbeiten Einträge verloren). Neue Sammlung = in `COLLECTIONS` (mm-core.js) **und** in
  `api/collab.php` **und** `web/app.py` eintragen.
- Dateiformat nur **additiv** erweitern; unbekannte Felder/Sammlungen nie wegwerfen.
  `FORMAT_VERSION` = Schema-Version.
- Touch zuerst (Pointer Events, Trefferflächen ≥ 44 px, Alternative zum Ziehen per
  Menü), volle Tastaturbedienung, Farbe nie als einzige Information.
- Gestaltung: CSS-Variablen in `mindmap.css` (hell/dunkel/schwarz-weiß) – keine neue Optik.
- Datenschutz ist verbindlich (siehe `DATENSCHUTZ.md`): keine Verbindungen zu Dritten,
  keine Cookies, nie „DSGVO-konform“ behaupten (Formulierung: „datenschutzfreundlich
  konzipiert“).
- Nach Änderungen an `web/static/` den Cache-Buster `?v=N` in `index.html` hochzählen
  (einmal pro Release reicht).

## Befehle

```bash
bash start_mindmap.sh               # Desktop-Version aus dem Quellcode
bash web/start_web.sh 5000          # Web-Version mit Flask (http://localhost:5000)
php -S 127.0.0.1:8000 -t web/static # Web-Version mit PHP-Backend

npm install && npx playwright install chromium            # Tests einrichten (einmalig)
python3 -m venv .venv-test && .venv-test/bin/pip install flask
npm test                                                   # alle Browsertests
npx playwright test tests/kanban.spec.js                   # eine Datei
```

Die Tests starten selbst drei Server (statisch 4310, PHP 4311, Flask 4312), siehe
`playwright.config.js`. **Alle Tests müssen grün bleiben**; `tests/baseline.spec.js`
hält das Verhalten von 1.0.0 fest.

## Dateien

| Datei | Inhalt |
|---|---|
| `js/mm-core.js` | Datenmodell, `mutate()`, Operationen, Undo/Redo, Commit-Haken, `normalizeDoc`, `validateFile` |
| `js/mm-layout.js`, `js/mm-map.js` | Zeichnen und Bedienung der Mindmap |
| `js/mm-inspector.js` | Eigenschaften-Feld, Ideen-Eingabe, Timer, Punkte |
| `js/mm-views.js` | Gliederung, Kanban (Modus *einfach*), Zeitplan/Gantt |
| `js/mm-markdown.js` | sicheres Markdown (maskiert zuerst, keine Bilder/HTML) |
| `js/mm-kanban-model.js` | Kanban-Prozess: Spalten, Abgleich, Protokoll, Datenschutz-Funktionen |
| `js/mm-kanban.js` | Kanban-Prozess: Board, Karteneditor, Dialoge (DoD, Vorlagen, Protokoll …) |
| `js/mm-metrics.js` | Kennzahlen aus dem Protokoll – reine Rechnung `computeMetrics(src, now)` |
| `js/mm-kanban-insights.js` | Bereiche „Kennzahlen“ (SVG-Diagramme), „Retrospektive“, „Kriterien“ |
| `js/mm-report.js` | Bericht: `reportMarkdown()`, `reportHtml()`, `printReport()`; eigene helle CSS (`REPORT_CSS`) |
| `js/mm-groups.js` | Gruppenübersicht: `groupSummary(src, now)` je Datei, nur im Arbeitsspeicher |
| `js/mm-check.js` | Prüfregeln M/P/K, „Zum Plan machen“ |
| `js/mm-io.js` | Speichern/Laden, Import/Export, Vorlagen, Einbettung, Desktop-Brücke |
| `js/mm-collab.js` | gemeinsames Bearbeiten (Client) |
| `api/collab.php`, `web/app.py` | Server für gemeinsames Bearbeiten (gleiches Protokoll!) |

## Etappen der Kanban-Erweiterung (Branch `feature/kanban-prozess`, Version 1.1.0)

Arbeitsauftrag: `kanban-app-prompt.md`. Strikt etappenweise, nach jeder Etappe
berichten und auf Freigabe warten.

- [x] **Etappe 1** – Kern: Modus-Schalter, konfigurierbare Spalten, Spalte ↔ Status,
      Karteneditor, Tags, kompakt/voll, Blocker, WIP + K01–K03, Protokoll, Mitglieder,
      Datenschutz 6a (Punkte 1–11), Tests.
- [x] **Etappe 2** – Definition of Done je Spalte, Kennzahlen aus dem Protokoll
      (Lead/Cycle Time, Cumulative Flow, Durchsatz, Blockadedauer) als schlankes SVG,
      Retrospektive (`retros`), Board-Vorlagen (über `TEMPLATES` in mm-io.js +
      `BOARD_TEMPLATES` in mm-kanban-model.js, eigene Vorlagen im Browser).
- [x] **Etappe 3** – Bewertungskriterien (`criteria`, `node.criteriaIds`), Gruppenübersicht
      (mehrere Dateien, nur lokal, `mm-groups.js`), Bericht als Markdown und A4-Druck/PDF
      (`mm-report.js`; PDF über den Druckdialog, Desktop: druckfertige HTML-Datei).

Bewusst nicht: Sprints, Story Points, Epics, Git/Jira, Benachrichtigungen, Accounts,
Cloud, Verschlüsselung, Chat. Anbindung an die PHP-Webapp „Projektmanagement“ nur planen.

## Kanban-Prozess-Modus (technisch)

- Schalter `M().kanbanMode === 'process'`; fehlt das Feld, ist der Modus *einfach* und
  `renderKanban()` in mm-views.js verhält sich wie 1.0.0. Die Handler in `bindKanban()`
  steigen im Prozess-Modus aus; dann arbeitet `bindKanbanProcess()`.
- **Spalte ↔ Status:** Spalten haben `statusKey` (`idea|todo|doing|done`). Knoten haben
  `columnId`. Der Commit-Haken `kanbanReconcile()` hält beides konsistent: geänderte
  `columnId` → Status folgt der Spalte; Status woanders geändert → zuletzt benutzte
  Spalte der Kategorie (aus dem Protokoll), sonst die erste. Jede Kategorie mit Karten
  braucht mindestens eine Spalte (Löschen/Ändern der letzten wird abgelehnt).
- **Protokoll:** Commit-Haken `auditHook()` leitet Einträge aus dem Vergleich vorher/
  nachher ab – dadurch sind Eigenschaften-Feld, Gantt und Gliederung automatisch
  abgedeckt. Ausdrückliche Einträge über `mutate(…, { events: [...] })`, ohne
  Ableitung mit `{ noDerive: true }`. Tippen wird gesammelt (`queuePending`/
  `flushAudit`). Einträge auf `events` sind von Rückgängig ausgenommen (`notEvent` in
  `mutate`/`applyLocal`); Rückgängig erzeugt neue Einträge mit `via: 'undo'`.
  Fremde Änderungen (Zusammenarbeit) laufen nicht durch die Haken – der Absender hat
  sie schon protokolliert.
- **Server:** `events` nur als `put` neuer IDs (kein `set`/`del`, keine Doppel).
  „Projekt abschließen“ (anonymisieren/löschen) geht deshalb nur außerhalb einer Sitzung.
- **Kennzahlen** rechnen mit Kategorien aus `fromCat`/`toCat` der Einträge (ältere
  Einträge: über `toCol` bzw. Beschriftung). Diagrammfarben sind CSS-Variablen
  `--viz-done/doing/todo` (mit dem Dataviz-Prüfer validiert – bei Änderung neu prüfen).
- **Definition of Done:** `kpMoveCard()` (Oberfläche) fragt bei Spalten mit `dod` erst nach;
  `moveCard()` (Logik, Tests) verschiebt direkt.
- Neue Regel: `checkKxx()` in mm-check.js, Aufruf in `evaluateMap()`, Eintrag in `RULES`,
  in README-Tabelle aufnehmen.

## Nicht automatisch getestet

- Desktop-Fenster (pywebview) – keine Bildschirmumgebung in den Tests.
- Echtes iPad/Safari (WebKit): Tests laufen mit Chromium in iPad-Maßen und echten
  Touch-Ereignissen.
- `.htaccess` (Apache-Header, HTTPS-Umleitung): `php -S` liest keine `.htaccess`.
