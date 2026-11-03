# Browsertests

Die App selbst braucht kein npm und keinen Build-Schritt. Node und Python werden
**nur für die Tests** gebraucht.

## Einmalig einrichten

```bash
npm install                                   # Playwright
npx playwright install chromium               # Testbrowser
python3 -m venv .venv-test && .venv-test/bin/pip install flask   # Flask-Backend für die Tests
```

PHP (≥ 7.4) muss installiert sein (`php -v`), damit `api/collab.php` getestet werden kann.

## Ausführen

```bash
npm test                     # alle Tests
npx playwright test tests/baseline.spec.js     # nur eine Datei
npm run test:headed          # mit sichtbarem Browser
```

Playwright startet dafür selbst drei Server (siehe `playwright.config.js`):
statisch (Port 4310), PHP (4311) und Flask (4312). Sitzungsdaten der Tests landen in
`.test-data/`, nie im Web-Verzeichnis.

## Dateien

| Datei | Inhalt |
|---|---|
| `baseline.spec.js` | Verhalten von Version 1.0.0 (Mindmap, Kanban *einfach*, Exporte, Zeitplan, Regeln) – darf sich nicht ändern |
| `ipad.spec.js` | Bedienung per Touch (iPad-Maße) |
| `collab.spec.js` | Gemeinsames Bearbeiten gegen PHP und Flask |
| `helpers.js` | Beispieldaten, Ziehen mit Maus/Finger |
