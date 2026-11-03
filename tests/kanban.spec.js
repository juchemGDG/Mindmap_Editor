// Kanban-Modus „Prozess“: Logik (Spalte ↔ Status, Protokoll, WIP, Migration) und Bedienung
const { test, expect } = require('@playwright/test');
const { sampleDoc, tenCardDoc, openApp, openProcess, colId, events, loadDoc, getDoc, showView, center, mouseDrag } = require('./helpers');

test.describe('Modus und Migration', () => {
  test('Standard ist „einfach“; Prozess legt das Standard-Board an und sortiert vorhandene Aufgaben ein', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    expect(await page.evaluate(() => kanbanProcess())).toBe(false);
    await openProcess(page);
    expect(await page.locator('.kpcol .kp-title').allTextContents()).toEqual(['Backlog', 'Geplant', 'In Arbeit', 'Review', 'Erledigt']);
    const d = await getDoc(page);
    const title = id => d.columns[d.nodes[id].columnId].title;
    expect([title('t1'), title('t2'), title('t3')]).toEqual(['Backlog', 'In Arbeit', 'Erledigt']);
    expect(Object.values(d.members).map(m => m.name).sort()).toEqual(['AB', 'CD']);
    // Status bleibt unverändert
    expect([d.nodes.t1.status, d.nodes.t2.status, d.nodes.t3.status]).toEqual(['todo', 'doing', 'done']);
    expect(page.errors).toEqual([]);
  });

  test('Zurück auf „einfach“: Kanban wie in 1.0.0, Daten bleiben erhalten', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('[data-kmode] button[data-val="simple"]');
    expect(await page.locator('.kcol header b').allTextContents()).toEqual(['Ideen', 'Offen', 'In Arbeit', 'Erledigt']);
    expect(Object.keys((await getDoc(page)).columns)).toHaveLength(5);
  });

  test('Speichern und erneutes Öffnen liefern identische Daten (mit Spalten und Protokoll)', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.evaluate(() => moveCard('t1', boardColumns()[3].id));
    const saved = await page.evaluate(() => JSON.stringify(docPayload()));
    expect(JSON.parse(saved).version).toBe(2);
    const before = await getDoc(page);
    await loadDoc(page, JSON.parse(saved));
    expect(await getDoc(page)).toEqual(before);
  });

  test('Unbekannte Sammlungen aus einer neueren Version bleiben erhalten', async ({ page }) => {
    const d = sampleDoc();
    d.doc.zukunft = { a: { id: 'a', x: 1 } };
    await openApp(page, null, { doc: d });
    expect((await getDoc(page)).zukunft).toEqual({ a: { id: 'a', x: 1 } });
  });

  test('Import prüft die Datei und meldet Fehler auf Deutsch', async ({ page }) => {
    await openApp(page);
    const r = await page.evaluate(() => [
      validateFile({ format: 'mindmap-editor', doc: { meta: {} } }),
      validateFile({ format: 'mindmap-editor', version: 9, doc: { nodes: { root: { id: 'root' } }, columns: { k: { title: 'X', statusKey: 'quatsch' } } } }),
    ]);
    expect(r[0].fatal).toBe(true);
    expect(r[0].errors[0]).toContain('fehlen die Punkte');
    expect(r[1].fatal).toBe(false);
    expect(r[1].warnings.join(' ')).toContain('neueren Version');
    expect(r[1].warnings.join(' ')).toContain('keine gültige Status-Kategorie');
  });
});

test.describe('Spalte ↔ Status', () => {
  test('Verschieben setzt den Status passend zur Kategorie – Zeitplan und Gantt stimmen', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await mouseDrag(page, await center(page.locator('[data-pcard="t1"]')), await center(page.locator(`.kpcol[data-colid="${await colId(page, 'Review')}"] header`)));
    let d = await getDoc(page);
    expect(d.nodes.t1.status).toBe('doing');
    expect(d.columns[d.nodes.t1.columnId].title).toBe('Review');
    await showView(page, 'timeline');
    await page.click('[data-planmode] button[data-val="project"]');
    await expect(page.locator('.g-label[data-row="t1"] .sbox.doing')).toHaveCount(1);
    await showView(page, 'kanban');
    await page.evaluate(() => moveCard('t1', boardColumns()[4].id));
    d = await getDoc(page);
    expect(d.nodes.t1.status).toBe('done');
  });

  test('Statusänderung anderswo wählt die zuletzt benutzte Spalte der Kategorie', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    const review = await colId(page, 'Review'), inArbeit = await colId(page, 'In Arbeit');
    // ohne Vorgeschichte: erste Spalte der Kategorie
    await page.evaluate(() => mutate('Status', () => { doc.nodes.t1.status = 'doing'; }));
    expect((await getDoc(page)).nodes.t1.columnId).toBe(inArbeit);
    // nachdem zuletzt nach „Review“ verschoben wurde: Review
    await page.evaluate(id => moveCard('t2', id), review);
    await page.evaluate(() => mutate('Status', () => { doc.nodes.t1.status = 'todo'; }));
    await page.evaluate(() => { toggleInspector(true); selectOne('t1'); });
    await page.click('#inspector-body [data-seg="status"] button[data-val="doing"]');
    expect((await getDoc(page)).nodes.t1.columnId).toBe(review);
  });

  test('Spalte löschen fragt nach der Zielspalte – keine Karte geht verloren', async ({ page }) => {
    await openApp(page, null, { doc: tenCardDoc() });
    await openProcess(page);
    const backlog = await colId(page, 'Backlog');
    const n = await page.locator(`.kpcol[data-colid="${backlog}"] .kpcard`).count();
    expect(n).toBeGreaterThan(0);
    await page.click(`[data-ka="col-settings"][data-col="${backlog}"]`);
    await page.click('[data-kd="delete"]');
    await page.selectOption('[data-kc="target"]', { label: 'Geplant (Offen)' });
    await page.click('[data-kd="delete-ok"]');
    await expect(page.locator('.kpcol')).toHaveCount(4);
    const d = await getDoc(page);
    expect(Object.values(d.nodes).filter(x => x.task).length).toBe(10);
    await expect(page.locator(`.kpcol[data-colid="${await colId(page, 'Geplant')}"] .kpcard`)).toHaveCount(n);
  });

  test('Die letzte Spalte einer Kategorie lässt sich nicht löschen', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    const msg = await page.evaluate(() => deleteColumn(boardColumns().find(c => c.title === 'Erledigt').id, boardColumns()[0].id));
    expect(msg).toContain('letzte Spalte');
    await expect(page.locator('.kpcol')).toHaveCount(5);
  });

  test('Spalte anlegen, umbenennen, Kategorie, Farbe, WIP und Reihenfolge', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('[data-ka="add-col"]');
    await page.fill('[data-kc="title"]', 'Testen');
    await page.selectOption('[data-kc="statusKey"]', 'doing');
    await page.fill('[data-kc="wip"]', '2');
    await page.locator('[data-kc="wip"]').dispatchEvent('change');
    await page.click('[data-kccolor="c3"]');
    await page.click('[data-kd="left"]');
    await page.click('[data-kd="close"]');
    expect(await page.locator('.kpcol .kp-title').allTextContents()).toEqual(['Backlog', 'Geplant', 'In Arbeit', 'Review', 'Testen', 'Erledigt']);
    const c = await page.evaluate(() => boardColumns().find(x => x.title === 'Testen'));
    expect(c).toMatchObject({ statusKey: 'doing', wip: 2, color: 'c3' });
  });

  test('Spalte mit der Maus am Griff verschieben', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    const done = await colId(page, 'Erledigt');
    await mouseDrag(page, await center(page.locator(`[data-cgrip="${done}"]`)), await center(page.locator(`.kpcol[data-colid="${await colId(page, 'Backlog')}"] .kp-title`)));
    expect((await page.locator('.kpcol .kp-title').allTextContents())[0]).toBe('Erledigt');
  });
});

test.describe('WIP-Limit (K01) und weitere Regeln', () => {
  test('Überschreiten markiert die Spalte (Icon, Text), zeigt einen Hinweis und meldet K01', async ({ page }) => {
    await openApp(page, null, { doc: tenCardDoc() });
    await openProcess(page);
    const inArbeit = await colId(page, 'In Arbeit');      // Limit 3, schon 3 Karten (t2, x2, x6)
    await expect(page.locator(`.kpcol[data-colid="${inArbeit}"] .kp-count`)).toHaveText('3/3');
    await page.evaluate(id => moveCard('t1', id), inArbeit);
    const col = page.locator(`.kpcol[data-colid="${inArbeit}"]`);
    await expect(col).toHaveClass(/wip-over/);
    await expect(col.locator('.kp-wipwarn')).toContainText('⚠ WIP-Limit überschritten (4/3)');
    await expect(col).toHaveAttribute('aria-label', /Limit überschritten/);
    await expect(page.locator('#k-toast')).toContainText('Was hindert euch');
    // Hinweis blockiert nichts und lässt sich wegklicken
    await page.click('#k-toast button');
    await expect(page.locator('#k-toast')).toBeHidden();
    expect(await page.evaluate(() => evaluateMap().map(f => f.rule))).toContain('K01');
    expect((await events(page)).some(e => e.type === 'wip.exceeded')).toBe(true);
    // Regel lässt sich wie die anderen ausblenden
    await page.evaluate(() => mutate('Regel', () => { M().disabledRules = ['K01']; }));
    expect(await page.evaluate(() => evaluateMap().map(f => f.rule))).not.toContain('K01');
  });

  test('K02 überfällig und K03 lange blockiert', async ({ page }) => {
    const d = sampleDoc();
    d.doc.meta.m.phase = 'order';
    d.doc.nodes.t2.blocked = { flag: true, reason: 'Lötkolben fehlt', since: Date.now() - 5 * 86400000 };
    await openApp(page, null, { doc: d });
    await openProcess(page);
    const rules = await page.evaluate(() => evaluateMap().map(f => f.rule));
    expect(rules).toContain('K02');
    expect(rules).toContain('K03');
  });
});

test.describe('Protokoll', () => {
  test('Aufgabenbezogene Änderungen aus allen Ansichten stehen mit Person und Zeit im Protokoll', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page, { name: 'AB' });
    const t0 = Date.now() - 1000;
    await page.evaluate(() => moveCard('t1', boardColumns()[1].id));                 // Kanban
    await page.evaluate(() => { toggleInspector(true); selectOne('t2'); });
    await page.click('#inspector-body [data-seg="prio"] button[data-val="2"]');       // Eigenschaften-Feld
    await showView(page, 'timeline');
    await page.locator('[data-row="t1"] input[type=date]').fill('2026-12-01');        // Zeitplan
    await page.locator('[data-row="t1"] input[type=date]').dispatchEvent('change');
    await page.evaluate(() => mutate('Text', () => { doc.nodes.i1.text = 'Video drehen!'; }));   // Idee: nicht protokollieren
    await page.evaluate(() => mutate('Layout', () => { M().layout = 'org'; }));                 // Layout: nicht protokollieren
    const ev = await events(page);
    const types = ev.map(e => e.type + ':' + (e.field || '') + ':' + e.task);
    expect(types).toContain('task.moved::t1');
    expect(types).toContain('task.changed:Priorität:t2');
    expect(types).toContain('task.changed:Fällig:t1');
    expect(ev.some(e => e.task === 'i1')).toBe(false);
    for (const e of ev) {
      expect(e.who).toBe('AB');
      expect(e.t).toBeGreaterThan(t0);
      expect(e.id).toMatch(/^e/);
    }
    const moved = ev.find(e => e.type === 'task.moved');
    expect(moved).toMatchObject({ from: 'Backlog', to: 'Geplant' });
  });

  test('Rückgängig nimmt die Änderung zurück, das Protokoll behält den Eintrag und ergänzt einen neuen', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.evaluate(() => moveCard('t1', boardColumns()[2].id));
    expect((await getDoc(page)).nodes.t1.status).toBe('doing');
    const n1 = (await events(page)).length;
    await page.click('#btn-undo');
    const d = await getDoc(page);
    expect(d.nodes.t1.status).toBe('todo');
    expect(d.columns[d.nodes.t1.columnId].title).toBe('Backlog');
    const ev = await events(page);
    expect(ev.length).toBe(n1 + 1);
    expect(ev[ev.length - 1]).toMatchObject({ type: 'task.moved', via: 'undo', from: 'In Arbeit', to: 'Backlog' });
    await page.click('#btn-redo');
    expect((await getDoc(page)).nodes.t1.status).toBe('doing');
  });

  test('Tippen erzeugt einen einzigen Eintrag', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('[data-pcard="t1"]');
    await page.locator('[data-cf="text"]').pressSequentially(' neu', { delay: 20 });
    const ev = (await events(page)).filter(e => e.task === 't1' && e.field === 'Titel');
    expect(ev).toHaveLength(1);
    expect(ev[0].from).toBeUndefined();     // Inhalt wird nicht ins Protokoll kopiert
  });

  test('„Personenbezogen“ aus: Einträge ohne Person', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.evaluate(() => mutate('x', () => { M().kanbanPersonal = false; }));
    await page.evaluate(() => moveCard('t1', boardColumns()[1].id));
    const e = (await events(page)).pop();
    expect(e.type).toBe('task.moved');
    expect(e.who).toBeNull();
  });

  test('Protokoll-Ansicht mit Filter nach Person, Karte und Zeitraum', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page, { name: 'AB' });
    await page.evaluate(() => moveCard('t1', boardColumns()[1].id));
    await page.evaluate(() => { localStorage.setItem('mm-name', 'CD'); moveCard('t2', boardColumns()[3].id); });
    await page.click('[data-ka="log"]');
    await expect(page.locator('#kanban-box')).toContainText('Arbeitsnachweis, kein Beweis');
    const rows = () => page.locator('.kp-log tbody tr');
    const all = await rows().count();
    await page.selectOption('[data-kl="who"]', 'CD');
    await expect(rows()).toHaveCount(1);
    await expect(rows().first()).toContainText('Review');
    await page.selectOption('[data-kl="who"]', '');
    await page.selectOption('[data-kl="task"]', 't1');
    await expect(rows()).toHaveCount(1);
    await page.selectOption('[data-kl="task"]', '');
    await page.fill('[data-kl="to"]', '2020-01-01');
    await page.locator('[data-kl="to"]').dispatchEvent('change');
    await expect(rows().first()).toContainText('Noch keine Einträge');
    expect(all).toBeGreaterThanOrEqual(2);
  });

  test('Anonymisieren, Löschen und Auskunft „Alles zu Person X“', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page, { name: 'AB' });
    await page.evaluate(() => moveCard('t1', boardColumns()[1].id));
    const info = await page.evaluate(() => personExport('AB'));
    expect(info.aufgaben.map(a => a.titel).sort()).toEqual(['Bericht schreiben', 'Gehäuse sägen']);
    expect(info.protokoll.length).toBeGreaterThan(0);
    expect(info.hinweis).toContain('kein Beweis');
    expect(await page.evaluate(() => closeProject('anon'))).toBe('');
    const d = await getDoc(page);
    expect(Object.values(d.events).every(e => !e.who || /^Person \d+$/.test(e.who))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/"(AB|CD)"/);
    expect(d.nodes.t1.owner).toMatch(/^Person \d+$/);
    expect(await page.evaluate(() => closeProject('delete'))).toBe('');
    expect(Object.keys((await getDoc(page)).events)).toHaveLength(0);
  });

  test('Hinweis zum Protokoll erscheint beim ersten Öffnen und gehört zur Datei', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await page.evaluate(() => { setKanbanMode('process'); mutate('Zweck', () => { M().kanbanPurpose = 'Reflexion im NwT-Projekt'; }); });
    await showView(page, 'kanban');
    await expect(page.locator('#kanban-box')).toContainText('Reflexion im NwT-Projekt');
    await page.click('[data-kd="notice-ok"]');
    await page.click('[data-view-tab="map"]');
    await showView(page, 'kanban');
    await expect(page.locator('#kanban-modal')).toBeHidden();
    expect(JSON.parse(await page.evaluate(() => JSON.stringify(docPayload()))).doc.meta.m.kanbanPurpose).toBe('Reflexion im NwT-Projekt');
  });
});

test.describe('Karten', () => {
  test('Karteneditor: Titel, Zuständige (mehrere), Tags, Aufwand, Farbe, Inhalt, Checkliste, Blocker', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('[data-pcard="t1"] .ktext');
    await expect(page.locator('#card-modal')).toBeVisible();
    await page.fill('[data-cf="text"]', 'Gehäuse sägen und schleifen');
    await page.click('[data-cowner="CD"]');
    await page.fill('[data-cf="tag-new"]', 'Holz');
    await page.press('[data-cf="tag-new"]', 'Enter');
    await page.click('[data-cseg="estimate"] button[data-val="M"]');
    await page.click('[data-ccolor="c2"]');
    await page.fill('[data-cf="note"]', '**Achtung:** Schutzbrille');
    await page.fill('[data-cf="check-new"]', 'Anreißen');
    await page.press('[data-cf="check-new"]', 'Enter');
    await page.locator('#card-box [data-ccheck]').first().check();
    await page.click('label.switch:has([data-cf="blocked"])');
    await page.fill('[data-cf="reason"]', 'Säge belegt');
    await page.click('#card-box [data-cd="close"]');
    const n = (await getDoc(page)).nodes.t1;
    expect(n).toMatchObject({ text: 'Gehäuse sägen und schleifen', owner: 'AB, CD', tags: ['Holz'], estimate: 'M', color: 'c2', note: '**Achtung:** Schutzbrille' });
    expect(n.blocked).toMatchObject({ flag: true, reason: 'Säge belegt' });
    const card = page.locator('[data-pcard="t1"]');
    await expect(card).toContainText('⛔ blockiert: Säge belegt');
    await expect(card).toContainText('☑ 1/1');
    await expect(card.locator('.kp-note strong')).toHaveText('Achtung:');
    await expect(card.locator('.chip.owner')).toHaveCount(2);
    // Rückgängig wirkt auch auf Änderungen aus dem Editor
    await page.click('#btn-undo');
    const after = (await getDoc(page)).nodes.t1;
    expect(after.blocked && after.blocked.reason).not.toBe('Säge belegt');
  });

  test('Blockiert automatisch, solange ein Vorgänger nicht erledigt ist', async ({ page }) => {
    const d = sampleDoc();
    d.doc.nodes.t1.deps = ['t2'];
    await openApp(page, null, { doc: d });
    await openProcess(page);
    await expect(page.locator('[data-pcard="t1"] .kp-block')).toContainText('wartet auf „Platine löten“');
    await page.evaluate(() => moveCard('t2', boardColumns()[4].id));
    await expect(page.locator('[data-pcard="t1"] .kp-block')).toHaveCount(0);
  });

  test('Tag-Filter (Mehrfachauswahl); neue Karten übernehmen aktive Tags und landen im Ast', async ({ page }) => {
    const d = sampleDoc();
    d.doc.nodes.t1.tags = ['Holz'];
    d.doc.nodes.t2.tags = ['Elektronik'];
    await openApp(page, null, { doc: d });
    await openProcess(page);
    await page.click('[data-ktag="Holz"]');
    await expect(page.locator('.kpcard')).toHaveCount(1);
    await page.click('[data-ktag="Elektronik"]');
    await expect(page.locator('.kpcard')).toHaveCount(2);
    await page.click('[data-ktag="Elektronik"]');
    await page.selectOption('[data-kp="branch"]', 'b1');
    await page.click(`[data-ka="add-card"][data-col="${await colId(page, 'Geplant')}"]`);
    await page.fill('#prompt-input', 'Deckel bauen');
    await page.click('#prompt-ok');
    const nn = Object.values((await getDoc(page)).nodes).find(n => n.text === 'Deckel bauen');
    expect(nn).toMatchObject({ parent: 'b1', task: true, status: 'todo', tags: ['Holz'] });
    expect((await events(page)).some(e => e.type === 'task.created' && e.title === 'Deckel bauen' && e.to === 'Geplant')).toBe(true);
  });

  test('Kompakte und volle Ansicht', async ({ page }) => {
    const d = sampleDoc();
    d.doc.nodes.t1.note = 'Inhalt';
    await openApp(page, null, { doc: d });
    await openProcess(page);
    await expect(page.locator('[data-pcard="t1"] .kp-note')).toHaveCount(1);
    await page.click('[data-ka="compact"]');
    await expect(page.locator('[data-pcard="t1"] .kp-note')).toHaveCount(0);
    await expect(page.locator('.kboard.kp')).toHaveClass(/compact/);
  });

  test('Tastatur: Pfeiltasten, Shift+→ verschiebt, Enter öffnet, Escape schließt, M öffnet das Menü', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.locator('[data-pcard="t1"]').focus();
    await page.keyboard.press('Shift+ArrowRight');
    let d = await getDoc(page);
    expect(d.columns[d.nodes.t1.columnId].title).toBe('Geplant');
    await page.keyboard.press('Shift+ArrowRight');
    d = await getDoc(page);
    expect(d.nodes.t1.status).toBe('doing');
    await expect(page.locator('[data-pcard="t1"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#card-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#card-modal')).toBeHidden();
    await expect(page.locator('[data-pcard="t1"]')).toBeFocused();
    await page.keyboard.press('m');
    await expect(page.locator('.ctx-menu')).toContainText('Verschieben nach');
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Erledigt' }).click();
    expect((await getDoc(page)).nodes.t1.status).toBe('done');
  });

  test('Barrierearm: Spalten und Karten haben Beschriftungen, Blocker nicht nur als Farbe', async ({ page }) => {
    const d = sampleDoc();
    d.doc.nodes.t1.blocked = { flag: true, reason: 'x', since: Date.now() };
    await openApp(page, null, { doc: d });
    await openProcess(page);
    await expect(page.locator('.kpcol').first()).toHaveAttribute('aria-label', /^Spalte Backlog, 1 Karten/);
    await expect(page.locator('[data-pcard="t1"]')).toHaveAttribute('aria-label', /blockiert/);
    await expect(page.locator('[data-pcard="t1"] .kp-block')).toContainText('⛔');
    // Trefferflächen mindestens 44 px
    for (const sel of ['[data-ka="add-card"]', '[data-ka="col-settings"]', '.kp-more']) {
      const b = await page.locator(sel).first().boundingBox();
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
    }
  });
});

test('Markdown: kein HTML, keine Bilder, keine javascript-Links', async ({ page }) => {
  await openApp(page);
  const html = await page.evaluate(() => renderMarkdown([
    '<img src=x onerror=alert(1)>', '![Bild](https://fremd.example/x.png)', '[klick](javascript:alert(1))',
    '[gut](https://example.org/a_b_c)', '**fett** *kursiv* `<b>code</b>`', '- [x] erledigt', '<script>alert(1)</script>', '" onmouseover="x',
  ].join('\n')));
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<script');
  expect(html).not.toMatch(/href="javascript/i);
  // Im fertigen DOM: keine Bilder, keine Ereignis-Attribute, nur sichere Links
  const dom = await page.evaluate(h => {
    const div = document.createElement('div');
    div.innerHTML = h;
    const els = [...div.querySelectorAll('*')];
    return {
      tags: [...new Set(els.map(e => e.tagName.toLowerCase()))],
      onAttrs: els.flatMap(e => [...e.attributes].map(a => a.name)).filter(n => n.startsWith('on')),
      hrefs: [...div.querySelectorAll('a')].map(a => a.getAttribute('href')),
    };
  }, html);
  expect(dom.tags.filter(t => !['p', 'a', 'strong', 'em', 'code', 'ul', 'li', 'span'].includes(t))).toEqual([]);
  expect(dom.onAttrs).toEqual([]);
  expect(dom.hrefs.every(h => /^https:\/\//.test(h))).toBe(true);
  expect(html).toContain('<a href="https://example.org/a_b_c" target="_blank" rel="noopener noreferrer">gut</a>');
  expect(html).toContain('<strong>fett</strong>');
  expect(html).toContain('<code>&lt;b&gt;code&lt;/b&gt;</code>');
  expect(html).toContain('Bild: Bild');
});
