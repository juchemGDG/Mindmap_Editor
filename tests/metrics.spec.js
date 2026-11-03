// Etappe 2: Kennzahlen (feste Beispiel-Protokolle), Definition of Done, Retrospektive, Board-Vorlagen
const { test, expect } = require('@playwright/test');
const { sampleDoc, tenCardDoc, openApp, openProcess, colId, events, loadDoc, getDoc, showView, center, mouseDrag } = require('./helpers');

const ts = s => Date.parse(s + ':00+02:00');      // Oktober 2026: Sommerzeit
const NOW = ts('2026-10-14T09:00');

/**
 * Festes Beispiel: Board ab Mo 05.10.2026 09:00, fünf Karten.
 *   A  angelegt 05.10 (offen) → in Arbeit 06.10 → erledigt 08.10
 *   B  schon vorher da (kein „angelegt“) → in Arbeit 07.10 → erledigt 12.10 (älterer Eintrag ohne toCat)
 *   C  angelegt 06.10 direkt in Arbeit, blockiert 07.10–09.10 → erledigt 13.10
 *   D  angelegt 08.10 (offen), blockiert seit 12.10 (noch)
 *   E  angelegt 05.10 in Arbeit → erledigt 06.10 → wieder in Arbeit 07.10 → erledigt 09.10
 */
function protocolDoc() {
  const cols = {
    kB: { id: 'kB', order: 1, title: 'Backlog', statusKey: 'todo' },
    kA: { id: 'kA', order: 2, title: 'In Arbeit', statusKey: 'doing', wip: 3 },
    kE: { id: 'kE', order: 3, title: 'Erledigt', statusKey: 'done' },
  };
  const node = (id, text, status, extra) => Object.assign({ id, parent: 'b1', order: id.charCodeAt(0), text, task: true, status, columnId: { todo: 'kB', doing: 'kA', done: 'kE' }[status] }, extra || {});
  const ev = [];
  const add = (t, type, task, extra) => ev.push(Object.assign({ id: 'e' + String(ev.length).padStart(3, '0'), t: ts(t), who: 'AB', type, task, title: task }, extra || {}));
  const mv = (t, task, fromCat, toCat) => add(t, 'task.moved', task, { fromCat, toCat, toCol: { todo: 'kB', doing: 'kA', done: 'kE' }[toCat] });
  add('2026-10-05T09:00', 'board.process', undefined, { title: undefined });
  add('2026-10-05T09:00', 'task.created', 'A', { toCat: 'todo' });
  add('2026-10-05T09:00', 'task.created', 'E', { toCat: 'doing' });
  mv('2026-10-06T09:00', 'A', 'todo', 'doing');
  add('2026-10-06T09:00', 'task.created', 'C', { toCat: 'doing' });
  mv('2026-10-06T09:00', 'E', 'doing', 'done');
  mv('2026-10-07T09:00', 'B', 'todo', 'doing');
  add('2026-10-07T09:00', 'blocker.set', 'C');
  mv('2026-10-07T09:00', 'E', 'done', 'doing');
  add('2026-10-07T10:00', 'wip.exceeded', 'E', { col: 'kA', to: 'In Arbeit: 4/3' });
  mv('2026-10-08T09:00', 'A', 'doing', 'done');
  add('2026-10-08T09:00', 'task.created', 'D', { toCat: 'todo' });
  add('2026-10-09T09:00', 'blocker.cleared', 'C');
  mv('2026-10-09T09:00', 'E', 'doing', 'done');
  add('2026-10-12T09:00', 'task.moved', 'B', { from: 'In Arbeit', to: 'Erledigt', toCol: 'kE' });   // wie in Etappe 1: ohne fromCat/toCat
  add('2026-10-12T09:00', 'blocker.set', 'D');
  add('2026-10-13T09:00', 'task.moved', 'C', { fromCat: 'doing', toCat: 'done', toCol: 'kE' });
  add('2026-10-13T09:05', 'dod.confirmed', 'C', { col: 'kE', to: 'Erledigt: 2 von 2 Kriterien bestätigt' });
  const d = sampleDoc();
  d.doc.nodes = {
    root: { id: 'root', parent: null, order: 0, text: 'Projekt' }, b1: { id: 'b1', parent: 'root', order: 1, text: 'Bau' },
    A: node('A', 'A', 'done'), B: node('B', 'B', 'done'), C: node('C', 'C', 'done'),
    D: node('D', 'D', 'todo', { blocked: { flag: true, reason: 'wartet', since: ts('2026-10-12T09:00') } }), E: node('E', 'E', 'done'),
  };
  d.doc.meta.m.kanbanMode = 'process';
  d.doc.meta.m.kanbanId = 'btest';
  d.doc.columns = cols;
  d.doc.events = Object.fromEntries(ev.map(e => [e.id, e]));
  return d;
}

test.describe('Kennzahlen aus festem Protokoll', () => {
  test('Durchlaufzeit, Bearbeitungszeit, Durchsatz, Blockadedauer, Zähler', async ({ page }) => {
    await openApp(page, null, { doc: protocolDoc() });
    const m = await page.evaluate(now => computeMetrics(doc, now), NOW);
    const card = id => m.cards.find(c => c.id === id);
    expect([card('A').lead, card('B').lead, card('C').lead, card('E').lead]).toEqual([3, 7, 7, 4]);
    expect([card('A').cycle, card('B').cycle, card('C').cycle, card('E').cycle]).toEqual([2, 5, 7, 4]);
    expect(card('D').lead).toBeNull();
    expect(card('B').fromBoardStart).toBe(true);
    expect(m.lead).toEqual({ n: 4, median: 5.5, mean: 5.25 });
    expect(m.cycle).toEqual({ n: 4, median: 4.5, mean: 4.5 });
    expect(m.weeks.map(w => [w.label, w.count])).toEqual([['KW 41', 2], ['KW 42', 2]]);
    expect(m.throughput.mean).toBe(2);
    expect(card('C').blocked).toBe(2);
    expect(card('D').blocked).toBe(2);
    expect(card('D').blockedNow).toBe(true);
    expect(m.blockade).toMatchObject({ total: 4, cards: 2, median: 2, mean: 2 });
    expect([m.wipExceeded, m.dodConfirmed, m.doneCount, m.total]).toEqual([1, 1, 4, 5]);
  });

  test('Cumulative Flow: Stand am Ende jedes Tages', async ({ page }) => {
    await openApp(page, null, { doc: protocolDoc() });
    const cfd = await page.evaluate(now => computeMetrics(doc, now).cfd, NOW);
    expect(cfd.map(r => [r.day, r.todo, r.doing, r.done])).toEqual([
      ['2026-10-05', 2, 1, 0], ['2026-10-06', 1, 2, 1], ['2026-10-07', 0, 4, 0], ['2026-10-08', 1, 3, 1],
      ['2026-10-09', 1, 2, 2], ['2026-10-10', 1, 2, 2], ['2026-10-11', 1, 2, 2], ['2026-10-12', 1, 1, 3],
      ['2026-10-13', 1, 0, 4], ['2026-10-14', 1, 0, 4],
    ]);
  });

  test('Kennzahlen bleiben gleich, wenn Spalten umbenannt oder gelöscht werden', async ({ page }) => {
    await openApp(page, null, { doc: protocolDoc() });
    const before = await page.evaluate(now => computeMetrics(doc, now), NOW);
    const after = await page.evaluate(now => {
      const d = clone(doc);
      d.columns.kE.title = 'Fertig';
      delete d.columns.kA;
      return computeMetrics(d, now);
    }, NOW);
    expect(after.lead).toEqual(before.lead);
    expect(after.cycle).toEqual(before.cycle);
    expect(after.cfd).toEqual(before.cfd);
  });

  test('Ansicht „Kennzahlen“: Kacheln, Diagramme mit Tabelle, Werte per Tastatur und Zeigen', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page, null, { doc: protocolDoc() });
    await page.evaluate(() => { markNoticeSeen(); toggleInspector(false); });
    await showView(page, 'kanban');
    await page.click('[data-kpane="metrics"]');
    await expect(page.locator('.kp-tile').nth(1)).toContainText('5,5 Tage');
    await expect(page.locator('.kp-tile').nth(1)).toContainText('Mittelwert 5,3 Tage');
    await expect(page.locator('.kp-tile').nth(2)).toContainText('4,5 Tage');
    await expect(page.locator('[data-chart="cfd"] polygon')).toHaveCount(3);
    await expect(page.locator('.kp-legend')).toContainText('Offen');
    await expect(page.locator('[data-chart="throughput"] .kp-bar')).toHaveCount(2);
    // Tabelle mit denselben Zahlen
    const rows = page.locator('section:has(#kp-cfd-h) tbody tr');
    await expect(rows).toHaveCount(10);
    await expect(rows.nth(2)).toContainText('07.10.2026');
    // Tastatur: Diagramm fokussieren, Pos1 = erster Tag
    await page.locator('[data-cfd]').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#kp-tip')).toBeVisible();
    await expect(page.locator('#kp-tip')).toContainText('05.10.2026');
    await expect(page.locator('#kp-tip')).toContainText('2 Offen');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#kp-tip')).toContainText('4 In Arbeit');
    // Zeigen auf eine Säule
    const bar = page.locator('.kp-hitbar').first();
    const b = await bar.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 5);
    await expect(page.locator('#kp-tip')).toContainText('KW 41');
    expect(page.errors).toEqual([]);
  });
});

test.describe('Definition of Done', () => {
  async function boardWithDod(page) {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    const review = await colId(page, 'Review');
    await page.click(`[data-ka="col-settings"][data-col="${review}"]`);
    await page.fill('[data-kc="dod"]', 'Von einer anderen Person geprüft\nRückmeldung eingearbeitet\n');
    await page.click('#kanban-box [data-kd="close"]');
    expect(await page.evaluate(id => doc.columns[id].dod, review)).toEqual(['Von einer anderen Person geprüft', 'Rückmeldung eingearbeitet']);
    return review;
  }

  test('Beim Ziehen in die Spalte erscheint der Dialog; Abbrechen lässt die Karte stehen', async ({ page }) => {
    const review = await boardWithDod(page);
    await mouseDrag(page, await center(page.locator('[data-pcard="t1"]')), await center(page.locator(`.kpcol[data-colid="${review}"] .kp-title`)));
    await expect(page.locator('#kanban-box')).toContainText('Definition of Done: „Review“');
    await expect(page.locator('[data-dodi]')).toHaveCount(2);
    await page.click('#kanban-box [data-kd="close"]');
    expect((await getDoc(page)).nodes.t1.status).toBe('todo');
  });

  test('Bestätigen verschiebt (auch wenn nicht alles erfüllt ist) und protokolliert', async ({ page }) => {
    const review = await boardWithDod(page);
    await page.locator('[data-pcard="t1"]').focus();
    await page.keyboard.press('m');
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Review' }).click();
    await page.check('[data-dodi="0"]');
    await page.click('[data-kd="dod-ok"]');
    const d = await getDoc(page);
    expect(d.nodes.t1.columnId).toBe(review);
    expect(d.nodes.t1.status).toBe('doing');
    const ev = await events(page);
    expect(ev.find(e => e.type === 'dod.confirmed')).toMatchObject({ task: 't1', col: review, to: 'Review: 1 von 2 Kriterien bestätigt', who: 'AB' });
    expect(ev.some(e => e.type === 'task.moved' && e.task === 't1')).toBe(true);
    // Reihenfolge im Protokoll: erst verschoben, dann DoD bestätigt (auch in derselben Millisekunde)
    const i = ev.findIndex(e => e.type === 'dod.confirmed');
    expect(ev[i - 1]).toMatchObject({ type: 'task.moved', task: 't1' });
  });

  test('Tastatur: Shift+→ in eine Spalte mit DoD öffnet den Dialog, Enter auf „Verschieben“ bestätigt', async ({ page }) => {
    await boardWithDod(page);
    await page.evaluate(() => moveCard('t2', boardColumns()[2].id));     // t2 steht in „In Arbeit“, rechts daneben: Review
    await page.locator('[data-pcard="t2"]').focus();
    await page.keyboard.press('Shift+ArrowRight');
    // der Fokus springt von selbst auf das erste Kriterium
    await expect(page.locator('[data-dodi="0"]')).toBeFocused();
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');           // zweites Kriterium
    await page.keyboard.press('Tab');           // Abbrechen
    await page.keyboard.press('Tab');           // Verschieben
    await expect(page.locator('[data-kd="dod-ok"]')).toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => doc.columns[doc.nodes.t2.columnId].title)).toBe('Review');
    expect(await page.evaluate(() => auditList().find(e => e.type === 'dod.confirmed').to)).toBe('Review: 1 von 2 Kriterien bestätigt');
  });
});

test.describe('Retrospektive', () => {
  test('Anlegen, Antworten speichern, in der Datei und als Markdown', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page, null, { doc: protocolDoc() });
    await page.evaluate(() => markNoticeSeen());
    await showView(page, 'kanban');
    await page.click('[data-kpane="retro"]');
    await expect(page.locator('.view-empty')).toContainText('Retrospektive hilft');
    await page.click('[data-kr="new"]');
    await page.fill('[data-rq="q1"]', 'Die Test-Spalte hat geholfen.');
    await page.fill('[data-rq="q3"]', 'WIP-Limit auf 2 senken.');
    await page.click('[data-kpane="board"]');
    await page.click('[data-kpane="retro"]');
    await expect(page.locator('[data-rq="q1"]')).toHaveValue('Die Test-Spalte hat geholfen.');
    await expect(page.locator('.kp-retrobody')).toContainText('5,5 Tage');            // eingefrorene Kennzahlen
    const saved = JSON.parse(await page.evaluate(() => JSON.stringify(docPayload())));
    const r = Object.values(saved.doc.retros)[0];
    expect(r).toMatchObject({ q1: 'Die Test-Spalte hat geholfen.', q3: 'WIP-Limit auf 2 senken.' });
    expect(r.snapshot.leadMedian).toBe(5.5);
    const md = await page.evaluate(id => retroMarkdown(doc.retros[id]), r.id);
    expect(md).toContain('## Was lief gut?\n\nDie Test-Spalte hat geholfen.');
    expect(md).toContain('## Wo gab es Engpässe oder Blockaden?\n\n_(keine Antwort)_');
    expect(md).toContain('- Durchlaufzeit (Median / Mittelwert): 5,5 Tage / 5,3 Tage');
    // Antworten kommen nicht ins Protokoll
    expect((await events(page)).filter(e => e.t > NOW - 1000)).toEqual([]);
  });
});

test.describe('Board-Vorlagen', () => {
  test('„Neu“ › NwT-Projekt 8 Wochen: Spalten, WIP, DoD, Meilensteine, Aufgaben im Backlog', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page);
    await page.click('#btn-new');
    await page.click('[data-tpl="kb-nwt8"]');
    await expect(page.locator('#kanban-view')).toBeVisible();
    const d = await getDoc(page);
    expect(d.meta.m.kanbanMode).toBe('process');
    const cols = Object.values(d.columns).sort((a, b) => a.order - b.order);
    expect(cols.map(c => c.title)).toEqual(['Backlog', 'Diese Woche', 'In Arbeit', 'Test', 'Erledigt']);
    expect(cols.map(c => c.wip || 0)).toEqual([0, 6, 3, 2, 0]);
    expect(cols[3].dod).toHaveLength(2);
    expect(cols[4].dod).toHaveLength(3);
    const ms = Object.values(d.nodes).filter(n => n.ms);
    // Woche 1 = diese Woche (ab Mo 12.10.), Meilenstein jeweils am Freitag
    expect(ms.map(n => [n.text, n.due]).sort()).toEqual([
      ['Abschlusspräsentation', '2026-12-04'], ['Funktionstest bestanden', '2026-11-27'],
      ['Projektskizze abgeben', '2026-10-23'], ['Zwischenpräsentation', '2026-11-06'],
    ]);
    const tasks = Object.values(d.nodes).filter(n => n.task && !n.ms);
    expect(tasks.length).toBe(12);
    expect(tasks.every(n => d.columns[n.columnId].title === 'Backlog')).toBe(true);
    // keine Rückgängig-Schritte aus der Vorlage
    expect(await page.evaluate(() => undoStack.length)).toBe(0);
  });

  test('Vorlage auf ein vorhandenes Board anwenden; Karten bleiben erhalten', async ({ page }) => {
    await openApp(page, null, { doc: tenCardDoc() });
    await openProcess(page);
    page.on('dialog', dlg => dlg.accept());
    await page.click('[data-ka="templates"]');
    await page.check('input[name="kp-tpl"][value="review"]');
    await page.uncheck('[data-kv="milestones"]');
    await page.click('[data-kd="tpl-apply"]');
    expect(await page.locator('.kpcol .kp-title').allTextContents()).toEqual(['Backlog', 'In Arbeit', 'Review', 'Erledigt']);
    await expect(page.locator('.kpcard')).toHaveCount(10);
    const d = await getDoc(page);
    expect(d.nodes.t2.status).toBe('doing');
    expect(d.columns[d.nodes.t2.columnId].title).toBe('In Arbeit');
    expect((await events(page)).pop()).toMatchObject({ type: 'board.template', to: 'Projekt mit Review' });
  });

  test('Eigene Vorlage aus dem aktuellen Board speichern und unter „Neu“ wiederverwenden', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.evaluate(() => { const c = boardColumns()[3]; updateColumn(c.id, { title: 'Prüfen', wip: 1, dod: ['Getestet'] }); });
    await page.click('[data-ka="templates"]');
    await page.click('[data-kd="tpl-save"]');
    await page.fill('#prompt-input', 'Unsere Klasse');
    await page.click('#prompt-ok');
    await expect(page.locator('#kanban-box')).toContainText('Unsere Klasse');
    await page.click('#kanban-box [data-kd="close"]');
    page.on('dialog', dlg => dlg.accept());
    await page.click('#btn-new');
    await expect(page.locator('#template-list')).toContainText('Unsere Klasse');
    await page.locator('#template-list .tpl', { hasText: 'Unsere Klasse' }).click();
    const cols = await page.evaluate(() => boardColumns().map(c => [c.title, c.wip || 0, (c.dod || []).length]));
    expect(cols).toEqual([['Backlog', 0, 0], ['Geplant', 0, 0], ['In Arbeit', 3, 0], ['Prüfen', 1, 1], ['Erledigt', 0, 0]]);
    expect(await page.evaluate(() => Object.keys(doc.nodes).length)).toBe(1);
  });
});
