// Bedienung per Touch (iPad-Maße, Touch-Ereignisse)
const { test, expect } = require('@playwright/test');
const { sampleDoc, openApp, getDoc, showView, center, touchDrag } = require('./helpers');

test('iPad: Kanban-Karte mit dem Finger ziehen ändert den Status', async ({ page }) => {
  await openApp(page, null, { doc: sampleDoc() });
  await showView(page, 'kanban');
  await touchDrag(page, await center(page.locator('[data-card="t1"]')), await center(page.locator('.kcol[data-col="doing"] header')));
  expect((await getDoc(page)).nodes.t1.status).toBe('doing');
});
