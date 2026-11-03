// Gemeinsames Bearbeiten: zwei Browser in einer Sitzung, gegen PHP und gegen Flask
const { test, expect } = require('@playwright/test');
const { PHP, FLASK, sampleDoc, openApp, getDoc } = require('./helpers');

/** Person A startet eine Sitzung, Person B tritt über den Bearbeiten-Link bei. */
async function twoInSession(browser, base) {
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  await openApp(a, base, { doc: sampleDoc() });
  await a.evaluate(() => localStorage.setItem('mm-name', 'AB'));
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
