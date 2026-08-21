/* Does Studio time a lap to better than the sample period?
 *
 * A lap timer that reports the time between two SAMPLE INDICES can only ever
 * return a whole number of sample periods. At the Donington file's 10 Hz that
 * is +/-100 ms, and every lap time comes out an exact multiple of 0.100 --
 * which is what Studio did before gpGateHits learned to interpolate.
 *
 * The fixture states its own answer, so this is self-checking: the VBO header
 * carries `fastest 1m 08.21s` and `laps 7`, and Racelogic's own Circuit Tools
 * reads the same file as 01:08.213. Anything that reproduces those is right;
 * a quantised timer lands on 1:08.200 and fails.
 *
 * Functions are pulled verbatim out of src/tauri-overlay.html -- a copy would
 * drift and then pass while the app failed (see check_line.js).
 *
 *   node tools/check_laptime.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';
const VBO = process.env.DONINGTON_VBO ||
    'C:/Users/ruuva/Downloads/rdm-test/donington/Donington - Lotus Evora GTE - Driver1.vbo';

/* ---- extract named functions verbatim ---------------------------------- */
function grabFrom(src, name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' +
                          name + ' = function)', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j)
              .replace(/^\s*window\.(\w+) = function/, 'function $1');
}

const WANT = ['gpN', 'gpMetres', 'gpMetresPerDeg', 'gpGateFromEnd', 'gpSignedDist', 'gpSecs',
              'gpSpanSecs', 'gpCrossAt', 'gpGateHits', 'gpMainDir', 'gpDeadMs', 'gpRunsFromCrossings', 'gpSplitRows',
              'gpHz', 'gpCornerScan', 'gpFindCorners'];

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [];
const missing = [];
for (const n of WANT) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}

let TRACK = null;
const build = new Function('GP_DT', 'GP_MAX_SECTORS', 'GP_CORNER_PAD',
                          'GP_TURN_DPS', 'GP_TURN_MIN_S', 'GP_TURN_MIN_DEG', 'GP_TURN_SAME_S', 'getTrack', `
    var gp = { trace: [], traceLaps: [], ghostFence: null };
    function gpActiveTrack() { return getTrack(); }
    ${parts.join('\n')}
    return {
        gpSplitRows: gpSplitRows,
        gpSecs: gpSecs,
        gpGateFromEnd: gpGateFromEnd,
        gpMetres: gpMetres,
        gpSpanSecs: (typeof gpSpanSecs === 'function') ? gpSpanSecs : null,
        gpFindCorners: (typeof gpFindCorners === 'function') ? gpFindCorners : null
    };
`);
const api = build(0.1, 20, 300, 6, 0.6, 25, 1.5, () => TRACK);

/* ---- the fixture ------------------------------------------------------- */
if (!fs.existsSync(VBO)) {
    console.error('fixture missing: ' + VBO);
    console.error('set DONINGTON_VBO to point at it');
    process.exit(2);
}
const lines = fs.readFileSync(VBO, 'latin1').split(/\r?\n/);

function section(name) {
    const out = [];
    let inSec = false;
    for (const raw of lines) {
        const s = raw.trim();
        if (s.startsWith('[') && s.endsWith(']')) { inSec = (s === '[' + name + ']'); continue; }
        if (inSec && s) out.push(s);
    }
    return out;
}

/* Position is in MINUTES and longitude is positive WEST; time is HHMMSS.SS. */
const cols = section('column names')[0].split(/\s+/);
const iLat = cols.indexOf('lat'), iLon = cols.indexOf('long');
const iTime = cols.indexOf('time'), iHdg = cols.indexOf('heading');
const iVel = cols.indexOf('velocity');
const rows = [];
for (const line of section('data')) {
    const f = line.split(/\s+/);
    if (f.length < cols.length) continue;
    const hhmmss = f[iTime];
    const hh = +hhmmss.slice(0, 2), mm = +hhmmss.slice(2, 4), ss = +hhmmss.slice(4);
    rows.push({
        lat: +f[iLat] / 60,
        lon: -(+f[iLon]) / 60,
        hdg: +f[iHdg],
        t: Math.round((hh * 3600 + mm * 60 + ss) * 1000),
        kph: +f[iVel],
    });
}

let declaredLaps = null, declaredBest = null;
for (const s of section('session data')) {
    let m = /^laps\s+(\d+)/.exec(s);
    if (m) declaredLaps = +m[1];
    m = /^fastest\s+(\d+)m\s+([\d.]+)s/.exec(s);
    if (m) declaredBest = (+m[1]) * 60 + (+m[2]);
}

/* ---- the gate, built the way gpTrackFromVbo builds it ------------------ */
const lt = section('laptiming')[0].split(/\s+/);
const gA = [+lt[2] / 60, -(+lt[1]) / 60];
const gB = [+lt[4] / 60, -(+lt[3]) / 60];
const lat = (gA[0] + gB[0]) / 2, lon = (gA[1] + gB[1]) / 2;
const r = api.gpGateFromEnd({ lat: lat, lon: lon, heading: 0, half_width_m: 15 }, gA[0], gA[1]);
let nearest = null, bd = Infinity;
for (let i = 0; i < rows.length; i += 3) {
    const d = api.gpMetres({ lat: lat, lon: lon }, { lat: rows[i].lat, lon: rows[i].lon });
    if (d < bd) { bd = d; nearest = rows[i]; }
}
TRACK = {
    start_finish: {
        lat: lat, lon: lon,
        heading: Math.round(((nearest && bd < 200) ? nearest.hdg : r.heading) * 10) / 10,
        half_width_m: r.half_width_m > 30 ? r.half_width_m : 15,
    },
    sectors: [],
};

/* ---- run --------------------------------------------------------------- */
const laps = api.gpSplitRows(rows);
const secs = laps.map(l => api.gpSpanSecs ? api.gpSpanSecs(rows, l)
                                          : api.gpSecs(rows, l.from, l.to));

let pass = 0, fail = 0;
function check(name, ok, detail) {
    if (ok) { pass++; console.log('  ok   ' + name + (detail ? '  -- ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '  -- ' + detail : '')); }
}
const fmt = s => {
    const m = Math.floor(s / 60), rem = s - m * 60;
    return m + ':' + (rem < 10 ? '0' : '') + rem.toFixed(3);
};

console.log('Donington / Lotus Evora GTE / Driver1 -- ' + rows.length + ' samples @ 10 Hz');
console.log('file declares: ' + declaredLaps + ' laps, fastest ' + declaredBest.toFixed(3) + ' s');
if (missing.length) console.log('(not in this revision: ' + missing.join(', ') + ')');
console.log('');

check('lap count matches the file', laps.length === declaredLaps,
      'got ' + laps.length + ', want ' + declaredLaps);

const bestS = Math.min.apply(null, secs);
check('fastest lap within 20 ms of the file', Math.abs(bestS - declaredBest) <= 0.020,
      'got ' + fmt(bestS) + ', want ~' + fmt(declaredBest));

/* The quantisation tell: if EVERY lap is an exact multiple of the sample
   period, the crossing was never interpolated. */
const onGrid = secs.filter(s => Math.abs(s * 10 - Math.round(s * 10)) < 1e-9).length;
check('lap times are not quantised to the 100 ms sample grid', onGrid < secs.length,
      onGrid + ' of ' + secs.length + ' land exactly on the grid');

console.log('\nlaps (chronological):');
secs.forEach((s, i) => console.log('  lap ' + (i + 1) + '  ' + fmt(s)));

/* Circuit Tools 3 reading the same file, chronological order.
 *
 * Lap 7 is deliberately excluded from the assertion. Circuit Tools times
 * against its own "Donington National" circuit-database line, not the
 * [laptiming] stub embedded in the file, and the two sit about 33 m apart. A
 * gate offset shifts BOTH ends of a flying lap by the same amount and cancels
 * -- but lap 7 ends on the in-lap, where the car crosses at 37 km/h instead of
 * 193, so the offset costs 2.5 s there and nowhere else. Measured: every
 * crossing 0-6 is at ~193 km/h, crossing 7 at 37.3 km/h.
 *
 * That is a real property of comparing two different start/finish lines, not a
 * timing error, so asserting on it would bake in someone else's gate. */
const CT = [70.12, 69.24, 69.61, 68.49, 73.10, 68.213, 86.70];
const FLYING = 6;
console.log('\nvs Circuit Tools 3:');
let worst = 0;
secs.forEach((s, i) => {
    if (i >= CT.length) return;
    const d = Math.abs(s - CT[i]);
    if (i < FLYING && d > worst) worst = d;
    console.log('  lap ' + (i + 1) + '  studio ' + fmt(s) + '   ct ' + fmt(CT[i]) +
                '   delta ' + (d * 1000).toFixed(0) + ' ms' +
                (i >= FLYING ? '   (in-lap: different gate, not compared)' : ''));
});
check('every flying lap within 30 ms of Circuit Tools', worst <= 0.030,
      'worst ' + (worst * 1000).toFixed(0) + ' ms across laps 1-' + FLYING);

/* ---- corners ------------------------------------------------------------
 * Donington National has NINE corners, and Racelogic's own Circuit Tools walks
 * all nine in its Insights panel: Redgate, Craner Curves, Old Hairpin,
 * Starkey's Bridge, Schwantz Curve, McLeans, Coppice, the Esses and Goddards.
 * Studio's Corners view found four of them.
 *
 * The detector is written in SAMPLES tuned for the puck's 25 Hz -- the
 * minimum-separation window is `GAP = 25`, commented "1 s at 25 Hz", which on
 * this 10 Hz file is two and a half seconds: wide enough to swallow a whole
 * corner. Same family as the lap-time quantisation above; both assume a fixed
 * sample rate that imported logs do not have.
 */
if (api.gpFindCorners) {
    let bi = 0;
    secs.forEach((s, i) => { if (s < secs[bi]) bi = i; });
    const bl = laps[bi];
    const corners = api.gpFindCorners(rows, bl.from, bl.to);
    console.log('\ncorners found on the best lap (lap ' + (bi + 1) + '):');
    corners.forEach((c, k) => {
        console.log('  ' + (k + 1) + '  apex ' +
                    ((rows[c.apex].t - rows[bl.from].t) / 1000).toFixed(1) + ' s in, ' +
                    rows[c.apex].kph.toFixed(0) + ' km/h');
    });
    /* Seven, not nine, and that is the honest bar.
     *
     * Circuit Tools does not DETECT corners at all — it ships a circuit
     * database and reads Donington's nine off it by name (Redgate, Craner
     * Curves, ...). Studio infers them from the trace, which works on any
     * track anywhere including ones nobody has surveyed, and the price is that
     * a corner the car barely has to turn for may not register. Chasing the
     * last two by tuning thresholds against this one file would be fitting to
     * the fixture, not improving the detector.
     *
     * What this guards is the STRUCTURAL failure that was there before: a
     * speed-only detector cannot see a corner taken under power, and four of
     * these seven are found by heading alone. The one at ~18 s is Craner
     * Curves, 165 -> 218 km/h with no speed minimum anywhere in it. */
    check('finds at least 7 corners, including ones taken under power',
          corners.length >= 7, 'found ' + corners.length);
    const underPower = corners.filter(c => c.byHeading).length;
    check('at least one corner is found by heading, not by a speed minimum',
          underPower >= 1, underPower + ' of ' + corners.length + ' found by heading');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
