# Web-Version auf den Server bringen

Die Web-Version läuft in zwei Betriebsarten. Der Editor selbst funktioniert immer;
Unterschiede gibt es nur beim gemeinsamen Bearbeiten und beim Menüpunkt
„Desktop-Version“.

## A) Webspace mit PHP (z. B. Bitpalast/Plesk) – empfohlen

Hochzuladen ist der **komplette Inhalt von `web/static/`**:

```
index.html
mindmap.css
favicon.svg, favicon-32.png, apple-touch-icon.png
js/          (alle Dateien)
vendor/      (qrcode.js)
api/collab.php
api/data/.htaccess      <- versteckte Datei!
.htaccess               <- versteckte Datei! im FTP-Programm sichtbar schalten
downloads/   (optional, nur als Rückfallebene)
```

- Das **gemeinsame Bearbeiten** läuft über `api/collab.php` (PHP ≥ 7.4, keine
  Datenbank). Die Sitzungen landen in `api/data/` – der Ordner muss für PHP
  **beschreibbar** sein und ist per `.htaccess` gesperrt.
- **Besser** liegt die Ablage außerhalb des Web-Verzeichnisses. Dazu neben
  `collab.php` eine Datei `api/config.php` anlegen:

  ```php
  <?php define('MINDMAP_DATA_DIR', '/var/www/vhosts/mint-checker.de/private/mindmap');
  ```
- Läuft der Webspace nur über **nginx** (kein Apache), wirken die `.htaccess`-Dateien
  nicht. Dann in Plesk unter „Apache & nginx Einstellungen“ bei den nginx-Direktiven
  eintragen:

  ```
  location = /index.html  { add_header Cache-Control "no-cache, must-revalidate"; }
  location = /            { add_header Cache-Control "no-cache, must-revalidate"; }
  location ^~ /api/data/  { deny all; }
  ```
- Test: Seite öffnen → „Gemeinsam“ → „Sitzung starten“. Erscheinen Link und QR-Code,
  funktioniert alles. Fehlermeldung „Ablageordner fehlt / nicht beschreibbar“ →
  Schreibrechte von `api/data/` prüfen.

Der Download-Dialog der Desktop-Version fragt die GitHub-API direkt aus dem Browser
ab (`GITHUB_REPO` oben in `js/mm-io.js`). **Das klappt nur bei einem öffentlichen
Repository** – sonst fällt er auf die Dateien in `downloads/` zurück.

## B) Mit Flask-Backend (`python3 web/app.py`)

Liefert die Seite aus und bietet unter `/api/collab.php` **dasselbe Protokoll** für
das gemeinsame Bearbeiten (Ablage: `web/collab-data/` bzw. `MINDMAP_DATA_DIR`).
Zusätzlich `/api/downloads` für die Desktop-Pakete – das funktioniert auch bei einem
**privaten** Repository, weil das Token auf dem Server bleibt:

```bash
export MINDMAP_GITHUB_TOKEN=github_pat_...
bash web/start_web.sh 5000
```

Im lokalen Netz (z. B. vom iPad) ist der Editor dann über
`http://<IP-des-Rechners>:5000` erreichbar.

## Nach jedem Update unbedingt beachten

1. In `index.html` den Cache-Buster hochzählen (`?v=N` bei `mindmap.css` **und**
   allen Skripten).
2. **Alle Dateien zusammen** hochladen. Eine alte `index.html` mit neuen Skripten ist
   die häufigste Fehlerquelle; die Seite blendet dann oben einen gelben Hinweis
   „bitte mit Strg+F5 neu laden“ ein.
3. Einmal hart neu laden (Strg+F5 / ⌘+Shift+R).

## Datenschutz (Kurzfassung für die Schule)

- Ohne gemeinsames Bearbeiten bleibt alles im Browser bzw. auf dem Rechner
  (Zwischenspeicher im Browser, Dateien über „Speichern“).
- Beim gemeinsamen Bearbeiten speichert der eigene Server den Inhalt der Mindmap und
  die selbst gewählten Anzeigenamen. Es gibt keine Konten, keine Cookies, keine
  externen Dienste (Schriften, Skripte und QR-Codes kommen vom eigenen Server; nur der Klick auf „Desktop-Version“ fragt bei GitHub nach dem neuesten Paket).
  Sitzungen ohne Nutzung werden nach 60 Tagen gelöscht (`ROOM_TTL_DAYS`).
- Empfehlung an die Klasse: als Namen nur Vornamen oder Kürzel verwenden.
