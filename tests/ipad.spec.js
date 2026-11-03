// Bedienung per Touch (iPad-Maße, Touch-Ereignisse)
const { test, expect } = require('@playwright/test');
const { sampleDoc, tenCardDoc, openApp, getDoc, showView, center, touchDrag, touchTap, colId } = require('./helpers');

test('iPad: Kanban-Karte mit dem Finger ziehen ändert den Status', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  await touchDrag(page, await center(page.locator('[data-card="t1"]')), await center(page.locator('.kcol[data-col="doing"] header')));
  expect((await getDoc(page)).nodes.t1.status).toBe('doing');
});

// Abnahme Etappe 1: Board mit 5 Spalten und 10 Karten komplett per Touch bedienbar
test('iPad: Prozess-Board (5 Spalten, 10 Karten) komplett per Touch', async ({ page }) => {
  await openApp(page, null, { doc: tenCardDoc() });
  await page.evaluate(() => localStorage.setItem('mm-name', 'AB'));
  await showView(page, 'kanban');
  const tap = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await touchTap(page, await center(l)); };

  // Modus umschalten und Hinweis zum Protokoll bestätigen
  await tap('[data-kmode] button[data-val="process"]');
  await expect(page.locator('#kanban-box')).toContainText('Hinweis: Protokoll');
  await tap('[data-kd="notice-ok"]');
  await expect(page.locator('.kpcol')).toHaveCount(5);
  await expect(page.locator('.kpcard')).toHaveCount(10);

  // Karte antippen öffnet den Editor, Aufwand per Touch, Fertig
  await tap('[data-pcard="t1"] .ktext');
  await expect(page.locator('#card-modal')).toBeVisible();
  await tap('#card-box [data-cseg="estimate"] button[data-val="S"]');
  await tap('#card-box .btn-primary[data-cd="close"]');
  await expect(page.locator('#card-modal')).toBeHidden();
  expect((await getDoc(page)).nodes.t1.estimate).toBe('S');

  // Mit dem Finger in die Nachbarspalte ziehen
  const geplant = await colId(page, 'Geplant');
  await touchDrag(page, await center(page.locator('[data-pcard="t1"]')), await center(page.locator(`.kpcol[data-colid="${geplant}"] .kp-title`)));
  let d = await getDoc(page);
  expect(d.nodes.t1.columnId).toBe(geplant);

  // Ohne Ziehen: Menü ⋯ › „Verschieben nach“ › Review
  await tap('[data-pcard="t1"] .kp-more');
  await expect(page.locator('.ctx-menu')).toBeVisible();
  await tap('.ctx-menu .ctx-item:has-text("Review")');
  d = await getDoc(page);
  expect(d.nodes.t1.status).toBe('doing');
  expect(d.columns[d.nodes.t1.columnId].title).toBe('Review');

  // Neue Karte über „+“
  await tap(`[data-ka="add-card"][data-col="${geplant}"]`);
  await page.fill('#prompt-input', 'Per Touch angelegt');
  await tap('#prompt-ok');
  await expect(page.locator('.kpcard')).toHaveCount(11);

  // Spalte einstellen: nach rechts schieben
  await tap(`[data-ka="col-settings"][data-col="${geplant}"]`);
  await tap('[data-kd="right"]');
  await tap('#kanban-box .btn-primary[data-kd="close"]');
  expect(await page.locator('.kpcol .kp-title').allTextContents()).toEqual(['Backlog', 'In Arbeit', 'Geplant', 'Review', 'Erledigt']);

  // Zeitplan zeigt den neuen Status
  await showView(page, 'timeline');
  await expect(page.locator('[data-row="t1"]')).toBeVisible();
  expect(page.errors).toEqual([]);
});

// Etappe 3 per Touch: Kriterien anlegen und verknüpfen, Bericht, Gruppenübersicht
test('iPad: Kriterien, Bericht und Gruppenübersicht per Touch', async ({ page }) => {
  await openApp(page, null, { doc: tenCardDoc() });
  await page.evaluate(() => { localStorage.setItem('mm-name', 'AB'); setKanbanMode('process'); markNoticeSeen(); });
  await showView(page, 'kanban');
  const tap = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await touchTap(page, await center(l)); };
  await tap('[data-kpane="criteria"]');
  await page.fill('[data-crit-new]', 'Dokumentation');
  await tap('[data-critact="add"]');
  await tap('[data-kpane="board"]');
  await tap('[data-pcard="t3"] .ktext');
  await tap('#card-box [data-ccrit]');
  await tap('#card-box .btn-primary[data-cd="close"]');
  expect(await page.evaluate(() => criteriaCoverage()[0].state)).toBe('belegt');
  // Bericht-Dialog
  await tap('[data-ka="report"]');
  await expect(page.locator('#kanban-box')).toContainText('Bericht');
  await tap('#kanban-box [data-kd="close"]');
  // Gruppenübersicht über das Menü
  await tap('#btn-export');
  await tap('.ctx-menu .ctx-item:has-text("Gruppenübersicht")');
  await expect(page.locator('#groups-modal')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await tap('[data-gact="pick"]');
  (await chooser).setFiles([{ name: 'g1.json', mimeType: 'application/json', buffer: Buffer.from(await page.evaluate(() => JSON.stringify(docPayload()))) }]);
  await expect(page.locator('.gr-table tbody tr')).toHaveCount(1);
  await tap('[data-gact="close"]');
  await expect(page.locator('#groups-modal')).toBeHidden();
  expect(page.errors).toEqual([]);
});

// Etappe 2 per Touch: Definition of Done, Kennzahlen, Retrospektive
test('iPad: DoD-Dialog, Kennzahlen und Retrospektive per Touch', async ({ page }) => {
  await openApp(page, null, { doc: tenCardDoc() });
  await page.evaluate(() => {
    localStorage.setItem('mm-name', 'AB'); setKanbanMode('process'); markNoticeSeen();
    const c = boardColumns().find(x => x.title === 'Geplant'); updateColumn(c.id, { dod: ['Aufgabe ist klar beschrieben'] });
  });
  await showView(page, 'kanban');
  const tap = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await touchTap(page, await center(l)); };
  const geplant = await colId(page, 'Geplant');
  await touchDrag(page, await center(page.locator('[data-pcard="t1"]')), await center(page.locator(`.kpcol[data-colid="${geplant}"] .kp-title`)));
  await expect(page.locator('[data-dodi]')).toHaveCount(1);
  await tap('label:has([data-dodi="0"])');
  await tap('[data-kd="dod-ok"]');
  expect(await page.evaluate(() => auditList().find(e => e.type === 'dod.confirmed'))).toMatchObject({ task: 't1', to: 'Geplant: 1 von 1 Kriterien bestätigt' });
  // Kennzahlen: Antippen des Diagramms zeigt die Werte
  await page.evaluate(() => moveCard('t2', boardColumns()[4].id));
  await tap('[data-kpane="metrics"]');
  await expect(page.locator('[data-chart="cfd"] polygon')).toHaveCount(3);
  await tap('[data-chart="cfd"] .kp-hit');
  await expect(page.locator('#kp-tip')).toBeVisible();
  await expect(page.locator('#kp-tip')).toContainText('Erledigt');
  // Retrospektive
  await tap('[data-kpane="retro"]');
  await tap('[data-kr="new"]');
  await page.fill('[data-rq="q2"]', 'Review hat gestaut');
  await tap('[data-kpane="board"]');
  expect(await page.evaluate(() => Object.values(doc.retros)[0].q2)).toBe('Review hat gestaut');
  expect(page.errors).toEqual([]);
});
