// Gemeinsame Hilfen für die Browsertests
const { expect } = require('@playwright/test');

const STATIC = 'http://127.0.0.1:4310';
const PHP = 'http://127.0.0.1:4311';
const FLASK = 'http://127.0.0.1:4312';

/** Kleine Beispiel-Mindmap mit Aufgaben in allen Status und einer Idee. */
function sampleDoc() {
  const n = (id, parent, order, text, extra) => Object.assign({ id, parent, order, text }, extra || {});
  return {
    format: 'mindmap-editor', version: 1,
    doc: {
      meta: { m: { id: 'm', title: 'Testprojekt', layout: 'map', lineStyle: 'curve', branchColors: 'muted', phase: 'plan', planMode: 'simple', voteLimit: 3, disabledRules: [] } },
      nodes: {
        root: n('root', null, 0, 'Projekt'),
        b1: n('b1', 'root', 1, 'Bau'),
        b2: n('b2', 'root', 2, 'Doku'),
        t1: n('t1', 'b1', 1, 'Gehäuse sägen', { task: true, status: 'todo', owner: 'AB', due: '2026-01-10' }),
        t2: n('t2', 'b1', 2, 'Platine löten', { task: true, status: 'doing', owner: 'CD', prio: 1 }),
        t3: n('t3', 'b2', 1, 'Bericht schreiben', { task: true, status: 'done', owner: 'AB' }),
        i1: n('i1', 'b2', 2, 'Video drehen?'),
      },
      links: {}, votes: {},
    },
  };
}

/** App öffnen und warten, bis sie bereit ist. Sammelt Skriptfehler in page.errors. */
async function openApp(page, base, opts) {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.goto((base || STATIC) + '/index.html' + ((opts && opts.query) || ''));
  await page.waitForFunction(() => typeof doc === 'object' && document.getElementById('main-canvas').width > 0);
  if (opts && opts.doc) await loadDoc(page, opts.doc);
}

async function loadDoc(page, d) {
  await page.evaluate(d => { replaceDoc(d); afterDocLoaded(); }, d);
}

async function getDoc(page) { return page.evaluate(() => clone(doc)); }

async function showView(page, v) {
  await page.click(`[data-view-tab="${v}"]`);
  await expect(page.locator(`#${v}-view`)).toBeVisible();
}

/** Mittelpunkt eines Elements auf dem Bildschirm. */
async function center(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Mit der Maus von A nach B ziehen (mit Zwischenschritten, damit die Ziehen-Schwelle greift). */
async function mouseDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
  await page.mouse.up();
}

/** Mit dem Finger ziehen (echte Touch-Ereignisse über das Chrome-Protokoll). */
async function touchDrag(page, from, to) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Kurz mit dem Finger tippen. */
async function touchTap(page, at) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

module.exports = { STATIC, PHP, FLASK, sampleDoc, openApp, loadDoc, getDoc, showView, center, mouseDrag, touchDrag, touchTap };
