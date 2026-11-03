// Dialog „Desktop-Version“: nie auf Dateien zeigen, die es nicht gibt.
// Die GitHub-API wird hier nachgebildet (kein echter Netzzugriff im Test).
const { test, expect } = require('@playwright/test');
const { openApp } = require('./helpers');

const API = 'https://api.github.com/repos/juchemGDG/Mindmap_Editor/releases/latest';

test('Ohne Release und ohne lokale Dateien: keine Links, sondern ein Hinweis', async ({ page }) => {
  await page.route(API, r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }));
  await openApp(page);
  await page.evaluate(() => showDownloads());
  await expect(page.locator('#download-version')).toContainText('noch nicht veröffentlicht');
  const items = page.locator('#download-list .download-item');
  await expect(items).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(items.nth(i)).not.toHaveAttribute('href', /.*/);
    await expect(items.nth(i)).toHaveAttribute('aria-disabled', 'true');
    await expect(items.nth(i)).toContainText('noch nicht verfügbar');
  }
  await expect(page.locator('#download-version a')).toHaveAttribute('href', 'https://github.com/juchemGDG/Mindmap_Editor/releases');
});

test('Mit Release: Links zeigen direkt auf die Dateien am GitHub-Release', async ({ page }) => {
  const asset = name => ({ name, size: 42 * 1024 * 1024, browser_download_url: 'https://github.com/juchemGDG/Mindmap_Editor/releases/download/v1.0.0/' + name });
  await page.route(API, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    tag_name: 'v1.0.0', published_at: '2026-11-03T12:00:00Z',
    assets: [asset('Mindmap-Editor.dmg'), asset('Mindmap-Editor-Setup.exe')],   // Linux fehlt
  }) }));
  await openApp(page);
  await page.evaluate(() => showDownloads());
  await expect(page.locator('#download-version')).toContainText('Aktuelle Version: v1.0.0 (2026-11-03)');
  const items = page.locator('#download-list .download-item');
  await expect(items.nth(0)).toHaveAttribute('href', /releases\/download\/v1\.0\.0\/Mindmap-Editor\.dmg$/);
  await expect(items.nth(0)).toContainText('42 MB');
  await expect(items.nth(1)).toHaveAttribute('href', /Mindmap-Editor-Setup\.exe$/);
  // fehlende Datei: kein Link auf downloads/…, das es auf dem Server nicht gibt
  await expect(items.nth(2)).not.toHaveAttribute('href', /.*/);
  await expect(items.nth(2)).toContainText('noch nicht verfügbar');
});
