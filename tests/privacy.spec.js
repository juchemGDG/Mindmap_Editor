// Datenschutz (Abschnitt 6a, Punkte 1–6 und 8–11)
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { STATIC, PHP, FLASK, sampleDoc, openApp, openProcess, getDoc } = require('./helpers');

const DATA = path.join(__dirname, '..', '.test-data');

/** Alle Anfragen einer Seite mitschreiben. */
function recordRequests(page, list) {
  page.on('request', r => list.push(r.url()));
}

for (const [name, base, dir] of [['PHP', PHP, 'php'], ['Flask', FLASK, 'flask']]) {
  test(`Keine Anfragen an Dritte während einer Beispielsitzung (${name})`, async ({ browser }) => {
    const urls = [];
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const a = await ctxA.newPage(), b = await ctxB.newPage();
    recordRequests(a, urls); recordRequests(b, urls);
    await openApp(a, base, { doc: sampleDoc() });
    await a.evaluate(() => localStorage.setItem('mm-name', 'AB'));
    await openProcess(a);
    await a.evaluate(() => startCollab());
    await a.waitForFunction(() => collab && collab.room);
    await b.addInitScript(() => localStorage.setItem('mm-name', 'CD'));
    await b.goto(await a.evaluate(() => roomUrl(true)));
    await b.waitForFunction(() => collab && collab.joined);
    await a.evaluate(() => hideShare());
    // typische Arbeit: Karten verschieben, Karte mit Markdown (inkl. fremdem Bild) öffnen, Protokoll ansehen
    await a.evaluate(() => mutate('Inhalt', () => { doc.nodes.t1.note = '![x](https://fremd.example/bild.png) [Quelle](https://fremd.example/)'; }));
    await a.evaluate(() => moveCard('t1', boardColumns()[2].id));
    await a.click('[data-pcard="t1"] .ktext');
    await a.click('#card-box [data-cd="preview"]');
    await a.click('#card-box [data-cd="close"]');
    await a.click('[data-ka="log"]');
    await a.click('#kanban-box [data-kd="close"]');
    await a.click('[data-view-tab="map"]');
    await a.click('[data-view-tab="timeline"]');
    await expect.poll(() => b.evaluate(() => doc.nodes.t1.status), { timeout: 8000 }).toBe('doing');
    await a.click('#btn-share');           // Teilen-Dialog mit QR-Code (wird lokal erzeugt)
    const origin = new URL(base).origin;
    const foreign = urls.filter(u => !u.startsWith(origin + '/') && !u.startsWith('data:') && !u.startsWith('blob:'));
    expect(foreign).toEqual([]);
    expect(urls.length).toBeGreaterThan(5);
    // Keine Cookies
    expect(await ctxA.cookies()).toEqual([]);
    expect(await ctxB.cookies()).toEqual([]);
    await ctxA.close(); await ctxB.close();
  });

  test(`Sitzung beenden löscht die Serverdaten sofort (${name})`, async ({ browser }) => {
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const a = await ctxA.newPage(), b = await ctxB.newPage();
    await openApp(a, base, { doc: sampleDoc() });
    await a.evaluate(() => localStorage.setItem('mm-name', 'AB'));
    await a.evaluate(() => startCollab());
    await a.waitForFunction(() => collab && collab.room);
    const room = await a.evaluate(() => collab.room);
    expect(room.length).toBeGreaterThanOrEqual(20);           // lange, unvorhersehbare Kennung
    expect(await a.evaluate(() => roomUrl(false))).not.toContain('k=');
    await b.goto(await a.evaluate(() => roomUrl(true)));
    await b.waitForFunction(() => collab && collab.joined);
    const file = path.join(DATA, dir, room + '.json');
    expect(fs.existsSync(file)).toBe(true);
    a.on('dialog', d => d.accept());
    await expect(a.locator('#share-active .share-warn')).toContainText('Nicht öffentlich weitergeben');
    await a.click('#share-end');
    await expect.poll(() => fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(DATA, dir, room + '.peers.json'))).toBe(false);
    await expect.poll(() => a.evaluate(() => collab)).toBeNull();
    // B merkt es beim nächsten Abgleich und behält die Kopie
    await expect(b.locator('#modal')).toBeVisible({ timeout: 8000 });
    await expect(b.locator('#modal-body')).toContainText('vom Server gelöscht');
    expect((await getDoc(b)).nodes.t1.text).toBe('Gehäuse sägen');
    await expect.poll(() => b.evaluate(() => { const s = localStorage.getItem('mm-autosave'); return s && JSON.parse(s).doc.nodes.t1 && JSON.parse(s).doc.nodes.t1.text; })).toBe('Gehäuse sägen');
    // ohne Schlüssel darf niemand löschen
    const r = await a.evaluate(async () => (await fetch('api/collab.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', doc: { nodes: { root: { id: 'root' } } } }) })).json());
    const r2 = await a.evaluate(async room => (await fetch('api/collab.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close', room, key: 'falsch' }) })).json(), r.room);
    expect(r2.error).toBe('readonly');
    await ctxA.close(); await ctxB.close();
  });

  test(`Lokale Kopie einer Sitzung: eigene Arbeit bleibt unberührt, alter Link bietet die Kopie an (${name})`, async ({ browser }) => {
    const ctxA = await browser.newContext(), ctxB = await browser.newContext();
    const a = await ctxA.newPage(), b = await ctxB.newPage();
    await openApp(a, base, { doc: sampleDoc() });
    await a.evaluate(() => localStorage.setItem('mm-name', 'AB'));
    await a.evaluate(() => startCollab());
    await a.waitForFunction(() => collab && collab.room);
    const url = await a.evaluate(() => roomUrl(true));
    // B hat eigene, ungespeicherte Arbeit im Browser
    await openApp(b, base);
    await b.evaluate(() => { mutate('x', () => { doc.nodes[index().rid].text = 'Meine eigene Arbeit'; }); });
    await expect.poll(() => b.evaluate(() => (localStorage.getItem('mm-autosave') || '').includes('Meine eigene Arbeit'))).toBe(true);
    await b.goto(url);
    await b.waitForFunction(() => collab && collab.joined);
    await b.evaluate(() => mutate('x', () => { doc.nodes.t1.text = 'In der Sitzung geändert'; }));
    await expect.poll(() => b.evaluate(() => (localStorage.getItem('mm-session-copy') || '').includes('In der Sitzung geändert'))).toBe(true);
    expect(await b.evaluate(() => localStorage.getItem('mm-autosave'))).toContain('Meine eigene Arbeit');
    // Sitzung verschwindet auf dem Server (wie nach 24 Stunden)
    const room = await a.evaluate(() => collab.room);
    await a.evaluate(async () => { await collabPost({ action: 'close', room: collab.room, key: collab.key }); leaveRoomSilently(); });
    await b.close();
    const b2 = await ctxB.newPage();
    b2.on('dialog', d => d.accept());
    await b2.goto(url);
    await expect.poll(() => b2.evaluate(() => doc.nodes.t1 && doc.nodes.t1.text)).toBe('In der Sitzung geändert');
    expect(room).toBeTruthy();
    await ctxA.close(); await ctxB.close();
  });

  test(`Sitzungen ohne Nutzung werden automatisch gelöscht (${name})`, async ({ page }) => {
    await openApp(page, base);
    const create = () => page.evaluate(async () => (await fetch('api/collab.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', doc: { nodes: { root: { id: 'root' } } } }) })).json());
    const old = await create();
    const file = path.join(DATA, dir, old.room + '.json');
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000);
    fs.utimesSync(file, twoDaysAgo, twoDaysAgo);
    await create();                         // beim Anlegen wird aufgeräumt
    expect(fs.existsSync(file)).toBe(false);
  });

  test(`Sicherheits-Header der Schnittstelle (${name})`, async ({ request }) => {
    const r = await request.post(base + '/api/collab.php', { data: { action: 'sync', room: 'gibtesnicht12', since: 0 } });
    expect(r.headers()['referrer-policy']).toBe('no-referrer');
    expect(r.headers()['x-content-type-options']).toBe('nosniff');
    expect(await r.json()).toEqual({ error: 'notfound' });
  });
}

test('Flask liefert die Seite mit CSP und Referrer-Policy aus', async ({ request }) => {
  const r = await request.get(FLASK + '/');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("default-src 'self'");
  expect(h['referrer-policy']).toBe('no-referrer');
  expect(h['x-content-type-options']).toBe('nosniff');
});

test('index.html enthält CSP und Referrer-Policy auch für reines Hosting ohne Header', async ({ request }) => {
  const html = await (await request.get(STATIC + '/index.html')).text();
  expect(html).toMatch(/http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'/);
  expect(html).toContain('<meta name="referrer" content="no-referrer">');
});

test('localStorage enthält nur Dokument und Einstellungen; „Alle lokalen Daten löschen“ leert es', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await openProcess(page);
  await page.evaluate(() => moveCard('t1', boardColumns()[1].id));
  await page.waitForTimeout(800);   // Zwischenspeicher schreibt verzögert
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.every(k => k.startsWith('mm-'))).toBe(true);
  expect(keys).toContain('mm-autosave');
  page.on('dialog', d => d.accept());
  await page.click('[data-ka="privacy"]');
  await page.click('[data-kd="clear-local"]');
  await page.waitForLoadState('load');
  await page.waitForFunction(() => typeof doc === 'object');
  const after = await page.evaluate(() => Object.keys(localStorage).filter(k => k !== 'mm-view' && k !== 'mm-client-id'));
  expect(after.filter(k => k === 'mm-autosave' || k === 'mm-name' || k === 'mm-kanban-notice')).toEqual([]);
});

test('Beim Anlegen von Personen: Hinweis „Kürzel oder Spitzname genügt“, kein E-Mail-Feld', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await openProcess(page);
  await page.click('[data-ka="members"]');
  await expect(page.locator('#kanban-box')).toContainText('Kürzel oder Spitzname genügt');
  expect(await page.locator('#kanban-box input[type=email]').count()).toBe(0);
  await page.fill('[data-km="name"]', 'Max, Muster');
  await page.click('[data-kd="member-add"]');
  expect(await page.evaluate(() => Object.values(doc.members).map(m => m.name))).toContain('Max Muster');   // Komma trennt Zuständige
});
