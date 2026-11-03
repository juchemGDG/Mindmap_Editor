// Grundlagentests: halten das Verhalten von Version 1.0.0 fest.
// Diese Tests dürfen durch die Kanban-Erweiterung NICHT verändert werden müssen.
const { test, expect } = require('@playwright/test');
const { sampleDoc, openApp, loadDoc, getDoc, showView, center, mouseDrag } = require('./helpers');

test('App lädt ohne Skriptfehler', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#main-canvas')).toBeVisible();
  expect(page.errors).toEqual([]);
});

test('Tastatur: Tab legt Unterpunkt an, Tippen setzt Text, Rückgängig nimmt zurück', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => { selectOne(index().rid); canvas.focus(); });
  await page.keyboard.press('Tab');
  await page.keyboard.type('Erste Idee');
  await page.keyboard.press('Escape');
  let d = await getDoc(page);
  expect(Object.values(d.nodes).map(n => n.text)).toContain('Erste Idee');
  await page.keyboard.press('Control+z');
  d = await getDoc(page);
  expect(Object.values(d.nodes).map(n => n.text)).not.toContain('Erste Idee');
});

test('Kanban (einfach): Spalten Ideen / Offen / In Arbeit / Erledigt', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  const heads = await page.locator('.kcol header b').allTextContents();
  expect(heads).toEqual(['Ideen', 'Offen', 'In Arbeit', 'Erledigt']);
  await expect(page.locator('.kcol[data-col="todo"] .kcard')).toHaveCount(1);
  await expect(page.locator('.kcol[data-col="doing"] .kcard')).toHaveCount(1);
  await expect(page.locator('.kcol[data-col="done"] .kcard')).toHaveCount(1);
  await expect(page.locator('.kcol[data-col="idea"] .kcard')).toHaveCount(1);
  // Pfad (Ast) steht auf der Karte
  await expect(page.locator('[data-card="t1"] .kpath')).toHaveText('Bau');
});

test('Kanban (einfach): Karte mit der Maus ziehen ändert den Status', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  await mouseDrag(page, await center(page.locator('[data-card="t1"]')), await center(page.locator('.kcol[data-col="done"] header')));
  expect((await getDoc(page)).nodes.t1.status).toBe('done');
  // in „Ideen“ ziehen: keine Aufgabe mehr
  await mouseDrag(page, await center(page.locator('[data-card="t2"]')), await center(page.locator('.kcol[data-col="idea"] header')));
  const t2 = (await getDoc(page)).nodes.t2;
  expect(t2.task).toBeUndefined();
  expect(t2.status).toBeUndefined();
  // Rückgängig stellt den Status wieder her
  await page.click('#btn-undo');
  expect((await getDoc(page)).nodes.t2.status).toBe('doing');
});

test('Kanban (einfach): Filter nach Person und Ast', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  await page.selectOption('[data-kf="owner"]', 'AB');
  await expect(page.locator('.kcard')).toHaveCount(2);
  await page.selectOption('[data-kf="owner"]', '');
  await page.selectOption('[data-kf="branch"]', 'b2');
  await expect(page.locator('.kcard')).toHaveCount(2);   // t3 + Idee i1
});

test('Kanban (einfach): Hinzufügen-Knopf legt eine Aufgabe im Ast an', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  await page.selectOption('[data-kf="branch"]', 'b1');
  await page.click('[data-kadd="doing"]');
  await page.fill('#prompt-input', 'Neue Karte');
  await page.click('#prompt-ok');
  const d = await getDoc(page);
  const nn = Object.values(d.nodes).find(n => n.text === 'Neue Karte');
  expect(nn).toMatchObject({ parent: 'b1', task: true, status: 'doing' });
});

test('Speichern und erneutes Öffnen liefern identische Daten', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  const saved = await page.evaluate(() => JSON.stringify(docPayload()));
  const before = await getDoc(page);
  await loadDoc(page, JSON.parse(saved));
  expect(await getDoc(page)).toEqual(before);
});

test('Datei aus 1.0.0 öffnet unverändert (unbekannte Knotenfelder bleiben)', async ({ page }) => {
  const d = sampleDoc();
  d.doc.nodes.t1.zukunft = { a: 1 };
  await openApp(page, null, { doc: d });
  const got = await getDoc(page);
  expect(got.nodes.t1.zukunft).toEqual({ a: 1 });
  expect(got.nodes.t2).toEqual(d.doc.nodes.t2);
});

test('Exporte: Aufgabenliste, CSV und ICS', async ({ page }) => {
  const d = sampleDoc();
  d.doc.nodes.t2.start = '2026-01-05'; d.doc.nodes.t2.due = '2026-01-07';
  await openApp(page, null, { doc: d });
  const out = await page.evaluate(() => ({ md: toTaskMarkdown(), csv: toCsv(), ics: toIcs() }));
  expect(out.md).toContain('- [ ] Gehäuse sägen (@AB, bis 10.01.2026)');
  expect(out.md).toContain('- [ ] Platine löten – in Arbeit');
  expect(out.md).toContain('- [x] Bericht schreiben (@AB)');
  expect(out.csv.split('\r\n')[0]).toBe('﻿Aufgabe;Hauptast;Pfad;Status;Zuständig;Start;Fällig;Priorität;Punkte;Abhängig von;Notiz');
  expect(out.csv).toContain('Platine löten;Bau;Bau;In Arbeit;CD;05.01.2026;07.01.2026;hoch');
  expect(out.ics.count).toBe(2);
});

test('Zeitplan: einfache Liste und Gantt zeigen den Status', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'timeline');
  await expect(page.locator('.tl-group.done .tl-row')).toHaveCount(1);
  await page.click('[data-planmode] button[data-val="project"]');
  await expect(page.locator('.g-svg')).toBeVisible();
  await expect(page.locator('.g-label .sbox.doing')).toHaveCount(1);
});

test('Prüfregeln P01/P03 melden sich in der Phase „Planen“', async ({ page }) => {
  const d = sampleDoc();
  delete d.doc.nodes.t2.owner;
  await openApp(page, null, { doc: d });
  const rules = await page.evaluate(() => evaluateMap().map(f => f.rule));
  expect(rules).toContain('P01');
  expect(rules).toContain('P03');
});

test('Eigenschaften-Feld: Status ändern wirkt im Kanban', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await page.evaluate(() => { toggleInspector(true); selectOne('t1'); });
  await page.click('#inspector-body [data-seg="status"] button[data-val="doing"]');
  await showView(page, 'kanban');
  await expect(page.locator('.kcol[data-col="doing"] [data-card="t1"]')).toHaveCount(1);
});
