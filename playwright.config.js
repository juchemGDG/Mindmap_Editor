// Browsertests für den Mindmap Editor (siehe tests/README.md)
//
// Es laufen drei Server parallel:
//   4310  statisch (tests/static-server.js) – wie die Desktop-Version, ohne gemeinsames Bearbeiten
//   4311  PHP-Webserver mit api/collab.php  – wie auf dem Webspace (Bitpalast)
//   4312  Flask-Backend (web/app.py)        – dasselbe Protokoll in Python
const fs = require('fs');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const ROOT = __dirname;
// Flask liegt im Test-venv (.venv-test); sonst das System-Python
const PY = process.env.MM_PYTHON || (fs.existsSync(path.join(ROOT, '.venv-test/bin/python')) ? path.join(ROOT, '.venv-test/bin/python') : 'python3');
// Sitzungsdaten der Tests landen in einem eigenen Ordner, nie im Web-Verzeichnis
const DATA = path.join(ROOT, '.test-data');
fs.mkdirSync(path.join(DATA, 'php'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'flask'), { recursive: true });

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4310',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } }, testIgnore: /ipad\.spec/ },
    // iPad: Touch, kleineres Fenster (Chromium mit iPad-Maßen, WebKit ist hier nicht installiert)
    { name: 'ipad', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: false }, testMatch: /ipad\.spec/ },
  ],
  webServer: [
    { command: 'node tests/static-server.js 4310', url: 'http://127.0.0.1:4310/index.html', reuseExistingServer: !process.env.CI },
    // PHP_CLI_SERVER_WORKERS: der eingebaute PHP-Server arbeitet sonst nur eine Anfrage nach der anderen ab
    { command: 'php -S 127.0.0.1:4311 -t web/static', url: 'http://127.0.0.1:4311/index.html', reuseExistingServer: !process.env.CI,
      env: { MINDMAP_DATA_DIR: path.join(DATA, 'php'), PHP_CLI_SERVER_WORKERS: '4' } },
    { command: `${PY} web/app.py 4312`, url: 'http://127.0.0.1:4312/', reuseExistingServer: !process.env.CI,
      env: { MINDMAP_DATA_DIR: path.join(DATA, 'flask') } },
  ],
});
