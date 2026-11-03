// Gemeinsames Bearbeiten: zwei Browser in einer Sitzung, gegen PHP und gegen Flask
const { test, expect } = require('@playwright/test');
const { PHP, FLASK, sampleDoc, tenCardDoc, openApp, getDoc } = require('./helpers');

/** Person A startet eine Sitzung, Person B tritt über den Bearbeiten-Link bei. */
async function twoInSession(browser, base, opts) {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  await openApp(a, base, { doc: (opts && opts.doc) || sampleDoc() });
  await a.evaluate(() => localStorage.setItem('mm-name', 'AB'));
  if (opts && opts.process) await a.evaluate(() => { setKanbanMode('process'); markNoticeSeen(); });
  await a.evaluate(() => startCollab());
  await a.waitForFunction(() => collab && collab.room);
  const url = await a.evaluate(() => roomUrl(true));
  await b.addInitScript(() => localStorage.setItem('mm-name', 'CD'));
  b.errors = [];
  await b.goto(url);
  await b.waitForFunction(() => collab && collab.joined);
  return { a, b, close: async () => { await ctxA.close(); await ctxB.close(); } };
}

for (const [name, base] of [['PHP', PHP], ['Flask', FLASK]]) {
  test(`Zusammenarbeit (${name}): beide sehen dieselben Änderungen`, async ({ browser }) => {
    const s = await twoInSession(browser, base);
    try {
      await expect.poll(async () => (await getDoc(s.b)).nodes.t1 && (await getDoc(s.b)).nodes.t1.text).toBe('Gehäuse sägen');
      await s.a.evaluate(() => mutate('Status', () => { doc.nodes.t1.status = 'doing'; }));
      await expect.poll(async () => (await getDoc(s.b)).nodes.t1.status, { timeout: 8000 }).toBe('doing');
      await s.b.evaluate(() => mutate('Text', () => { doc.nodes.t2.text = 'Platine bestücken'; }));
      await expect.poll(async () => (await getDoc(s.a)).nodes.t2.text, { timeout: 8000 }).toBe('Platine bestücken');
    } finally { await s.close(); }
  });

  test(`Zusammenarbeit (${name}): Prozess-Board – beide sehen dieselben Spalten und dasselbe Protokoll`, async ({ browser }) => {
    const s = await twoInSession(browser, base, { process: true, doc: tenCardDoc() });
    const evIds = p => p.evaluate(() => Object.keys(doc.events).sort());
    try {
      expect(await s.b.evaluate(() => kanbanProcess())).toBe(true);
      expect(await s.b.evaluate(() => boardColumns().map(c => c.title))).toEqual(['Backlog', 'Geplant', 'In Arbeit', 'Review', 'Erledigt']);
      // B verschiebt, A sieht Spalte, Status und den Protokolleintrag mit B als Person
      await s.b.evaluate(() => moveCard('t1', boardColumns()[3].id));
      await expect.poll(async () => (await getDoc(s.a)).nodes.t1.status, { timeout: 8000 }).toBe('doing');
      expect(await s.a.evaluate(() => doc.columns[doc.nodes.t1.columnId].title)).toBe('Review');
      await expect.poll(() => s.a.evaluate(() => auditList().some(e => e.type === 'task.moved' && e.task === 't1' && e.who === 'CD')), { timeout: 8000 }).toBe(true);
      // gleichzeitig: beide verschieben verschiedene Karten (je 5 Mal) – kein Eintrag darf fehlen oder doppelt sein
      await Promise.all([
        // A: x0…x4 abwechselnd nach „Geplant“ bzw. „In Arbeit“; B: fünf andere Karten nach „Geplant“
        s.a.evaluate(() => { ['x0', 'x1', 'x2', 'x3', 'x4'].forEach((id, i) => moveCard(id, boardColumns()[id === 'x2' ? 1 : 1 + (i % 2)].id)); }),
        s.b.evaluate(() => { ['x5', 'x6', 't2', 't3', 't1'].forEach(id => moveCard(id, boardColumns()[1].id)); }),
      ]);
      await expect.poll(async () => JSON.stringify(await evIds(s.a)) === JSON.stringify(await evIds(s.b)), { timeout: 10000 }).toBe(true);
      const ev = await s.a.evaluate(() => auditList());
      expect(new Set(ev.map(e => e.id)).size).toBe(ev.length);
      expect(ev.filter(e => e.who === 'AB' && e.type === 'task.moved').length).toBeGreaterThanOrEqual(5);
      expect(ev.filter(e => e.who === 'CD' && e.type === 'task.moved').length).toBeGreaterThanOrEqual(5);
      // ein dritter Browser bekommt beim Beitreten denselben Stand vom Server
      const ctx = await browser.newContext();
      const c = await ctx.newPage();
      await c.goto(await s.a.evaluate(() => roomUrl(false)));
      await c.waitForFunction(() => collab && collab.joined);
      expect(await evIds(c)).toEqual(await evIds(s.a));
      await ctx.close();
    } finally { await s.close(); }
  });

  test(`Zusammenarbeit (${name}): Server lässt Protokolleinträge nur anhängen (nicht löschen, nicht doppeln)`, async ({ browser }) => {
    const s = await twoInSession(browser, base, { process: true });
    try {
      await s.a.evaluate(() => moveCard('t1', boardColumns()[1].id));
      await expect.poll(() => s.b.evaluate(() => Object.keys(doc.events).length), { timeout: 8000 }).toBeGreaterThan(1);
      const res = await s.b.evaluate(async () => {
        const id = Object.keys(doc.events)[0];
        const ev = doc.events[id];
        const r = await collabPost({ action: 'sync', room: collab.room, key: collab.key, client: 'x', since: collab.ver, me: {},
          ops: [{ c: 'events', id, del: 1 }, { c: 'events', id, set: { who: 'gefälscht' } }, { c: 'events', id, put: Object.assign({}, ev, { who: 'gefälscht' }) }] });
        return { id, ops: (r.ops || []).filter(o => o.o.c === 'events' && o.o.id === id).length };
      });
      expect(res.ops).toBe(0);    // nichts davon wurde angenommen
      const ctx = await browser.newContext();
      const c = await ctx.newPage();
      await c.goto(await s.a.evaluate(() => roomUrl(false)));
      await c.waitForFunction(() => collab && collab.joined);
      const e = await c.evaluate(id => doc.events[id], res.id);
      expect(e).toBeTruthy();
      expect(e.who).not.toBe('gefälscht');
      await ctx.close();
    } finally { await s.close(); }
  });

  test(`Zusammenarbeit (${name}): Retrospektive – beide schreiben gleichzeitig an verschiedenen Fragen`, async ({ browser }) => {
    const s = await twoInSession(browser, base, { process: true });
    try {
      const id = await s.a.evaluate(() => createRetro());
      await expect.poll(() => s.b.evaluate(id => !!doc.retros[id], id), { timeout: 8000 }).toBe(true);
      await Promise.all([
        s.a.evaluate(id => mutate('Retro', () => { doc.retros[id].q1 = 'Gut: Zusammenarbeit'; }), id),
        s.b.evaluate(id => mutate('Retro', () => { doc.retros[id].q3 = 'Ändern: kleinere Karten'; }), id),
      ]);
      for (const p of [s.a, s.b]) {
        await expect.poll(() => p.evaluate(id => [doc.retros[id].q1, doc.retros[id].q3].join(' | '), id), { timeout: 8000 })
          .toBe('Gut: Zusammenarbeit | Ändern: kleinere Karten');
      }
    } finally { await s.close(); }
  });

  test(`Zusammenarbeit (${name}): Nur-Ansehen-Link kann nichts ändern`, async ({ browser }) => {
    const s = await twoInSession(browser, base);
    try {
      const viewUrl = await s.a.evaluate(() => roomUrl(false));
      const ctx = await browser.newContext();
      const v = await ctx.newPage();
      await v.goto(viewUrl);
      await v.waitForFunction(() => collab && collab.joined);
      expect(await v.evaluate(() => readOnly)).toBe(true);
      expect(await v.evaluate(() => mutate('x', () => { doc.nodes.t1.text = 'kaputt'; }))).toBe(false);
      await ctx.close();
    } finally { await s.close(); }
  });
}
