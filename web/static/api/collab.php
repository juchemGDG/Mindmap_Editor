<?php
/**
 * Mindmap Editor – gemeinsames Bearbeiten (PHP-Variante)
 *
 * Läuft auf normalem Webspace mit PHP ≥ 7.4 (z. B. Plesk/Bitpalast), ohne
 * Datenbank. Dasselbe Protokoll wie /api/collab.php im Flask-Backend
 * (web/app.py) – die Web-App merkt keinen Unterschied.
 *
 *   POST {action:'create', doc}                       → {room, key, ver, now}
 *   POST {action:'sync', room, key, client, since, ops, me}
 *        → {ver, ops:[{v, c, o}], peers:[…], now}  oder  {…, reset:{doc, ver}}
 *        → {error:'notfound'} / {error:'readonly'}
 *   POST {action:'close', room, key}                  → {ok:true}  (Sitzung sofort löschen)
 *
 * Ablage: ein Ordner mit je einer Datei pro Sitzung. Standard ist ./data
 * (per .htaccess gesperrt). Besser außerhalb des Web-Verzeichnisses, z. B.
 * per Umgebungsvariable MINDMAP_DATA_DIR oder in config.php:
 *     <?php define('MINDMAP_DATA_DIR', '/var/www/vhosts/…/private/mindmap');
 *
 * Datenschutz: Sitzungen ohne Nutzung werden nach ROOM_TTL_HOURS (Standard 24)
 * gelöscht – einstellbar per MINDMAP_ROOM_TTL_HOURS (config.php oder Umgebung).
 * Keine Datenbank, keine Cookies, keine dauerhafte Ablage.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

if (is_file(__DIR__ . '/config.php')) require __DIR__ . '/config.php';

const KEEP_OPS      = 3000;               // Operationen, die für Nachzügler bleiben
const PEER_TTL      = 15;                 // Sekunden bis jemand als "weg" gilt
const MAX_BODY      = 6 * 1024 * 1024;
const COLLECTIONS   = ['meta', 'nodes', 'links', 'votes', 'columns', 'members', 'events', 'retros'];
const ALPHABET      = 'abcdefghjkmnpqrstuvwxyz23456789';
const ROOM_LEN      = 22;                 // ≈ 109 Bit Zufall: nicht zu erraten
const CLEANUP_EVERY = 600;                // Sekunden zwischen zwei Aufräum-Läufen

$dataDir = defined('MINDMAP_DATA_DIR') ? MINDMAP_DATA_DIR : (getenv('MINDMAP_DATA_DIR') ?: __DIR__ . '/data');
$ttlHours = defined('MINDMAP_ROOM_TTL_HOURS') ? (float) MINDMAP_ROOM_TTL_HOURS : (float) (getenv('MINDMAP_ROOM_TTL_HOURS') ?: 24);

function answer($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function now_ms(): int { return (int) round(microtime(true) * 1000); }

if ($_SERVER['REQUEST_METHOD'] !== 'POST') answer(['error' => 'nur POST'], 405);
$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) answer(['error' => 'Anfrage zu groß'], 413);
// Objekte bleiben Objekte ({} ≠ []), sonst würden leere Sammlungen zu Listen
$body = json_decode($raw, false);
if (!is_object($body)) answer(['error' => 'ungültige Anfrage'], 400);

if (!is_dir($dataDir) && !@mkdir($dataDir, 0770, true)) answer(['error' => 'Ablageordner fehlt / nicht beschreibbar'], 500);
if (!is_file($dataDir . '/.htaccess')) @file_put_contents($dataDir . '/.htaccess', "Require all denied\nDeny from all\n");

function room_file(string $dir, string $room): string { return $dir . '/' . $room . '.json'; }
function peers_file(string $dir, string $room): string { return $dir . '/' . $room . '.peers.json'; }

function valid_op($op): bool {
    if (!is_object($op) || !isset($op->c) || !in_array($op->c, COLLECTIONS, true)) return false;
    if (!isset($op->id) || !is_string($op->id) || $op->id === '' || strlen($op->id) > 80) return false;
    $n = (int) isset($op->put) + (int) isset($op->del) + (int) isset($op->set);
    if ($n !== 1) return false;
    if (isset($op->put) && !is_object($op->put)) return false;
    if (isset($op->set) && !is_object($op->set)) return false;
    // Protokoll: nur anhängen – Einträge dürfen nicht geändert oder gelöscht werden
    if ($op->c === 'events' && !isset($op->put)) return false;
    return true;
}

function apply_op(object $doc, object $op): void {
    $c = $op->c; $id = $op->id;
    if (!isset($doc->$c) || !is_object($doc->$c)) $doc->$c = new stdClass();
    $col = $doc->$c;
    if (isset($op->put)) {
        if ($c === 'events' && isset($col->$id)) return;      // schon vorhanden: nicht überschreiben
        $col->$id = $op->put;
        return;
    }
    if (isset($op->del)) { unset($col->$id); return; }
    if (!isset($col->$id) || !is_object($col->$id)) return;   // inzwischen gelöscht
    foreach ($op->set as $f => $v) {
        if ($v === null) unset($col->$id->$f); else $col->$id->$f = $v;
    }
}

/** Sitzungen löschen, die länger als die eingestellte Zeit niemand benutzt hat. */
function cleanup(string $dir, float $ttlHours): void {
    $limit = time() - (int) round($ttlHours * 3600);
    foreach (glob($dir . '/*.json') ?: [] as $f) {
        if (substr($f, -11) === '.peers.json') continue;
        $peers = substr($f, 0, -5) . '.peers.json';
        // „benutzt“ = geändert (Raumdatei) oder jemand war da (Anwesenheitsdatei)
        $last = max((int) @filemtime($f), is_file($peers) ? (int) @filemtime($peers) : 0);
        if ($last < $limit) { @unlink($f); @unlink($peers); }
    }
    foreach (glob($dir . '/*.peers.json') ?: [] as $p) {
        if (!is_file(substr($p, 0, -11) . '.json')) @unlink($p);
    }
    @touch($dir . '/.cleanup');
}
/** Höchstens alle CLEANUP_EVERY Sekunden aufräumen (auch ohne neue Sitzungen). */
function maybe_cleanup(string $dir, float $ttlHours): void {
    $m = @filemtime($dir . '/.cleanup');
    if (!$m || time() - $m > CLEANUP_EVERY) cleanup($dir, $ttlHours);
}

$action = $body->action ?? '';

// ── neue Sitzung ──────────────────────────────────────────────────────
if ($action === 'create') {
    if (!isset($body->doc) || !is_object($body->doc) || !isset($body->doc->nodes)) answer(['error' => 'keine Mindmap übergeben'], 400);
    cleanup($dataDir, $ttlHours);
    do {
        $room = '';
        for ($i = 0; $i < ROOM_LEN; $i++) $room .= ALPHABET[random_int(0, strlen(ALPHABET) - 1)];
    } while (is_file(room_file($dataDir, $room)));
    $key = rtrim(strtr(base64_encode(random_bytes(12)), '+/', 'xy'), '=');
    $state = (object) ['ver' => 0, 'base' => 0, 'doc' => $body->doc, 'ops' => [], 'key' => $key, 'created' => now_ms()];
    if (file_put_contents(room_file($dataDir, $room), json_encode($state, JSON_UNESCAPED_UNICODE), LOCK_EX) === false) {
        answer(['error' => 'Sitzung konnte nicht gespeichert werden'], 500);
    }
    answer(['room' => $room, 'key' => $key, 'ver' => 0, 'now' => now_ms()]);
}

if ($action !== 'sync' && $action !== 'close') answer(['error' => 'unbekannte Aktion'], 400);

$room = (string) ($body->room ?? '');
// alte Links hatten 8 Zeichen, neue haben 22
if (!preg_match('/^[a-z0-9]{6,40}$/', $room)) answer(['error' => 'notfound']);
$file = room_file($dataDir, $room);
maybe_cleanup($dataDir, $ttlHours);
if (!is_file($file)) answer(['error' => 'notfound']);

// ── Sitzung beenden: Daten sofort löschen (nur mit Bearbeiten-Schlüssel) ──
if ($action === 'close') {
    $state = json_decode((string) file_get_contents($file), false);
    if (!is_object($state) || !hash_equals((string) $state->key, (string) ($body->key ?? ''))) answer(['error' => 'readonly']);
    @unlink($file);
    @unlink(peers_file($dataDir, $room));
    answer(['ok' => true]);
}

// ── abgleichen ────────────────────────────────────────────────────────

$client = substr((string) ($body->client ?? ''), 0, 40);
$since = is_int($body->since ?? null) ? $body->since : -1;
$ops = is_array($body->ops ?? null) ? $body->ops : [];

$fh = fopen($file, 'c+');
if (!$fh || !flock($fh, LOCK_EX)) answer(['error' => 'Sitzung gesperrt'], 503);
$state = json_decode(stream_get_contents($fh) ?: 'null', false);
if (!is_object($state)) {
    // z. B. gerade beendet: die von fopen('c+') neu angelegte leere Datei wieder entfernen
    flock($fh, LOCK_UN); fclose($fh);
    clearstatcache();
    if (@filesize($file) === 0) @unlink($file);
    answer(['error' => 'notfound']);
}

if ($ops) {
    if (!hash_equals((string) $state->key, (string) ($body->key ?? ''))) {
        flock($fh, LOCK_UN); fclose($fh);
        answer(['error' => 'readonly']);
    }
    $changed = false;
    foreach (array_slice($ops, 0, 2000) as $op) {
        if (!valid_op($op)) continue;
        // Protokolleintrag schon da (z. B. nach einem Verbindungsabbruch erneut gesendet): nicht doppeln
        if ($op->c === 'events' && isset($state->doc->events) && is_object($state->doc->events) && isset($state->doc->events->{$op->id})) continue;
        apply_op($state->doc, $op);
        $state->ver++;
        $state->ops[] = (object) ['v' => $state->ver, 'c' => $client, 'o' => $op];
        $changed = true;
    }
    if (count($state->ops) > KEEP_OPS) {
        $drop = count($state->ops) - KEEP_OPS;
        $state->base = $state->ops[$drop - 1]->v;
        $state->ops = array_values(array_slice($state->ops, $drop));
    }
    if ($changed) {
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($state, JSON_UNESCAPED_UNICODE));
        fflush($fh);
    }
}

// Anwesenheit (eigene kleine Datei, damit der große Stand nicht ständig neu geschrieben wird)
$pfile = peers_file($dataDir, $room);
$peers = is_file($pfile) ? (json_decode((string) file_get_contents($pfile), true) ?: []) : [];
$now = time();
$me = isset($body->me) && is_object($body->me) ? $body->me : new stdClass();
if ($client !== '') {
    $sel = isset($me->sel) && is_array($me->sel) ? array_slice($me->sel, 0, 8) : [];
    $peers[$client] = [
        'client' => $client,
        'name'   => function_exists('mb_substr') ? mb_substr((string) ($me->name ?? 'Gast'), 0, 40) : substr((string) ($me->name ?? 'Gast'), 0, 40),
        'color'  => substr((string) ($me->color ?? '#64748b'), 0, 16),
        'sel'    => array_map(fn($s) => substr((string) $s, 0, 80), $sel),
        'view'   => substr((string) ($me->view ?? ''), 0, 16),
        'ro'     => !empty($me->ro),
        't'      => $now,
    ];
}
foreach ($peers as $cid => $p) if ($now - (int) $p['t'] > PEER_TTL) unset($peers[$cid]);
file_put_contents($pfile, json_encode($peers, JSON_UNESCAPED_UNICODE), LOCK_EX);

$out = ['ver' => $state->ver, 'now' => now_ms(), 'peers' => array_values(array_map(function ($p) { unset($p['t']); return $p; }, $peers))];
if ($since < (int) ($state->base ?? 0)) {
    $out['reset'] = ['doc' => $state->doc, 'ver' => $state->ver];
} else {
    $out['ops'] = array_values(array_filter($state->ops, fn($o) => $o->v > $since));
}
flock($fh, LOCK_UN);
fclose($fh);
answer($out);
