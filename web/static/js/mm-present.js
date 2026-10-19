'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – Präsentationsmodus
//
// Die Mindmap wird Schritt für Schritt aufgebaut: erst das Zentralthema,
// dann Ast für Ast (oder Punkt für Punkt). Die Kamera fährt jeweils auf
// den neuen Teil. Beim gemeinsamen Bearbeiten kann man die Präsentation
// "live für alle" zeigen; die anderen können zuschauen und folgen.
// ════════════════════════════════════════════════════════════════════

let presentState = null;   // {mode, steps, i, canvas, ctx, view, live, follow}
let liveDismissed = null;

function buildPresentSteps(mode) {
  presentAll = true;
  invalidate();
  layoutMap(); needLayout = false;
  const rid = index().rid;
  // Hauptäste im Uhrzeigersinn: rechte Seite oben→unten, dann linke Seite unten→oben
  let mains = kids(rid).slice();
  if (M().layout === 'map') {
    const r = mains.filter(c => LAY[c] && LAY[c].side !== 'L');
    const l = mains.filter(c => LAY[c] && LAY[c].side === 'L').reverse();
    mains = r.concat(l);
  }
  const steps = [];
  const shown = new Set([rid]);
  steps.push({ only: new Set(shown), focus: [rid], cur: rid });
  for (const m of mains) {
    if (mode === 'node') {
      const walk = id => {
        shown.add(id);
        steps.push({ only: new Set(shown), focus: [parentOf(id), id], cur: id, branch: m });
        for (const c of kids(id)) walk(c);
      };
      walk(m);
    } else {
      for (const d of descendants(m, true)) shown.add(d);
      steps.push({ only: new Set(shown), focus: [rid, ...descendants(m, true)], cur: m, branch: m });
    }
  }
  steps.push({ only: new Set(shown), focus: null, cur: null, overview: true });
  return steps;
}

function startPresentation(opts) {
  if (editing) commitEdit();
  opts = opts || {};
  const box = $('present');
  if (!box) return;
  const mode = opts.mode || (presentState && presentState.mode) || 'branch';
  box.style.display = 'flex';
  document.body.classList.add('presenting');
  const cv = $('present-canvas');
  presentState = {
    mode, steps: buildPresentSteps(mode), i: opts.step || 0,
    canvas: cv, ctx: cv.getContext('2d'), view: { x: 0, y: 0, z: 1 },
    live: false, follow: !!opts.follow,
  };
  $('present-mode').value = mode;
  $('present-live-wrap').style.display = collab && !readOnly && !opts.follow ? '' : 'none';
  $('present-live').checked = false;
  $('present-follow-note').style.display = opts.follow ? '' : 'none';
  sizePresentCanvas();
  presentGo(presentState.i, false);
  hideLiveBanner();
}

function stopPresentation() {
  if (!presentState) return;
  if (presentState.live) setLive(false);
  if (presentState.follow) liveDismissed = M().live ? M().live.t : null;
  presentState = null;
  presentAll = false;
  invalidate();
  needLayout = true;
  $('present').style.display = 'none';
  document.body.classList.remove('presenting');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  requestRender(true);
}

function sizePresentCanvas() {
  const cv = presentState.canvas;
  const r = cv.parentElement.getBoundingClientRect();
  cv.width = Math.round(r.width * DPR); cv.height = Math.round(r.height * DPR);
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
}

function stepBounds(step) {
  const ids = step.focus || [...step.only];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) {
    const L = LAY[id];
    if (!L) continue;
    x0 = Math.min(x0, L.x - L.w / 2); x1 = Math.max(x1, L.x + L.w / 2);
    y0 = Math.min(y0, L.y - L.h / 2); y1 = Math.max(y1, L.y + L.h / 2);
  }
  if (x0 === Infinity) return LAY_BOUNDS;
  return { x0, y0, x1, y1 };
}

let presentAnim = null;
function presentGo(i, animate) {
  const ps = presentState;
  if (!ps) return;
  i = Math.max(0, Math.min(ps.steps.length - 1, i));
  ps.i = i;
  const step = ps.steps[i];
  const r = ps.canvas.getBoundingClientRect();
  const capH = $('present-caption').offsetHeight || 0;
  const target = fitRect(stepBounds(step), r.width, r.height - 70 - capH, 80, step.overview ? 1.3 : 1.5);
  target.y -= 10;
  cancelAnimationFrame(presentAnim);
  if (animate === false) { ps.view = target; renderPresentation(); }
  else {
    const from = { ...ps.view };
    const t0 = performance.now();
    const tick = now => {
      if (presentState !== ps) return;
      const k = Math.min(1, (now - t0) / 480);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      ps.view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, z: from.z + (target.z - from.z) * e };
      ps.fade = k;
      renderPresentation();
      if (k < 1) presentAnim = requestAnimationFrame(tick);
    };
    presentAnim = requestAnimationFrame(tick);
  }
  $('present-count').textContent = `${i + 1} / ${ps.steps.length}`;
  // Beschriftung unten: aktueller Punkt und seine Notiz
  const cap = $('present-caption');
  const cur = step.cur && doc.nodes[step.cur];
  if (cur && (cur.note || '').trim() && $('present-notes').checked) {
    cap.style.display = '';
    cap.innerHTML = `<b>${esc(label(step.cur))}</b><p>${esc(cur.note)}</p>`;
  } else { cap.style.display = 'none'; cap.innerHTML = ''; }
  if (ps.live) pushLive();
}

function renderPresentation() {
  const ps = presentState;
  if (!ps) return;
  if (needLayout) { layoutMap(); needLayout = false; }
  const c = ps.ctx, t = T();
  const w = ps.canvas.width / DPR, h = ps.canvas.height / DPR;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.fillStyle = t.bg; c.fillRect(0, 0, w, h);
  c.setTransform(DPR * ps.view.z, 0, 0, DPR * ps.view.z, DPR * ps.view.x, DPR * ps.view.y);
  const step = ps.steps[ps.i];
  // ältere Äste abblenden, damit der neue im Blick ist
  let dim = null;
  if (step.branch && ps.mode === 'branch') {
    dim = new Set();
    for (const id of step.only) if (!isRoot(id) && branchOf(id) !== step.branch) dim.add(id);
  } else if (step.branch && ps.mode === 'node') {
    dim = new Set();
    for (const id of step.only) if (!isRoot(id) && branchOf(id) !== step.branch) dim.add(id);
  }
  drawMap(canvasPainter(c), { noUi: true, only: step.only, dim, sel: step.cur && !step.overview && ps.mode === 'node' ? new Set([step.cur]) : null });
}

function presentNext() { if (presentState && !presentState.follow) presentGo(presentState.i + 1); }
function presentPrev() { if (presentState && !presentState.follow) presentGo(presentState.i - 1); }

function presentKey(e) {
  if (!presentState) return false;
  const k = e.key;
  if (k === 'Escape') { stopPresentation(); return true; }
  if (presentState.follow) return k !== 'f' && k !== 'F' ? true : (toggleFullscreen(), true);
  if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter') { presentNext(); return true; }
  if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') { presentPrev(); return true; }
  if (k === 'Home') { presentGo(0); return true; }
  if (k === 'End') { presentGo(presentState.steps.length - 1); return true; }
  if (k === 'f' || k === 'F') { toggleFullscreen(); return true; }
  return true;   // andere Tasten nicht an die Mindmap weitergeben
}

function toggleFullscreen() {
  const el = $('present');
  if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); }
  else document.exitFullscreen().catch(() => {});
}

function bindPresentation() {
  const box = $('present');
  if (!box) return;
  on('present-next', 'click', presentNext);
  on('present-prev', 'click', presentPrev);
  on('present-close', 'click', stopPresentation);
  on('present-full', 'click', toggleFullscreen);
  on('present-mode', 'change', e => {
    if (!presentState) return;
    const cur = presentState.steps[presentState.i];
    startPresentation({ mode: e.target.value });
    // ungefähr an der gleichen Stelle weitermachen
    if (cur && cur.branch) {
      const j = presentState.steps.findIndex(s => s.branch === cur.branch);
      if (j > 0) presentGo(j, false);
    }
  });
  on('present-notes', 'change', () => presentState && presentGo(presentState.i, false));
  on('present-live', 'change', e => setLive(e.target.checked));
  const cv = $('present-canvas');
  let sx = null;
  cv.addEventListener('pointerdown', e => { sx = e.clientX; });
  cv.addEventListener('pointerup', e => {
    if (sx == null) return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) > 50) { if (dx < 0) presentNext(); else presentPrev(); }
    else if (e.pointerType === 'mouse' || Math.abs(dx) < 10) presentNext();
  });
  window.addEventListener('resize', () => { if (presentState) { sizePresentCanvas(); presentGo(presentState.i, false); } });
  document.addEventListener('fullscreenchange', () => { if (presentState) setTimeout(() => { sizePresentCanvas(); presentGo(presentState.i, false); }, 80); });
}

// ── Live für alle (gemeinsames Bearbeiten) ──────────────────────────
function setLive(on) {
  if (!presentState) return;
  presentState.live = on && !!collab && !readOnly;
  if (presentState.live) pushLive();
  else mutate('Präsentation', () => { delete M().live; }, { noUndo: true });
}
function pushLive() {
  const ps = presentState;
  mutate('Präsentation', () => { M().live = { by: myId(), name: myName() || 'Jemand', step: ps.i, mode: ps.mode, t: M().live && M().live.by === myId() ? M().live.t : Date.now() }; }, { noUndo: true });
}

/** Wird bei jeder Änderung aufgerufen: Live-Präsentation anderer anzeigen bzw. folgen. */
function checkLive() {
  const live = M().live;
  if (presentState && presentState.follow) {
    if (!live) { stopPresentation(); flashStatus('Die Präsentation wurde beendet'); return; }
    if (live.mode !== presentState.mode) startPresentation({ mode: live.mode, step: live.step, follow: true });
    else if (live.step !== presentState.i) presentGo(live.step);
    return;
  }
  if (live && live.by !== myId() && !presentState && liveDismissed !== live.t) showLiveBanner(live);
  else hideLiveBanner();
}
function showLiveBanner(live) {
  const b = $('live-banner');
  if (!b) return;
  b.querySelector('span').textContent = `${live.name} präsentiert gerade.`;
  b.style.display = 'flex';
}
function hideLiveBanner() { const b = $('live-banner'); if (b) b.style.display = 'none'; }
function followLive() {
  const live = M().live;
  if (!live) return;
  startPresentation({ mode: live.mode, step: live.step, follow: true });
}
