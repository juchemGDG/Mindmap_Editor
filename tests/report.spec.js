// Etappe 3: Bewertungskriterien, Bericht (Markdown, Druck/PDF), Gruppenübersicht
const { test, expect } = require('@playwright/test');
const { sampleDoc, tenCardDoc, openApp, openProcess, events, getDoc, showView } = require('./helpers');
const { NOW, protocolDoc } = require('./fixtures');

/** Beispiel mit zwei Kriterien: K1 durch erledigte Karte A belegt, K2 nur mit offener Karte D, K3 ohne Karte. */
function criteriaDoc() {
  const d = protocolDoc();
  d.doc.criteria = {
    k1: { id: 'k1', order: 1, title: 'Funktionierender Prototyp', desc: 'läuft 5 Minuten ohne Fehler' },
    k2: { id: 'k2', order: 2, title: 'Dokumentation' },
    k3: { id: 'k3', order: 3, title: 'Präsentation' },
  };
  d.doc.nodes.A.criteriaIds = ['k1'];
  d.doc.nodes.A.owner = 'AB, CD';
  d.doc.nodes.D.criteriaIds = ['k2'];
  return d;
}

test.describe('Bewertungskriterien', () => {
  test('Übersicht: belegt / in Arbeit / offen, mit Karten und Zuständigen', async ({ page }) => {
    await openApp(page, null, { doc: criteriaDoc() });
    const cov = await page.evaluate(() => criteriaCoverage().map(c => [c.crit.title, c.state, c.cards.map(k => k.id), c.persons]));
    expect(cov).toEqual([
      ['Funktionierender Prototyp', 'belegt', ['A'], ['AB', 'CD']],
      ['Dokumentation', 'in Arbeit', ['D'], []],
      ['Präsentation', 'offen', [], []],
    ]);
    await page.evaluate(() => markNoticeSeen());
    await showView(page, 'kanban');
    await page.click('[data-kpane="criteria"]');
    await expect(page.locator('.kp-tile').first()).toContainText('1 von 3');
    await expect(page.locator('[data-crit="k1"] .kp-critstate')).toHaveText('✓ belegt');
    await expect(page.locator('[data-crit="k1"]')).toContainText('(AB, CD)');
    await expect(page.locator('[data-crit="k3"]')).toContainText('Noch keine Karte verknüpft');
  });

  test('Anlegen, umbenennen, sortieren, im Karteneditor verknüpfen (protokolliert), löschen', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('[data-kpane="criteria"]');
    await page.fill('[data-crit-new]', 'Teamarbeit');
    await page.press('[data-crit-new]', 'Enter');
    await expect(page.locator('[data-crit-new]')).toBeFocused();
    await page.fill('[data-crit-new]', 'Technik');
    await page.click('[data-critact="add"]');
    await expect(page.locator('[data-crit]')).toHaveCount(2);
    await page.locator('[data-crit]').nth(1).locator('[data-critact="up"]').click();
    expect(await page.evaluate(() => criteriaList().map(c => c.title))).toEqual(['Technik', 'Teamarbeit']);
    await page.locator('[data-crit]').first().locator('[data-crit-title]').fill('Technik & Funktion');
    expect(await page.evaluate(() => criteriaList()[0].title)).toBe('Technik & Funktion');
    // im Karteneditor verknüpfen
    await page.click('[data-kpane="board"]');
    await page.click('[data-pcard="t3"] .ktext');
    const cid = await page.evaluate(() => criteriaList()[0].id);
    await page.click(`[data-ccrit="${cid}"]`);
    await page.click('#card-box [data-cd="close"]');
    expect((await getDoc(page)).nodes.t3.criteriaIds).toEqual([cid]);
    expect((await events(page)).find(e => e.field === 'Kriterien')).toMatchObject({ task: 't3', to: 'Technik & Funktion', who: 'AB' });
    await page.click('[data-kpane="criteria"]');
    await expect(page.locator(`[data-crit="${cid}"] .kp-critstate`)).toHaveText('✓ belegt');
    // löschen entfernt auch die Verknüpfung
    page.on('dialog', d => d.accept());
    await page.locator(`[data-crit="${cid}"] [data-critact="del"]`).click();
    expect((await getDoc(page)).nodes.t3.criteriaIds).toBeUndefined();
  });
});

test.describe('Bericht', () => {
  test('Markdown: Stand, Kennzahlen, Kriterien, Retrospektive, Protokoll-Auszug', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    const d = criteriaDoc();
    d.doc.retros = { r1: { id: 'r1', created: NOW, title: 'Retro Woche 2', snapshot: {}, q1: 'Gute Absprachen', q3: 'Kleinere Karten' } };
    await openApp(page, null, { doc: d });
    const md = await page.evaluate(() => reportMarkdown({}));
    expect(md).toContain('# Bericht: Testprojekt');
    expect(md).toContain('Arbeitsnachweis, kein Beweis');
    expect(md).toContain('### Erledigt (4)');
    expect(md).toContain('- D – fällig'.slice(0, 3));
    expect(md).toContain('- Durchlaufzeit (Median / Mittelwert): 5,5 Tage / 5,3 Tage');
    expect(md).toContain('| KW 41 | 05.10.2026 | 2 |');
    expect(md).toContain('- **Funktionierender Prototyp** – belegt: A (erledigt) [AB, CD]');
    expect(md).toContain('- **Präsentation** – offen');
    expect(md).toContain('### Retro Woche 2');
    expect(md).toContain('**Was lief gut?**\n\nGute Absprachen');
    expect(md).toContain('## Protokoll');
    expect(md).toContain('| Zeit | Person | Was | Karte |');
    expect(md).toMatch(/\| AB \| Karte verschoben: Offen → In Arbeit \| A \|/);
    // ohne Personen und ohne Protokoll
    const md2 = await page.evaluate(() => reportMarkdown({ persons: false }));
    expect(md2).toContain('| Zeit | Was | Karte |');
    expect(md2).not.toMatch(/\| AB \|/);
    const md3 = await page.evaluate(() => reportMarkdown({ log: 'none', retros: false, criteria: false }));
    expect(md3).not.toContain('## Protokoll');
    expect(md3).not.toContain('## Retrospektiven');
    expect(md3).not.toContain('## Bewertungskriterien');
  });

  test('Protokoll-Auszug: letzte 50 Einträge, auf Wunsch vollständig', async ({ page }) => {
    await openApp(page, null, { doc: tenCardDoc() });
    await openProcess(page);
    await page.evaluate(() => { for (let i = 0; i < 60; i++) { moveCard('t1', boardColumns()[(i + 1) % 2].id); } });
    const n = await page.evaluate(() => auditList().length);
    expect(n).toBeGreaterThan(50);
    const last = await page.evaluate(() => reportMarkdown({}));
    expect(last).toContain(`(letzte 50 von ${n} Einträgen)`);
    expect((last.match(/^\| \d\d\.\d\d\.\d\d/gm) || []).length).toBe(50);
    const all = await page.evaluate(() => reportMarkdown({ log: 'all' }));
    expect((all.match(/^\| \d\d\.\d\d\.\d\d/gm) || []).length).toBe(n);
  });

  test('Drucken / PDF: A4-Ansicht mit Diagrammen im Druckbereich, danach wieder aufgeräumt', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page, null, { doc: criteriaDoc() });
    await page.evaluate(() => { window.__printed = null; window.print = () => { window.__printed = document.getElementById('print-area').innerHTML; window.dispatchEvent(new Event('afterprint')); }; markNoticeSeen(); });
    await showView(page, 'kanban');
    await page.click('[data-ka="report"]');
    await page.click('[data-kd="report-print"]');
    await page.waitForFunction(() => window.__printed);
    const html = await page.evaluate(() => window.__printed);
    expect(html).toContain('class="rp"');
    expect(html).toContain('@page { size: A4');
    expect(html).toContain('Bericht: Testprojekt');
    expect(html).toContain('<polygon');                 // Cumulative Flow
    expect(html).toContain('class="kp-bar"');           // Durchsatz
    expect(html).toContain('Funktionierender Prototyp');
    expect(await page.evaluate(() => document.getElementById('print-area').innerHTML)).toBe('');
    expect(await page.evaluate(() => document.body.classList.contains('printing'))).toBe(false);
  });

  test('Desktop-Version: druckfertige HTML-Datei statt Druckdialog', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page, null, { doc: criteriaDoc(), query: '?desktop=1' });
    const dl = page.waitForEvent('download');
    await page.evaluate(() => printReport({}));
    const file = await dl;
    expect(file.suggestedFilename()).toBe('Testprojekt_bericht.html');
    const text = require('fs').readFileSync(await file.path(), 'utf8');
    expect(text).toMatch(/^<!DOCTYPE html>/);
    expect(text).toContain("default-src 'none'");      // die Datei lädt nichts nach
    expect(text).toContain('Als PDF sichern');
    expect(text).toContain('<polygon');
    await expect(page.locator('#modal-body')).toContainText('druckfertige HTML-Datei');
  });

  test('Menü Import/Export › Bericht öffnet den Dialog', async ({ page }) => {
    await openApp(page, null, { doc: sampleDoc() });
    await openProcess(page);
    await page.click('#btn-export');
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Bericht' }).click();
    await expect(page.locator('#kanban-box')).toContainText('Drucken / PDF');
    const dl = page.waitForEvent('download');
    await page.click('[data-kd="report-md"]');
    expect((await dl).suggestedFilename()).toBe('Testprojekt_bericht.md');
  });
});

test.describe('Gruppenübersicht', () => {
  function groupFile(title, opts) {
    const d = opts.base ? opts.base() : protocolDoc();
    d.doc.meta.m.title = title;
    if (opts.personalOff) d.doc.meta.m.kanbanPersonal = false;
    if (opts.who) for (const id in d.doc.events) d.doc.events[id].who = opts.who(d.doc.events[id]);
    return { name: title.replace(/\s+/g, '_') + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(d)) };
  }

  test('Mehrere Dateien laden und vergleichen – rein lokal, nichts wird gesendet', async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await openApp(page, null, { doc: sampleDoc() });
    const requests = [];
    page.on('request', r => requests.push(r.method() + ' ' + r.url()));
    await page.click('#btn-export');
    await page.locator('.ctx-menu .ctx-item', { hasText: 'Gruppenübersicht' }).click();
    await expect(page.locator('#groups-modal')).toBeVisible();
    await expect(page.locator('#groups-body')).toContainText('nur in diesem Browser');
    const chooser = page.waitForEvent('filechooser');
    await page.click('[data-gact="pick"]');
    // Gruppe 1: AB macht fast alles; Gruppe 2: ausgeglichen; Gruppe 3: ohne Personen; dazu eine kaputte Datei
    (await chooser).setFiles([
      groupFile('Gruppe Rot', { who: e => (e.type === 'task.moved' && e.task === 'E' ? 'CD' : 'AB') }),
      groupFile('Gruppe Blau', { who: e => (e.task && e.task < 'C' ? 'EF' : 'GH'), base: () => { const d = protocolDoc(); d.doc.nodes.D.status = 'done'; d.doc.nodes.D.columnId = 'kE'; return d; } }),
      groupFile('Gruppe Grün', { personalOff: true, who: () => null }),
      { name: 'kaputt.json', mimeType: 'application/json', buffer: Buffer.from('{ das ist kein json') },
    ]);
    const rows = page.locator('.gr-table tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('Gruppe Rot');
    await expect(rows.nth(0)).toContainText('4/5');
    await expect(rows.nth(0)).toContainText('⛔ 1 jetzt');
    await expect(rows.nth(0)).toContainText('1-mal');
    await expect(rows.nth(1)).toContainText('5/5');
    await expect(rows.nth(3)).toContainText('konnte nicht gelesen werden');
    // Beitragsanteile
    const rot = await page.evaluate(() => groups[0].s.persons.map(p => [p.name, Math.round(p.share * 100), p.doneCards]));
    expect(rot[0][0]).toBe('AB');
    // 16 Beiträge: 4× angelegt, 8× verschoben, 3× Blocker, 1× DoD – davon 3 Verschiebungen von E durch CD
    expect(rot.find(p => p[0] === 'CD')[1]).toBe(Math.round(3 / 16 * 100));
    await expect(page.locator('.gr-group').nth(2)).toContainText('ohne Personen');
    await expect(page.locator('#groups-body')).toContainText('kein Maß für Qualität');
    // Export als Markdown
    const dl = page.waitForEvent('download');
    await page.click('[data-gact="md"]');
    expect((await dl).suggestedFilename()).toBe('gruppenuebersicht.md');
    const md = await page.evaluate(() => groupsMarkdown());
    expect(md).toContain('| Gruppe Rot | 4/5 (80 %) |');
    // nichts wurde hochgeladen: keine POST-Anfragen, nur die eigene Herkunft
    expect(requests.filter(r => r.startsWith('POST'))).toEqual([]);
    expect(requests.filter(r => !r.includes('127.0.0.1') && !r.includes('blob:'))).toEqual([]);
    // das geöffnete Dokument bleibt unverändert
    expect(Object.keys((await getDoc(page)).nodes)).toEqual(Object.keys(sampleDoc().doc.nodes));
  });
});
