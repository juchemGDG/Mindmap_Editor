# Web-Version auf den Server bringen

Die Web-Version läuft in zwei Betriebsarten. Der Editor selbst funktioniert immer;
Unterschiede gibt es nur beim gemeinsamen Bearbeiten und beim Menüpunkt
„Desktop-Version“.

> **Voraussetzung: HTTPS.** Die App darf nur über `https://` betrieben werden. In den
> Links zum gemeinsamen Bearbeiten steckt der Bearbeiten-Schlüssel; über `http://`
> könnte ihn jeder im selben Netz mitlesen. Die mitgelieferte `.htaccess` leitet
> `http://` auf `https://` um (außer bei `localhost`).

## A) Webspace mit PHP (z. B. Bitpalast/Plesk) – empfohlen

Hochzuladen ist der **komplette Inhalt von `web/static/`**:

```
index.html
mindmap.css
favicon.svg, favicon-32.png, apple-touch-icon.png
js/          (alle Dateien – seit 1.1.0 auch mm-markdown.js, mm-kanban-model.js, mm-kanban.js,
              mm-metrics.js, mm-kanban-insights.js, mm-report.js, mm-groups.js)
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
  <?php
  define('MINDMAP_DATA_DIR', '/var/www/vhosts/mint-checker.de/private/mindmap');
  define('MINDMAP_ROOM_TTL_HOURS', 24);   // Sitzungen ohne Nutzung danach löschen (Standard 24)
  ```
- Läuft der Webspace nur über **nginx** (kein Apache), wirken die `.htaccess`-Dateien
  nicht. Dann in Plesk unter „Apache & nginx Einstellungen“ bei den nginx-Direktiven
  eintragen (siehe auch „Sicherheits-Header“ unten):

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
Repository** – sonst fällt er auf die Dateien in `downloads/` zurück. Das ist die
einzige Verbindung zu einem fremden Server und passiert nur beim Klick auf
„Desktop-Version“.

## B) Mit Flask-Backend (`python3 web/app.py`)

Liefert die Seite aus und bietet unter `/api/collab.php` **dasselbe Protokoll** für
das gemeinsame Bearbeiten (Ablage: `web/collab-data/` bzw. `MINDMAP_DATA_DIR`).
Zusätzlich `/api/downloads` für die Desktop-Pakete – das funktioniert auch bei einem
**privaten** Repository, weil das Token auf dem Server bleibt:

```bash
export MINDMAP_GITHUB_TOKEN=github_pat_...
export MINDMAP_ROOM_TTL_HOURS=24          # optional, Standard 24
bash web/start_web.sh 5000
```

Flask setzt die Sicherheits-Header selbst. Im lokalen Netz (z. B. vom iPad) ist der
Editor über `http://<IP-des-Rechners>:5000` erreichbar – **das ist nur für Tests im
eigenen Netz gedacht**; für den Unterrichtsbetrieb einen Webserver mit HTTPS davor
setzen (z. B. nginx als Reverse Proxy mit Let's-Encrypt-Zertifikat).

## Sicherheits-Header

Die App braucht diese Header (in `.htaccess` für Apache schon enthalten, Flask setzt
sie selbst, `api/collab.php` setzt eigene für die Schnittstelle):

| Header | Wert | Wozu |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'none'` | keine fremden Skripte, Bilder, Schriften oder Verbindungen |
| `Referrer-Policy` | `no-referrer` | Links verraten nicht, von wo man kommt (die Adresse enthält ggf. den Sitzungsschlüssel) |
| `X-Content-Type-Options` | `nosniff` | Dateien werden nur als das ausgeführt, was sie sind |

Zur Sicherheit steht die CSP und die Referrer-Policy zusätzlich als `<meta>` in
`index.html`. **Einbettung per `?embed=1`:** Die CSP enthält bewusst kein
`frame-ancestors`, damit die Einbettung in die Projektmanagement-App weiter geht. Wer
die Einbettung auf die eigene Domain beschränken möchte, ergänzt
`frame-ancestors 'self' https://<eigene-domain>`.

nginx (Plesk ohne Apache):

```
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://api.github.com; object-src 'none'; base-uri 'self'; form-action 'none'" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Content-Type-Options "nosniff" always;
```

Aktiviert Plesk schon die „SEO-sichere 301-Weiterleitung von HTTP zu HTTPS“, kann der
Umleitungsblock in `.htaccess` bleiben (doppelt schadet nicht) oder gelöscht werden.

## Zugriffsprotokolle des Webservers (IP-Adressen)

Webserver schreiben bei jeder Anfrage die IP-Adresse ins Zugriffsprotokoll. Das sind
personenbezogene Daten. Beim gemeinsamen Bearbeiten fragt jedes Gerät etwa jede
Sekunde beim Server nach – es entstehen also viele Einträge. Empfehlung: **IP-Adressen
kürzen und Protokolle höchstens 7 Tage aufbewahren.**

**Plesk:** Website › „Protokolle“ › „Protokollrotation“: täglich, 7 Dateien behalten,
komprimieren. Viele Anbieter (auch Bitpalast) kürzen IP-Adressen auf Wunsch – beim
Support nachfragen.

**Apache** (eigener Server), im `<VirtualHost>` der App – eine der beiden Varianten:

```apache
# Variante 1: ganz ohne IP-Adresse
LogFormat "%t \"%r\" %>s %b" ohneip
CustomLog ${APACHE_LOG_DIR}/mindmap.log ohneip

# Variante 2: IP gekürzt (letzte Stelle der IPv4-Adresse wird 0)
LogFormat "%a %t \"%r\" %>s %b" mitip
CustomLog "|/usr/bin/sed -u -E 's/^([0-9]+\.[0-9]+\.[0-9]+)\.[0-9]+/\1.0/' >> /var/log/apache2/mindmap.log" mitip
```

Aufbewahrung über `logrotate` (`daily`, `rotate 7`).

**nginx:**

```nginx
map $remote_addr $ip_gekuerzt {
    ~(?P<ip>\d+\.\d+\.\d+)\.\d+   $ip.0;
    ~(?P<ip>[^:]+:[^:]+:[^:]+):   $ip::;
    default                       0.0.0.0;
}
log_format ohneip '$ip_gekuerzt - [$time_local] "$request" $status $body_bytes_sent';
access_log /var/log/nginx/mindmap.log ohneip;
```

Dazu `logrotate` mit `daily` und `rotate 7`. Für die Schnittstelle kann man das
Protokoll auch ganz abschalten: `location = /api/collab.php { access_log off; … }`.

## Nach jedem Update unbedingt beachten

1. In `index.html` den Cache-Buster hochzählen (`?v=N` bei `mindmap.css` **und**
   allen Skripten; seit 1.1.0 `v=2`).
2. **Alle Dateien zusammen** hochladen – auch `api/collab.php`. Eine alte
   `index.html` mit neuen Skripten ist die häufigste Fehlerquelle; die Seite blendet
   dann oben einen gelben Hinweis „bitte mit Strg+F5 neu laden“ ein. Ein alter
   `collab.php` kennt das Kanban-Protokoll nicht und würde es in gemeinsamen
   Sitzungen nicht weitergeben.
3. Einmal hart neu laden (Strg+F5 / ⌘+Shift+R).

## Datenschutz (Kurzfassung für die Schule)

Ausführlich in [`DATENSCHUTZ.md`](../DATENSCHUTZ.md) (Entwurf, mit Muster für die
Information von Schülerinnen, Schülern und Eltern).

- Ohne gemeinsames Bearbeiten bleibt alles im Browser bzw. auf dem Rechner
  (Zwischenspeicher im Browser, Dateien über „Speichern“).
- Beim gemeinsamen Bearbeiten speichert der eigene Server den Inhalt der Mindmap
  (im Kanban-Modus „Prozess“ samt Protokoll) und die selbst gewählten Kürzel. Es gibt
  keine Konten, keine Cookies, keine externen Dienste (Schriften, Skripte und QR-Codes
  kommen vom eigenen Server; nur der Klick auf „Desktop-Version“ fragt bei GitHub
  nach dem neuesten Paket).
- Sitzungen ohne Nutzung werden nach **24 Stunden** gelöscht (`MINDMAP_ROOM_TTL_HOURS`),
  „Sitzung beenden und Serverdaten löschen“ löscht sofort.
- Empfehlung an die Klasse: als Namen nur Kürzel oder Spitznamen verwenden.
