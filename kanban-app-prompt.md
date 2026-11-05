# Prompt für Claude Code: Kanban-Erweiterung des Mindmap_Editors (Variante A)

> **Hinweis an mich selbst (Stephan):** Claude Code in VS Code **im Mindmap_Editor-Repo starten** (Arbeitsverzeichnis = Projektwurzel), am besten auf einem eigenen Branch `feature/kanban-prozess`. Es gibt keinen Platzhalter mehr, den ich ausfüllen muss.

## 0. Ausgangslage

Der Mindmap_Editor (aufbauend auf der PAP_Editor-Architektur, Version 1.0.0) hat bereits eine **Kanban-Ansicht** auf denselben Daten wie die Mindmap. Nach meinem Kenntnisstand (bitte im Code verifizieren, siehe Abschnitt 2) gibt es:

- Kanban mit festen Spalten Ideen / Offen / In Arbeit / Erledigt, Karten per Drag & Drop, Filter nach Ast und Person, Hinzufügen-Button je Spalte. **Karten sind Aufgaben-Knoten der Mindmap**, im Kanban steht der Ast als Pfad.
- Aufgaben mit Status, Zuständigen (Freitext-Namen), Fälligkeit, Priorität
- Zeitplan im Modus *einfach* und *Projekt*: Start/Ende, Dauer, **Meilensteine**, **Abhängigkeiten**, Gantt mit Balken ziehen, „Automatisch planen"
- **Gemeinsames Bearbeiten ohne Anmeldung und ohne Datenbank** (`api/collab.php` für Bitpalast, dasselbe Protokoll im Flask-Backend), Link/QR-Code, Nur-Ansehen-Modus, farbige Markierung, wer wo arbeitet
- Desktop-Version als **pywebview-Fenster um denselben Web-Code**
- Regelkatalog im Stil des PAP_Editors (Regel-IDs M01–M10, P01–P10, milde, wegklickbare Hinweise)
- Rückgängig/Wiederholen, Exporte (JSON, Aufgabenliste Markdown/CSV, ICS u. a.), Einbettung per postMessage, Vorlagen
- Browsertests mit Playwright (Tastatur, Maus, Touch/iPad, Zusammenarbeit gegen PHP und Flask)

Als Referenz für ein schlichtes, beliebtes Kanban dient das **CryptPad-Kanban**: Karten mit Markdown-Inhalt, Tags mit Filter, Karten- und Spaltenfarben, kompakte/volle Ansicht, frei benennbare Spalten.

## 1. Ziel

Die **vorhandene Kanban-Ansicht des Mindmap_Editors wird erweitert**, sodass sie die Projektphasen im NIT/NwT-Unterricht begleiten kann. Es entsteht keine neue App. Ergänzt wird, was echtes Kanban in der Wirtschaft ausmacht und im Unterricht Reflexion ermöglicht:

1. frei konfigurierbare Spalten mit **WIP-Limits** (weich, nicht sperrend)
2. **Nachvollziehbarkeit** (Protokoll: wer hat wann was getan) als Grundlage für individuelle Bewertung in der Gruppenarbeit
3. **Definition of Done** pro Spalte
4. **Kennzahlen** (Durchlaufzeit, Cumulative Flow) und **Retrospektive**
5. **Bewertungskriterien** und eine **Gruppenübersicht** für die Lehrkraft

**Leitprinzip:** Wer die Mindmap nur zum Brainstormen nutzt, darf nichts davon merken. Alles Neue steckt hinter einem Schalter **„Kanban-Modus: einfach (wie bisher) / Prozess"**, analog zur bestehenden Wahl „einfach / Projekt" beim Planen. Im Modus *einfach* verhält sich Kanban exakt wie in Version 1.0.0.

## 2. Schritt 0: Bestandsaufnahme (Pflicht, noch kein Code)

1. Lies README, `web/DEPLOY.md`, `CLAUDE.md` (falls vorhanden), Startskripte, Paketierung, vorhandene Tests und eine eventuell vorhandene Datenschutz-Dokumentation.
2. Verschaffe dir einen Überblick über den Code (Funktions-/Konstantenübersicht per `grep -n "^function \|^const \|^class "`), insbesondere:
   - **Datenmodell der Knoten und Aufgaben**, vor allem das **Status-Modell** (Schlüssel wie `idea`/`open`/`doing`/`done`) und wo es überall benutzt wird (Kanban, Zeitplan, Gantt, Gliederung, Exporte, Regeln, Auto-Planen)
   - `renderKanban`/`bindKanban`, Zeitplan/Gantt, Regelkatalog (M/P-Regeln), Rückgängig/Wiederholen, Eigenschaften-Feld und Notizen (unterstützen sie Markdown?), Tags/Farben, Vorlagen
   - **Synchronisierung in `collab`:** werden ganze Zustände oder einzelne Änderungen übertragen? Was liegt serverseitig?
   - Dateimenü, Embedding-Protokoll, pywebview-Brücke
3. Lege eine **Gap-Analyse** vor, als Tabelle mit drei Spalten: *Schon vorhanden (wiederverwenden)* / *Vorhanden, aber anzupassen* / *Fehlt*. Bezug sind die Ziele aus Abschnitt 1 und die Etappen aus Abschnitt 4.
4. Schlage vor, **wie die neuen Funktionen in den Code kommen** (z. B. in eigene Dateien/Module statt die bestehende Datei weiter aufzublähen, soweit das ohne Build-Schritt möglich ist) und **wie das Status-Modell erweitert wird** (siehe Abschnitt 5). Nenne Vor- und Nachteile, empfiehl eine Variante und **warte auf meine Freigabe**.
5. Benenne Risiken, vor allem: **Status-Modell und alle davon abhängigen Ansichten** sowie **Protokoll und Zusammenarbeit**.

## 3. Zielbild

- Eine einzige App, eine Codebasis, ein Dateiformat. Bestehende Mindmap-Dateien aus Version 1.0.0 lassen sich unverändert öffnen. Neue Dateien bleiben in der Mindmap lesbar (unbekannte Felder werden nicht gelöscht).
- Die Kanban-Ansicht bleibt eine **Ansicht auf die Aufgaben der Mindmap**. Eine neue Karte im Kanban erzeugt weiterhin einen Aufgaben-Knoten (Ast per Filter bzw. Auswahl).
- **Nichts doppelt bauen.** Wo die Mindmap schon etwas kann, wird es wiederverwendet: Eigenschaften-Feld und Notizen als Karteninhalt, **Unterpunkte einer Aufgabe als Checkliste** (nicht ein zweites Checklisten-Konzept erfinden, sofern die Gap-Analyse das trägt), Astfarben, Abhängigkeiten, Meilensteine, Zuständige.
- Version erhöhen (Vorschlag 1.1.0), `CHANGELOG` pflegen.

## 4. Etappen

Arbeite **strikt etappenweise**. Nach jeder Etappe: kurz berichten, was läuft, was fehlt und was nicht getestet werden konnte, dann auf meine Freigabe warten. Pro Etappe mindestens ein Git-Commit, **alle bisherigen Playwright-Tests müssen grün bleiben**.

### Etappe 1: Kern-Erweiterungen der Kanban-Ansicht
- **Kanban-Modus-Schalter** *einfach / Prozess* (Standard: einfach). Die folgenden Punkte gelten für *Prozess*, wenn nicht anders gesagt.
- **Frei konfigurierbare Spalten:** anlegen, umbenennen, Farbe, Reihenfolge per Drag & Drop, löschen (Karten dabei nicht verlieren, Zielspalte abfragen). Die Spalte „Ideen" wird zu einer gewöhnlichen, optionalen Spalte. Standard-Board im Prozess-Modus: Backlog / Geplant / In Arbeit / Review / Erledigt.
- **Spalte und Status bleiben verbunden:** Jede Spalte gehört zu einer **Status-Kategorie** des bestehenden Modells (z. B. Review gehört zu „In Arbeit"). Dadurch funktionieren Zeitplan, Gantt, Exporte, Auto-Planen und Regeln unverändert. Details siehe Abschnitt 5.
- **Karteninhalt und Karteneditor:** Beim Klick auf eine Karte öffnet sich ein Dialog nach CryptPad-Vorbild (Titel, Inhalt mit Markdown, Tags, Farbe, Löschen) **auf Basis der vorhandenen Eigenschaften und Notizen**. Dazu Zuständige (Mehrfachauswahl), Aufwand (S/M/L), Fälligkeit, Priorität, Fortschritt der Unterpunkte auf der Karte. Falls Notizen noch kein Markdown können: lokale Bibliothek **plus Sanitizer**, keine externen Bilder.
- **Tags** mit Filter (Mehrfachauswahl, neue Karten übernehmen aktive Tags), zusätzlich zu den vorhandenen Filtern nach Ast und Person. Prüfen, ob es Tags im Modell schon gibt.
- **Kompakte/volle Kartenansicht** umschaltbar.
- **Blocker:** Eine Karte ist automatisch „blockiert", wenn eine Vorgänger-Abhängigkeit nicht erledigt ist (vorhandenes Abhängigkeitsmodell). Zusätzlich manuelles Blocker-Flag mit Begründung. Sichtbar mit Icon und Text, nicht nur Farbe.
- **WIP-Limit je Spalte:** Anzeige „3/3" im Kopf. Bei Überschreitung Spalte markiert (Icon, Text, Farbe) plus kurzer, nicht blockierender Hinweis mit Reflexionsfrage („Was hindert euch, etwas abzuschließen, bevor ihr Neues beginnt?"). Umsetzung als **Regeln im bestehenden Regelkatalog** (neues Präfix K: K01 = WIP überschritten, K02 = Karte überfällig, K03 = Karte lange blockiert), mild und wegklickbar wie die M-/P-Regeln.
- **Protokoll (Audit-Log):** Jede **aufgabenbezogene** Änderung erzeugt über eine zentrale Stelle einen Eintrag (siehe Abschnitt 5). Reine Mindmap-Bearbeitung (Textänderungen an Ideen, Layout) wird **nicht** protokolliert (Datensparsamkeit). Ansicht mit Filter nach Person, Karte, Zeitraum.
- **Mitglieder:** Die bestehenden Zuständigen-Namen werden zur Mitgliederliste (optional mit Farbe). Wer handelt, kommt aus der bestehenden Teilnehmer-Identität der Zusammenarbeit; ohne Sitzung gibt es eine Auswahl „Ich bin …".
- Rückgängig/Wiederholen für alle neuen Aktionen über den bestehenden Mechanismus.
- Tests: Logik (Aktionen, Protokoll, WIP-Regel, Spalte↔Status, Migration) und Playwright-Tests für Bedienung per Maus, Tastatur und Touch (iPad).

**Abnahme:** Im Modus *einfach* ist das Verhalten identisch zu 1.0.0 (alte Dateien und alle alten Tests ok). Im Modus *Prozess* ist ein Board mit 5 Spalten und 10 Karten auf dem iPad komplett per Touch bedienbar; ein Wechsel der Spalte ändert den Status so, dass Zeitplan und Gantt stimmen. Speichern und erneutes Öffnen liefert identische Daten. Jede aufgabenbezogene Änderung steht mit Person und Zeit im Protokoll. Zwei Browser in einer gemeinsamen Sitzung sehen dieselben Änderungen **und dasselbe Protokoll**. Die Datenschutz-Punkte 1 bis 6 aus Abschnitt 6a sind umgesetzt und der Test „keine Anfragen an Dritte" ist grün.

### Etappe 2: Prozess sichtbar machen
- **Definition of Done** pro Spalte (Checkliste in den Spalteneinstellungen). Beim Verschieben in die Spalte erscheint ein Bestätigungsdialog mit den Kriterien; die Bestätigung wird protokolliert. Abbrechbar, kein hartes Sperren.
- **Kennzahlen-Ansicht** (neue Ansicht oder Bereich der Kanban-Ansicht, je nach Gap-Analyse), berechnet aus dem Protokoll: Durchlaufzeit (Lead Time) und Bearbeitungszeit (Cycle Time) je Karte mit Median und Mittelwert, **Cumulative Flow Diagram**, Durchsatz pro Woche, Blockadedauer. Diagramme als schlankes SVG ohne schwere Bibliothek.
- **Retrospektive-Modus:** geführte Ansicht mit Kennzahlen und 3–4 Leitfragen (Was lief gut? Wo gab es Engpässe? Was ändern wir?). Antworten werden in der Datei gespeichert und mit exportiert.
- **Board-Vorlagen:** mindestens „Einfaches Kanban", „NwT-Projekt 8 Wochen" (vorbefüllt mit Spalten, WIP-Limits, DoD, Meilensteinen) und „Projekt mit Review". Den vorhandenen Vorlagenmechanismus des Mindmap_Editors wiederverwenden; eigene Vorlage aus dem aktuellen Board speichern.
- Tests mit festen Beispiel-Protokollen für alle Kennzahlen.

### Etappe 3: Bewertung und Überblick für die Lehrkraft
- **Bewertungskriterien:** Kriterienliste pro Datei, Karten mit Kriterien verknüpfbar, Übersicht „Welche Kriterien sind durch erledigte Karten belegt?"
- **Gruppenübersicht:** mehrere Mindmap-Dateien (je Gruppe) gleichzeitig laden und vergleichen (Fortschritt, WIP-Verletzungen, Blockaden, Beitragsanteile je Mitglied aus dem Protokoll). Rein lesend und nur lokal im Browser.
- **Exporte:** Bericht als Markdown (Stand, Kennzahlen, Retrospektive, Protokoll-Auszug) und Druckansicht A4. Bestehende Exporte (Aufgabenliste, ICS, JSON, ...) behalten.
- Optional und nur nach Rückfrage: PDF-Export.

## 5. Datenmodell und Protokoll

- **Bestehendes Modell nicht ersetzen, sondern additiv erweitern**, damit Dateien austauschbar bleiben. Neue Felder (Vorschlag, an das reale Modell anpassen):
  - Dokument: `kanban{ mode, columns[], members[], criteria[], retrospectives[], events[] }`
  - Spalten: `id`, `title`, `color`, `statusKey` (Bezug zum bestehenden Status), `wipLimit`, `definitionOfDone[]`
  - Aufgaben-Knoten: `columnId`, `tags[]`, `estimate`, `blocked{flag,reason}`, `criteriaIds[]`
- **Spalte ist die Wahrheit für die Darstellung im Kanban, `statusKey` bleibt die Wahrheit für alle anderen Ansichten.** Beim Verschieben einer Karte werden beide konsistent gesetzt; ändert sich der Status an anderer Stelle (z. B. im Eigenschaften-Feld oder im Gantt), wählt das Kanban die passende Spalte dieser Status-Kategorie (bei mehreren: die zuletzt benutzte). Dokumentiere diese Regel und teste sie.
- Eine **`schemaVersion`** einführen bzw. fortführen und Migration von 1.0.0-Dateien vorsehen (Standard-Spalten aus dem alten Status ableiten). Import prüft gegen das Schema und meldet Fehler verständlich auf Deutsch.
- **Protokoll (`events`)** ist append-only. Ereignistypen mindestens: Aufgabe angelegt/verschoben/geändert/gelöscht, Blocker gesetzt/gelöst, Spalte angelegt/umbenannt/geändert/gelöscht/verschoben, WIP überschritten, DoD bestätigt, Mitglied hinzugefügt. Jeder Eintrag: eindeutige ID, Zeit, Person, Typ, Aufgabe, von, nach.
- **Alle Änderungen laufen über benannte Aktionen** (eine zentrale Stelle), die automatisch Protokoll-Eintrag und Undo-Schritt erzeugen. So bleibt das Protokoll lückenlos, ohne dass die Oberfläche daran denken muss. Prüfe, wie sich das zu den bestehenden Änderungswegen der Mindmap verhält (Eigenschaften-Feld, Gantt, Gliederung): auch dort geänderte Aufgabenfelder müssen protokolliert werden.
- **Zusammenarbeit:** Prüfe, wie `collab` synchronisiert. Das Protokoll darf bei gleichzeitigem Arbeiten **keine Einträge verlieren oder doppeln**. Falls ganze Zustände überschrieben werden, schlage eine Lösung vor (z. B. Einträge mit eindeutiger ID zusammenführen). Das ist die wichtigste technische Entscheidung dieser Erweiterung.
- Hinweis in der App und in der README: Das Protokoll ist ein **Arbeitsnachweis, kein Beweis**, da es ohne Anmeldung nicht fälschungssicher ist.

## 6. Technische und didaktische Vorgaben

- Bleibt bei der Technik des Mindmap_Editors: **reines HTML/CSS/JavaScript, kein Build-Schritt, keine CDN-Abhängigkeiten**, Bibliotheken lokal einbinden.
- Alle Oberflächentexte und Kommentare auf **Deutsch**. Mein JavaScript ist rudimentär: einfacher, gut kommentierter Code, kurze Funktionen, Kommentare zum „Warum".
- **Touch zuerst** (iPad): Pointer Events, Trefferflächen mindestens 44 px, Alternative zum Ziehen per Menü „Verschieben nach …", volle Tastaturbedienung.
- **Barrierearm:** Farbe nie als einzige Information, ausreichende Kontraste, sinnvolle ARIA-Beschriftungen für Spalten und Karten.
- Look & Feel: bestehendes Design (hell/dunkel/schwarz-weiß, dezente Farben) beibehalten, keine neue Optik einführen.
- Das **Embedding-Protokoll** und alle bestehenden Exporte bleiben rückwärtskompatibel.
- Datenschutz: siehe Abschnitt 6a (verbindlich, nicht optional).

## 6a. Datenschutz (Privacy by Design, verbindlich)

**Einordnung:** Die App wird mit Schülerinnen und Schülern (Minderjährige) eingesetzt. Das Protokoll hält fest, wer wann was getan hat, und kann zur Leistungsbewertung dienen. Das sind personenbezogene Daten mit Bewertungsbezug und damit der sensibelste Teil der Erweiterung. Plane und baue deshalb nach den Grundsätzen Datensparsamkeit, Zweckbindung, Transparenz und Löschbarkeit. **Behaupte in Code, UI und Dokumenten nirgends „DSGVO-konform"**; die Formulierung lautet „datenschutzfreundlich konzipiert". Ob der Einsatz zulässig ist, entscheidet die Schule (Schulleitung, Datenschutzbeauftragte), nicht die App.

**Technische Anforderungen**
1. **Datensparsamkeit bei Personen:** Mitglieder brauchen nur ein Kürzel oder Pseudonym. Keine Pflicht zu Klarnamen, kein E-Mail-Feld. Beim Anlegen von Zuständigen/Mitgliedern ein Hinweis: „Kürzel oder Spitzname genügt."
2. **Speicherort:** Standard ist **lokal** (Datei plus `localStorage`). Serverseitig liegt nur etwas, wenn eine gemeinsame Sitzung läuft. Prüfe in Schritt 0 genau, **was `collab` auf dem Server ablegt** (Inhalt, Dateien, Dauer), und dokumentiere es. Bedenke: Auch Mindmap-Inhalte und das Protokoll werden in Sitzungen übertragen.
3. **Automatische Löschung von Sitzungsdaten** auf dem Server nach Inaktivität (Vorschlag 24 Stunden, konfigurierbar), plus Schaltfläche „Sitzung beenden und Serverdaten löschen". Keine Datenbank, keine dauerhafte Ablage. Falls das schon so umgesetzt ist: nur dokumentieren und testen.
4. **Keine Verbindung zu Dritten:** keine CDN, keine externen Schriftarten, keine Analyse- oder Tracking-Werkzeuge, keine externen Bilder (verhindert auch das Abfließen von IP-Adressen). Sanitizer für Markdown. Als **Playwright-Test**: Während einer Beispielsitzung dürfen nur Anfragen an die eigene Herkunft (Origin) stattfinden.
5. **Keine Cookies** außer technisch Notwendigem; `localStorage` nur für Dokument und Einstellungen. Hinweis darauf in der README.
6. **Sicherheit der Sitzungen:** lange, unvorhersehbare Sitzungskennungen, Betrieb nur über HTTPS (in `DEPLOY.md` als Voraussetzung), Header setzen (Content-Security-Policy, Referrer-Policy `no-referrer`, X-Content-Type-Options). Nur-Ansehen-Links mit Warnung „nicht öffentlich weitergeben". Vorhandenes prüfen und nur ergänzen, was fehlt.
7. **Webserver-Protokolle:** In `DEPLOY.md` beschreiben, wie Zugriffsprotokolle mit IP-Adressen gekürzt oder kurz aufbewahrt werden (Apache und nginx), da sie personenbezogen sind.
8. **Transparenz in der App:** Beim ersten Öffnen im Prozess-Modus ein kurzer Hinweis, dass ein Protokoll geführt wird, wer es sieht und wofür es dient (Zweck wird von der Lehrkraft in der Datei eingetragen, z. B. „Unterstützung der Reflexion und der Bewertung der Gruppenarbeit"). Der Hinweis gehört zur Datei und wird mit exportiert.
9. **Schalter „Protokoll personenbezogen führen":** Bei „nein" werden Aktionen ohne Person gespeichert (nur Zeit und Art). So ist auch eine Variante ohne Einzelbewertung möglich.
10. **Löschen und Anonymisieren:** Funktion „Projekt abschließen" mit Auswahl: Protokoll behalten / **anonymisieren** (Personen werden zu „Person 1, 2 …", auch in den Zuständigen) / **löschen**. Außerdem „Alle lokalen Daten dieser App löschen" (localStorage zurücksetzen). Die Gruppenübersicht arbeitet nur lokal im Browser, es wird nichts hochgeladen.
11. **Auskunft und Mitnahme:** Der JSON-Export enthält alle Daten zu einer Person (Aufgaben, Protokolleinträge). Ergänze einen Filter „Alles zu Person X exportieren".

**Dokumentation (Ergebnis dieser Etappe)**
Lege `DATENSCHUTZ.md` als **Entwurf** an (oder erweitere eine vorhandene), in einfacher Sprache, mit: Zweck der Verarbeitung, Kategorien personenbezogener Daten (Kürzel, Aufgaben, Protokoll, ggf. Bewertungsbezug), Betroffene (Schüler, Lehrkräfte), Datenfluss (lokal / Sitzung auf dem Server), Speicherorte und Löschfristen, technische und organisatorische Maßnahmen (aus den Punkten oben), offene Punkte für die Schule (Rechtsgrundlage und Freigabe durch Schulleitung und Datenschutzbeauftragte, ggf. Information bzw. Einwilligung bei Minderjährigen, **Auftragsverarbeitung, falls ein Dritter hostet**, Verzeichnis der Verarbeitungstätigkeiten), sowie einen **Mustertext für die Information von Schülern und Eltern** (als Entwurf). Kennzeichne das Dokument deutlich als „Entwurf, keine Rechtsberatung, vor Einsatz mit der Datenschutzbeauftragten abstimmen". Verweise darauf aus der README.

## 7. Bewusst nicht umsetzen

Sprints und Story Points, Epics, Git-/Jira-Integrationen, Benachrichtigungen, Accounts, Cloud-Anbindung, Verschlüsselung, Chat, eine zweite App oder ein zweites Repo. Wenn du eine dieser Funktionen für unverzichtbar hältst, frag nach, bevor du sie baust. Eine Anbindung an meine PHP-Webapp „Projektmanagement" nur planen und vorschlagen, nicht ungefragt bauen.

## 8. Arbeitsweise

1. Erst Schritt 0 (Bestandsaufnahme), dann Freigabe abwarten.
2. Arbeite auf dem Branch `feature/kanban-prozess`. Bestehende `CLAUDE.md` und `README.md` **erweitern**, nicht ersetzen: Projektüberblick, Konventionen, Befehle (Tests, lokaler Start, Desktop-Start), Etappenliste, neues Kapitel „Kanban-Prozess-Modus".
3. `README.md` für Lehrkräfte und Schüler um Kurzanleitung, Datenschutz und Aussagekraft des Protokolls ergänzen, `DATENSCHUTZ.md` (Entwurf, siehe Abschnitt 6a) anlegen und `DEPLOY.md` um HTTPS, Header und Log-Kürzung ergänzen. Regelkatalog (K01–K03) in die bestehende Regel-Dokumentation aufnehmen.
4. Ehrlich berichten, was **nicht getestet** werden konnte (z. B. das Desktop-Fenster ohne Bildschirmumgebung), damit ich es lokal prüfen kann.
5. Bei Unklarheiten oder zwei gleichwertigen Wegen kurz nachfragen, statt zu raten.
