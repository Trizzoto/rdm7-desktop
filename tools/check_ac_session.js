/* Does the file ac_record.py writes actually open in Studio?
 *
 * The only honest way to answer that is with Studio's own reader, so this
 * pulls gpSessionFileParse and friends straight out of src/tauri-overlay.html
 * — no copies, for the same reason tools/check_autotrack.js does it: a copy
 * drifts, and then the check passes while the app refuses the file.
 *
 *   python tools/ac_record.py --selftest --out /tmp/ac.rdmsession
 *   node tools/check_ac_session.js /tmp/ac.rdmsession
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'tauri-overlay.html');
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: function ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j);
}
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    let i = src.indexOf('=', m.index) + 1, depth = 0, j = i, instr = null;
    for (; j < src.length; j++) {
        const c = src[j];
        if (instr) { if (c === '\\') j++; else if (c === instr) instr = null; continue; }
        if (c === '"' || c === "'") { instr = c; continue; }
        if (c === '[' || c === '{') depth++;
        else if (c === ']' || c === '}') depth--;
        else if (c === ';' && depth === 0) { j++; break; }
    }
    return src.slice(m.index, j);
}

const FN = ['gpN', 'gpB64', 'gpB64Dec', 'gpSesUid', 'gpRowsUnpack',
            'gpSessionFileParse', 'gpMetres', 'gpKmBetween', 'gpTraceHome',
            'gpMatchTrack'];
const VAR = ['GP_NO_T', 'GP_CHAN_STALE', 'GP_SESFILE_FMT', 'GP_PLACES',
             'GP_MATCH_KM'];

let code = '';
VAR.forEach(v => { code += grabVar(v) + '\n'; });
FN.forEach(f => { code += grab(f) + '\n'; });

global.gp = { tracks: { tracks: [] } };
global.gpTrackUid = () => 't1';
global.gpTracksSave = () => {};
global.localStorage = { getItem: () => null, setItem: () => {} };
const F = new Function(code + '\n; return {' + FN.concat(VAR).join(',') + '};')();

Object.keys(F).forEach(k => {
    if (F[k] === undefined) throw new Error('extracted "' + k + '" is undefined — the harness is lying');
});

/* ---- the file under test ----------------------------------------------
 *
 * With no argument, MAKE one: `ac_record.py --selftest` drives a synthetic
 * lap through the real writers, which is exactly the file this harness wants
 * to read. Requiring a path meant check_all.js counted this harness as DEAD
 * on every run — the failure mode check_all.js was written to catch, and the
 * one it can least afford to have itself. */
let file = process.argv[2];
let made = null;
if (!file) {
    const os = require('os');
    const { spawnSync } = require('child_process');
    made = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'acsess-')), 'selftest.rdmsession');
    const py = spawnSync(process.env.PYTHON || 'python',
        [path.join(__dirname, 'ac_record.py'), '--selftest', '--out', made],
        { encoding: 'utf8' });
    if (py.status !== 0 || !fs.existsSync(made)) {
        console.error('could not generate a fixture with ac_record.py --selftest:\n' +
                      ((py.stderr || '') + (py.stdout || '')).trim());
        process.exit(2);
    }
    file = made;
}
const text = fs.readFileSync(file, 'utf8');
process.on('exit', function () {
    if (made) { try { fs.rmSync(path.dirname(made), { recursive: true, force: true }); } catch (e) {} }
});

let fails = 0;
const ok = (name, cond, detail) => {
    console.log('  ' + (cond ? 'ok  ' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
    if (!cond) fails++;
};

console.log('reading ' + path.basename(file) + ' with Studio\'s own parser\n');

const parsed = F.gpSessionFileParse(text);          /* throws if malformed */
const meta = parsed.meta, pk = parsed.pk;
const rows = F.gpRowsUnpack(pk);

ok('parses at all', rows.length > 0, rows.length + ' samples');
ok('sample count agrees with meta', rows.length === meta.samples,
   rows.length + ' vs meta.samples ' + meta.samples);
ok('every channel is named', !!(meta.chanIds && meta.chanDefs &&
   meta.chanIds.length === meta.chanDefs.length && meta.chanIds.length === pk.nch),
   pk.nch + ' columns, ' + ((meta.chanDefs || []).length) + ' definitions');

/* Coordinates have to be real places, not NaN or the null island. */
let badLL = 0, minLat = 90, maxLat = -90;
rows.forEach(r => {
    if (!isFinite(r.lat) || !isFinite(r.lon) || Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) badLL++;
    minLat = Math.min(minLat, r.lat); maxLat = Math.max(maxLat, r.lat);
});
ok('coordinates are coordinates', badLL === 0, badLL + ' bad');
ok('the track has extent', (maxLat - minLat) > 1e-4,
   ((maxLat - minLat) * 111320).toFixed(0) + ' m north-south');

/* Time must run forward, or the whole transport bar is nonsense. */
let backwards = 0, tmax = 0;
rows.forEach(r => {
    if (r.t === undefined) return;
    if (r.t < tmax) backwards++;
    tmax = Math.max(tmax, r.t);
});
ok('time runs forward', backwards === 0, backwards + ' steps back');
ok('duration is plausible', tmax > 1000, (tmax / 1000).toFixed(1) + ' s');

/* Rate: the format assumes 25 Hz everywhere downstream. */
const hz = rows.length / (tmax / 1000);
ok('samples at about 25 Hz', hz > 20 && hz < 30, hz.toFixed(1) + ' Hz');

/* Speed sanity — a stuck or unscaled speed column is the classic silent bug. */
let vmax = 0, vmin = 1e9;
rows.forEach(r => { vmax = Math.max(vmax, r.kph); vmin = Math.min(vmin, r.kph); });
ok('speed varies and is a speed', vmax > 10 && vmax < 500 && vmin >= 0,
   vmin.toFixed(1) + ' – ' + vmax.toFixed(1) + ' km/h');

/* Heading must actually turn, or yaw rate and lateral g come out zero and a
   broken channel looks perfectly fine. */
const hset = new Set(rows.map(r => Math.round(r.hdg)));
ok('heading sweeps the compass', hset.size > 60, hset.size + ' distinct degrees');

/* Channels decode through their own definitions back to real units.
   A column that never moves is the classic silent failure — it packs and
   unpacks perfectly while carrying nothing — so it is called out, not just
   printed. */
const defs = meta.chanDefs || [];
let flat = 0;
defs.forEach((d, c) => {
    let lo = Infinity, hi = -Infinity, stale = 0;
    rows.forEach(r => {
        const raw = r.can ? r.can[c] : null;
        if (raw === null || raw === undefined) { stale++; return; }
        const v = raw * d.scale + d.offset;
        lo = Math.min(lo, v); hi = Math.max(hi, v);
    });
    const got = isFinite(lo);
    const still = got && (hi - lo) < 1e-9;
    if (still) flat++;
    console.log('        ' + (d.name + '                    ').slice(0, 18) +
        (got ? (lo.toFixed(d.decimals) + ' – ' + hi.toFixed(d.decimals) + ' ' + (d.unit || ''))
             : 'no readings') +
        (stale ? '   (' + stale + ' quiet)' : '') +
        (still ? '   NEVER MOVED' : ''));
    if (!got && stale !== rows.length) fails++;
});
ok('every channel carries something', flat === 0,
   flat ? flat + ' column(s) constant end to end' : defs.length + ' live');

/* The u16 packing is a lossy step, and how lossy matters: a channel fitted
   to its own range must survive at better than a part in 30,000, or the
   trace is being quantised into steps a driver could see. */
let worst = 0;
defs.forEach(d => {
    const span = d.scale * 65534;
    if (span > 0) worst = Math.max(worst, d.scale / span);
});
ok('channel precision holds up', worst > 0 && worst <= 1 / 30000,
   '1 part in ' + Math.round(1 / (worst || 1)));

/* And the point of the georeference: does Studio recognise where this is? */
const m = F.gpMatchTrack(rows);
ok('Studio places it on a circuit', !!m,
   m ? (m.track.name + ', ' + m.km.toFixed(2) + ' km from centre' +
        (m.made ? ' (recognised from GP_PLACES)' : ' (a track you already had)'))
     : 'no circuit within ' + F.GP_MATCH_KM + ' km — the anchor is wrong');

console.log('\n' + (fails ? fails + ' FAILED' : 'all good') +
            ' — ' + meta.name + ' · ' + (meta.device || '?'));
process.exit(fails ? 1 : 0);
