# Änderungen

## 1.1.0 – Kanban-Prozess (in Arbeit)

### Etappe 1: Kern-Erweiterungen der Kanban-Ansicht

Neu ist der Schalter **Kanban-Modus: einfach / Prozess**. Im Modus *einfach*
(Standard) verhält sich das Kanban wie in 1.0.0.

- **Frei konfigurierbare Spalten** (anlegen, umbenennen, Farbe, Reihenfolge per Ziehen
  oder Knopf, löschen mit Abfrage der Zielspalte). Standard-Board: Backlog / Geplant /
  In Arbeit / Review / Erledigt. „Ideen“ ist eine gewöhnliche, optionale Spalte.
- **Spalte und Status bleiben verbunden:** Jede Spalte gehört zu einer Status-Kategorie
  (Ideen, Offen, In Arbeit, Erledigt). Zeitplan, Gantt, Exporte, Prüfregeln und
  „Automatisch planen“ arbeiten unverändert mit dem Status.
- **Karteneditor:** Titel, Inhalt mit Markdown (eigener, sicherer Renderer ohne Bilder
  und ohne HTML), Tags, Farbe, mehrere Zuständige, Aufwand S/M/L, Fälligkeit,
  Priorität, Unterpunkte als Checkliste, Blocker mit Begründung, Löschen.
- **Tags** mit Filter (Mehrfachauswahl); neue Karten übernehmen die aktiven Tags.
- **Kompakte/volle Kartenansicht.**
- **Blocker:** automatisch, solange ein Vorgänger nicht erledigt ist; zusätzlich
  manuell mit Begründung. Sichtbar mit ⛔ und Text.
- **WIP-Limit je Spalte** mit Anzeige „3/3“, Markierung (⚠, Text, Farbe) und kurzem,
  wegklickbarem Hinweis mit Reflexionsfrage.
- **Neue Prüfregeln** K01 (WIP überschritten), K02 (Karte überfällig), K03 (Karte lange
  blockiert).
- **Protokoll** aller aufgabenbezogenen Änderungen (aus allen Ansichten) mit Person und
  Zeit; Ansicht mit Filter nach Person, Karte und Zeitraum. Reine Mindmap-Arbeit wird
  nicht protokolliert. Das Protokoll ist nur anhängbar, auch auf dem Server.
- **Mitglieder** (Kürzel) und „Ich bin …“ ohne gemeinsame Sitzung.
- **Bedienung:** Maus, Finger (iPad), Menü „Verschieben nach …“ und volle
  Tastaturbedienung; Trefferflächen ab 44 px, ARIA-Beschriftungen.
- **Datenschutz:** Sitzungen werden nach 24 Stunden ohne Nutzung gelöscht (vorher
  60 Tage, einstellbar), „Sitzung beenden und Serverdaten löschen“, lange
  Sitzungskennungen (22 statt 8 Zeichen), Content-Security-Policy und
  `Referrer-Policy: no-referrer`, Warnung beim Nur-Ansehen-Link, Hinweis zum Protokoll
  beim ersten Öffnen, Schalter „Protokoll personenbezogen führen“, „Projekt
  abschließen“ (behalten/anonymisieren/löschen), „Alles zu Person X exportieren“,
  „Alle lokalen Daten löschen“. Siehe `DATENSCHUTZ.md` (Entwurf).
- **Lokale Kopie auch in gemeinsamen Sitzungen** (eigener Zwischenspeicher, getrennt von
  der eigenen Arbeit), damit nach dem Löschen der Sitzung nichts verloren ist. Ein alter
  Link zu einer gelöschten Sitzung bietet die Kopie an.
- **Dateiformat Version 2** (`version`/`schemaVersion`): neue Sammlungen `columns`,
  `members`, `events`. Dateien aus 1.0.0 öffnen unverändert; unbekannte Teile aus
  neueren Versionen bleiben erhalten. Beim Öffnen wird die Datei geprüft und
  Probleme werden auf Deutsch gemeldet.
- **Browsertests** mit Playwright (vorher gab es keine): Verhalten von 1.0.0, Kanban,
  Protokoll, Touch, Zusammenarbeit gegen PHP und Flask, Datenschutz.

### Behobene Fehler
- „Wiederholen“-Knopf blieb nach „Rückgängig“ gesperrt (per Tastatur ging es).
