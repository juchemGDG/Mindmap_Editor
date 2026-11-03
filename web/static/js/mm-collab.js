'use strict';
// ════════════════════════════════════════════════════════════════════
// Mindmap Editor – gemeinsames Bearbeiten (nur Web-Version)
//
// Der Server (api/collab.php bzw. web/app.py) hält pro Sitzung ("Raum")
// den aktuellen Stand und eine fortlaufend nummerierte Liste der
// Operationen. Jeder Teilnehmer schickt regelmäßig eine sync-Anfrage:
//   → {action:'sync', room, key, client, since, ops, me}
//   ← {ver, ops:[{v, c, o}], peers:[…], now}       (oder reset:{doc, ver})
// Eigene Operationen kommen sofort lokal an (mm-core.js); fremde werden
// beim nächsten sync eingespielt. Felder, die man selbst gerade geändert
// hat und die noch unterwegs sind, gewinnen (der Server ordnet sie später
// ein, also stehen sie dort ohnehin am Ende).
//
// Der Link enthält ?room=… (ansehen) und &k=… (bearbeiten).
// ════════════════════════════════════════════════════════════════════

const COLLAB_URL = 'api/collab.php';
const PEER_COLORS = ['#2563eb', '#0f766e', '#b45309', '#9333ea', '#be185d', '#4d7c0f', '#c2410c', '#0369a1'];

let collab = null;    // {room, key, ver, queue, busy, timer, peers, fails}
let applyingRemote = false;

function collabActive() { return !!collab; }

function myColor() {
  let c = null;
  try { c = localStorage.getItem('mm-color'); } catch (e) { /* egal */ }
  if (!c || !PEER_COLORS.includes(c)) {
    c = PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)];
    try { localStorage.setItem('mm-color', c); } catch (e) { /* egal */ }
  }
  return c;
}

function collabAvailable() { return !EMBED && !DESKTOP && location.protocol.startsWith('http'); }

async function collabPost(body) {
  const r = await fetch(COLLAB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('Server antwortet mit ' + r.status);
  const data = await r.json();
  return data;
}

// ── Starten, Beitreten, Verlassen ───────────────────────────────────
async function startCollab() {
  if (collab) { showShare(); return; }
  if (!collabAvailable()) { showModal('Gemeinsam bearbeiten', 'Das gemeinsame Bearbeiten gibt es nur in der Web-Version auf dem Server.'); return; }
  if (!myName()) { hideShare(); askName(() => { showShare(); if (myName()) startCollab(); }); return; }
  if (editing) commitEdit();
  const btn = $('share-start');
  if (btn) { btn.disabled = true; btn.textContent = 'Starte …'; }
  try {
    const res = await collabPost({ action: 'create', doc: clone(doc) });
    if (res.error || !res.room) throw new Error(res.error || 'keine Sitzung erhalten');
    collab = { room: res.room, key: res.key, ver: res.ver || 0, queue: [], busy: false, peers: [], fails: 0, joined: true };
    serverOffset = (res.now || Date.now()) - Date.now();
    setRoomUrl();
    readOnly = false;
    applyRoomUi();
    scheduleSync(50);
    showShare();
    flashStatus('Gemeinsame Sitzung gestartet');
  } catch (err) {
    showModal('Gemeinsam bearbeiten', 'Die Sitzung konnte nicht gestartet werden.\n\n' + err.message +
      '\n\nLäuft die Seite auf einem Server mit PHP (api/collab.php) oder mit dem Flask-Backend?');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sitzung starten'; }
  }
}

function joinFromUrl() {
  const room = PARAMS.get('room');
  if (!room || !collabAvailable()) return false;
  const key = PARAMS.get('k') || '';
  collab = { room, key, ver: -1, queue: [], busy: false, peers: [], fails: 0 };
  readOnly = !key;
  applyRoomUi();
  const go = () => scheduleSync(0);
  if (!myName() && !readOnly) {
    askName(go);
  } else go();
  return true;
}

function askName(cb) {
  showPrompt('Gemeinsam bearbeiten', 'Dein Kürzel oder Spitzname – so sehen die anderen, wer gerade woran arbeitet (kein vollständiger Name nötig):', myName(), v => {
    if (v && v.trim()) { try { localStorage.setItem('mm-name', cleanName(v)); } catch (e) { /* egal */ } }
    if (cb) cb();
    collabSelectionChanged();
  });
}

function leaveRoom(ask) {
  if (!collab) return;
  if (ask && !confirm('Sitzung verlassen? Du behältst eine Kopie der Mindmap auf diesem Gerät.')) return;
  clearTimeout(collab.timer);
  collab = null;
  readOnly = false;
  remoteSel = [];
  history.replaceState(null, '', location.pathname);
  applyRoomUi();
  hideShare();
  scheduleAutosave();
  requestRender(true);
  flashStatus('Sitzung verlassen – du arbeitest jetzt allein weiter');
}
/**
 * Sitzung für alle beenden und die Daten sofort vom Server löschen.
 * Jedes Gerät behält seine Kopie (Zwischenspeicher im Browser) und kann speichern.
 */
async function endRoom() {
  if (!collab || !collab.key) return;
  if (!confirm('Sitzung für alle beenden und die Daten sofort vom Server löschen?\n\nAlle Beteiligten behalten eine Kopie auf ihrem Gerät. Speichere vorher, wenn du die Datei brauchst.')) return;
  const c = collab;
  try {
    const res = await collabPost({ action: 'close', room: c.room, key: c.key });
    if (res.error && res.error !== 'notfound') throw new Error(res.error);
  } catch (err) {
    showModal('Gemeinsam bearbeiten', 'Die Sitzung konnte nicht gelöscht werden: ' + err.message);
    return;
  }
  leaveRoomSilently();
  hideShare();
  scheduleAutosave();
  flashStatus('Sitzung beendet – die Daten sind vom Server gelöscht');
}

function leaveRoomSilently() {
  if (!collab) return;
  clearTimeout(collab.timer);
  collab = null;
  readOnly = false;
  remoteSel = [];
  history.replaceState(null, '', location.pathname);
  applyRoomUi();
}

function roomUrl(edit) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('room', collab.room);
  if (edit && collab.key) u.searchParams.set('k', collab.key);
  return u.toString();
}
function setRoomUrl() { history.replaceState(null, '', roomUrl(true).replace(location.origin, '')); }

// ── Synchronisieren ─────────────────────────────────────────────────
function scheduleSync(ms) {
  if (!collab) return;
  clearTimeout(collab.timer);
  collab.timer = setTimeout(syncNow, ms);
}

function opFields(op) {
  const out = [];
  if (op.set) for (const f in op.set) out.push(op.c + '|' + op.id + '|' + f);
  else out.push(op.c + '|' + op.id + '|*');
  return out;
}

async function syncNow() {
  if (!collab || collab.busy) return;
  const c = collab;
  c.busy = true;
  const sending = c.key ? c.queue.splice(0) : [];
  if (!c.key) c.queue = [];
  let ok = false;
  try {
    const res = await collabPost({
      action: 'sync', room: c.room, key: c.key || '', client: myId(), since: c.ver, ops: sending,
      me: { name: myName() || 'Gast', color: myColor(), sel: [...sel].slice(0, 8), view: currentView, ro: readOnly },
    });
    if (collab !== c) return;
    if (res.error === 'notfound') {
      collab = null; readOnly = false; applyRoomUi();
      history.replaceState(null, '', location.pathname);
      if (c.joined) {
        scheduleAutosave();
        showModal('Gemeinsam bearbeiten', 'Die Sitzung wurde beendet bzw. ist abgelaufen und die Daten wurden vom Server gelöscht. Du arbeitest jetzt allein mit deiner Kopie weiter – zum Aufheben „Speichern“.');
        return;
      }
      // alter Link: gibt es auf diesem Gerät noch eine Kopie dieser Sitzung?
      const copy = sessionCopy();
      if (copy && copy.room === c.room && copy.payload &&
          confirm(`Diese Sitzung gibt es nicht mehr (Sitzungen werden 24 Stunden nach der letzten Nutzung gelöscht).\n\nAuf diesem Gerät gibt es eine Kopie vom ${new Date(copy.savedAt).toLocaleString('de-DE')}. Kopie öffnen?`)) {
        replaceDoc(copy.payload);
        afterDocLoaded();
        flashStatus('Kopie der Sitzung geöffnet – zum Aufheben „Speichern“');
        return;
      }
      if (!restoreAutosave()) replaceDoc(templateDoc(TEMPLATES[0]));
      afterDocLoaded();
      showModal('Gemeinsam bearbeiten', 'Diese Sitzung gibt es nicht (mehr). Vielleicht ist der Link unvollständig oder die Sitzung wurde gelöscht (nach 24 Stunden ohne Nutzung).');
      return;
    }
    if (res.error === 'readonly') {
      readOnly = true; c.key = ''; applyRoomUi();
      showModal('Gemeinsam bearbeiten', 'Mit diesem Link kannst du nur ansehen, nicht bearbeiten.');
      return;
    }
    if (res.error) throw new Error(res.error);
    if (typeof res.now === 'number') serverOffset = res.now - Date.now();
    receive(res, sending);
    c.fails = 0;
    ok = true;
    setConnState('ok');
  } catch (err) {
    if (collab !== c) return;
    // zurück in die Warteschlange, gleich nochmal versuchen
    c.queue = sending.concat(c.queue);
    c.fails++;
    setConnState('offline');
  } finally {
    c.busy = false;
    if (collab === c) {
      const hidden = document.visibilityState === 'hidden';
      const base = c.queue.length ? 60 : hidden ? 4000 : (c.peers.length ? 1000 : 1800);
      scheduleSync(ok ? base : Math.min(15000, 1000 * Math.pow(1.6, c.fails)));
    }
  }
}

function receive(res, sending) {
  const c = collab;
  if (res.reset) {
    // kompletter Stand vom Server (beim Beitreten oder nach langer Pause)
    applyingRemote = true; suppressOps = true;
    try {
      doc = normalizeDoc(res.reset.doc);
      invalidate();
      for (const op of c.queue) applyOp(doc, op);   // eigene, noch nicht gesendete Änderungen
      invalidate();
    } finally { applyingRemote = false; suppressOps = false; }
    c.ver = res.reset.ver;
    const first = !c.joined;
    c.joined = true;
    notifyChange({ remote: true, reset: true });
    if (first) { needLayout = true; layoutMap(); needLayout = false; fitView(false); applyMetaUi(); }
  }
  const remote = (res.ops || []).filter(o => o.c !== myId());
  if (remote.length) {
    const mine = new Set();
    for (const op of sending.concat(c.queue)) for (const f of opFields(op)) mine.add(f);
    applyingRemote = true; suppressOps = true;
    try {
      for (const r of remote) {
        const op = r.o;
        if (!op || !COLLECTIONS.includes(op.c)) continue;
        if (op.set) {
          const set = {};
          let any = false;
          for (const f in op.set) if (!mine.has(op.c + '|' + op.id + '|' + f)) { set[f] = op.set[f]; any = true; }
          if (any) applyOp(doc, { c: op.c, id: op.id, set });
        } else if (op.put) {
          if (!mine.has(op.c + '|' + op.id + '|*')) applyOp(doc, op);
        } else applyOp(doc, op);
      }
    } finally { applyingRemote = false; suppressOps = false; }
    invalidate();
    notifyChange({ remote: true });
  }
  if (typeof res.ver === 'number') c.ver = res.ver;
  c.peers = (res.peers || []).filter(p => p.client !== myId());
  updatePeers();
}

// eigene Änderungen einsammeln
onLocalOps(ops => {
  if (!collab || applyingRemote || readOnly) return;
  collab.queue.push(...ops);
  scheduleSync(collab.busy ? 120 : 60);
});

let selSyncTimer = null;
function collabSelectionChanged() {
  if (!collab) return;
  clearTimeout(selSyncTimer);
  selSyncTimer = setTimeout(() => scheduleSync(0), 250);
}

document.addEventListener('visibilitychange', () => { if (collab && document.visibilityState === 'visible') scheduleSync(0); });

// ── Anzeige: Teilnehmende, Verbindung ───────────────────────────────
function updatePeers() {
  const host = $('peers');
  if (!host) return;
  if (!collab) { host.innerHTML = ''; remoteSel = []; return; }
  const me = { name: myName() || 'Ich', color: myColor(), me: true };
  const list = [me, ...collab.peers];
  host.innerHTML = list.slice(0, 8).map(p => `<span class="peer${p.me ? ' me' : ''}${p.ro ? ' ro' : ''}" style="--pc:${esc(p.color || '#64748b')}" title="${esc((p.name || 'Gast') + (p.me ? ' (du)' : '') + (p.ro ? ' – schaut zu' : ''))}">${esc(initials(p.name || 'Gast') || '?')}</span>`).join('')
    + (list.length > 8 ? `<span class="peer more">+${list.length - 8}</span>` : '');
  remoteSel = [];
  for (const p of collab.peers) for (const id of p.sel || []) if (doc.nodes[id]) remoteSel.push({ id, color: p.color || '#64748b', name: p.name || 'Gast' });
  requestRender();
  const pl = $('share-peers');
  if (pl) pl.innerHTML = list.map(p => `<li><span class="peer" style="--pc:${esc(p.color || '#64748b')}">${esc(initials(p.name || 'Gast') || '?')}</span>${esc(p.name || 'Gast')}${p.me ? ' (du)' : ''}${p.ro ? ' – schaut zu' : ''}</li>`).join('');
}

function setConnState(s) {
  const el = $('conn-state');
  if (!el) return;
  el.className = 'conn ' + s;
  el.title = s === 'ok' ? 'Verbunden' : 'Keine Verbindung – Änderungen werden nachgeschickt';
}

function applyRoomUi() {
  document.body.classList.toggle('in-room', !!collab);
  document.body.classList.toggle('readonly', readOnly);
  const btn = $('btn-share');
  if (btn) btn.classList.toggle('active', !!collab);
  const lab = $('btn-share-label');
  if (lab) lab.textContent = collab ? 'Sitzung' : 'Gemeinsam';
  updatePeers();
  updateInspector();
  if (currentView !== 'map') renderCurrentView();
  updateStatus();
}

// ── Teilen-Dialog ───────────────────────────────────────────────────
function showShare() {
  const box = $('share-modal');
  if (!box) return;
  $('share-intro').style.display = collab ? 'none' : '';
  $('share-active').style.display = collab ? '' : 'none';
  if (collab) {
    const edit = collab.key ? roomUrl(true) : null;
    const viewU = roomUrl(false);
    $('share-edit-row').style.display = edit ? '' : 'none';
    if (edit) { $('share-edit-url').value = edit; drawQr('share-edit-qr', edit); }
    $('share-view-url').value = viewU; drawQr('share-view-qr', viewU);
    updatePeers();
  }
  box.style.display = 'flex';
}
function hideShare() { const b = $('share-modal'); if (b) b.style.display = 'none'; }

function drawQr(elId, text) {
  const el = $(elId);
  if (!el) return;
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  } catch (e) { el.textContent = ''; }
}

function copyField(id) {
  const inp = $(id);
  if (!inp) return;
  inp.select();
  const ok = () => flashStatus('Link kopiert');
  if (navigator.clipboard) navigator.clipboard.writeText(inp.value).then(ok, () => { document.execCommand('copy'); ok(); });
  else { document.execCommand('copy'); ok(); }
}

function showQrBig(url) {
  const box = $('qr-big');
  if (!box) return;
  drawQr('qr-big-code', url);
  $('qr-big-url').textContent = url.replace(/^https?:\/\//, '');
  box.style.display = 'flex';
}
