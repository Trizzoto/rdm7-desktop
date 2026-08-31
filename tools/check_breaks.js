/* Does Studio refuse to join two samples that no driving connects?
 *
 * A recording is a list of positions, and everything downstream assumes that
 * consecutive positions are two readings of one continuous line: the map joins
 * them, the gate scan interpolates a lap time between them, the drift engine
 * differentiates across them. Six pairs on the 22 Aug drive to Mallala are not
 * that, and one of them is worth thirteen seconds of lap time.
 *
 * This runs the app's own gpMarkBreaks over synthetic cases where the answer
 * is known, and then — if the recording is on this machine — over the real
 * 168 105-sample ring, where the answer was established sample by sample in
 * docs/IN_THE_CAR_2026-08-22.md.
 *
 *   node tools/check_breaks.js
 *   node tools/check_breaks.js "C:/Users/<you>/Documents/RDM sessions/puck-ring-2026-08-22.jsonl.gz"
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');
const RING = process.argv[2] || path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Documents', 'RDM sessions', 'puck-ring-2026-08-22.jsonl.gz');

/* ---- pull the real code out of the app -------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { j++; break; } } }
    return SRC.slice(m.index, j);
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const K = {};
['GP_BREAK_SLACK', 'GP_BREAK_FLOOR_M', 'GP_BREAK_QUIET_M', 'GP_BREAK_QUIET_K',
 'GP_BREAK_MAX_FRAC', 'GP_BREAK_AXIS_M', 'GP_MAX_STEP_S'].forEach(n => K[n] = constOf(n));

const FNS = ['gpN', 'gpMetres', 'gpGapS', 'gpNominalStep', 'gpMarkBreaks', 'gpRunBreakM',
             'gpSecs', 'gpStep', 'gpSignedDist', 'gpCrossAt', 'gpSpanSecs', 'gpGateHits',
             'gpRunGapMs', 'gpGradeRuns', 'gpSmoothAxis', 'gpSmoothNoise', 'gpSmoothPath'];

const gp = {};
const ARGN = ['gp', 'GP_DT', 'GP_TRACE_HZ', 'GP_SMOOTH_LIVE', 'GP_SMOOTH_MAXW', ...Object.keys(K)];
const API = new Function(...ARGN,
    FNS.map(grab).join('\n') +
    '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};'
)(gp, 1 / 25, 25, constOf('GP_SMOOTH_LIVE'), constOf('GP_SMOOTH_MAXW'),
  ...Object.keys(K).map(n => K[n]));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
const head = s => console.log('\n' + s);

/* ---- a drive whose every step is honest -------------------------------- */
const M_PER_DEG = 111320;
/* Due east at a steady speed, 25 Hz, starting at Mallala's start/finish. */
function straight(n, kph, hz) {
    hz = hz || 25;
    const rows = [];
    const step = (kph / 3.6) / hz;                 /* metres per sample */
    let lat = -34.4161627, lon = 138.5030594;
    for (let i = 0; i < n; i++) {
        rows.push({ lat: lat, lon: lon, kph: kph, hdg: 90, g: 0, t: i * (1000 / hz) });
        lon += step / (M_PER_DEG * Math.cos(lat * Math.PI / 180));
    }
    return rows;
}
/* Move everything from `at` on by `m` metres east, leaving the clock alone —
   the lost-fix signature: the road is gone and nothing says so. */
function teleport(rows, at, m) {
    const d = m / (M_PER_DEG * Math.cos(rows[0].lat * Math.PI / 180));
    for (let i = at; i < rows.length; i++) rows[i].lon += d;
    return rows;
}
/* Delete samples but keep the clock honest — the stalled-writer signature. */
function excise(rows, at, count) {
    const out = rows.slice(0, at).concat(rows.slice(at + count));
    return out;
}

head('A recording with nothing wrong with it is left completely alone');
{
    const rows = straight(2000, 100);
    const n = API.gpMarkBreaks(rows);
    ok('no breaks in 2 000 clean samples at 100 km/h', n === 0, n + ' found');
    ok('every sample is marked, none is left undefined',
       rows.every(r => r.brk === false && r.brkTime === false));

    const slow = straight(2000, 8);
    ok('nor at a crawl', API.gpMarkBreaks(slow) === 0);

    const vbo = straight(600, 200, 10);
    ok('nor in a 10 Hz VBO at 200 km/h', API.gpMarkBreaks(vbo) === 0);

    const oneHz = straight(600, 200, 1);
    ok('nor in a 1 Hz log at 200 km/h', API.gpMarkBreaks(oneHz) === 0);
}

head('A car standing still does not break its own trace');
{
    /* Parked, ignition on, the receiver wandering several metres either way —
       which is what a real fix does and is not a jump. */
    const rows = straight(1200, 0);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
    rows.forEach(r => {
        r.lat += rnd() * 8 / M_PER_DEG;
        r.lon += rnd() * 8 / M_PER_DEG;
    });
    ok('8 m of standstill wander is not a break', API.gpMarkBreaks(rows) === 0);
}

head('The Mallala lost fix: the road is gone AND the clock does not know');
{
    const rows = teleport(straight(2000, 106), 1000, 444);
    const n = API.gpMarkBreaks(rows);
    ok('exactly one break', n === 1, n + ' found');
    ok('at the sample the jump lands on', rows[1000].brk === true);
    ok('and the clock across it is called wrong', rows[1000].brkTime === true);
    /* 444 m of teleport plus the 1.2 m the car covered in that sample. */
    ok('with the distance recorded', Math.abs(rows[1000].brkM - 444) < 2,
       rows[1000].brkM.toFixed(1) + ' m');
    ok('nothing either side of it is touched',
       !rows[999].brk && !rows[1001].brk);
}

head('The stalled writer: the road is gone but the clock is honest');
{
    /* 6.1 s of samples deleted at 110 km/h — 186 m of road missing, and the
       timestamps say so. */
    const rows = excise(straight(4000, 110), 2000, 153);
    const n = API.gpMarkBreaks(rows);
    ok('one break', n === 1, n + ' found');
    ok('marked as no line', rows[2000].brk === true);
    ok('but the clock is NOT called wrong — the time is measured',
       rows[2000].brkTime === false);
}

head('A pause the recorder took on purpose is not a break');
{
    /* The puck stops writing below 8 km/h. Park for six minutes and drive off
       from the same spot: a huge clock gap, no missing road. */
    const rows = straight(1000, 60);
    for (let i = 500; i < rows.length; i++) rows[i].t += 360000;
    for (let i = 500; i < rows.length; i++) {
        rows[i].lon = rows[499].lon + (rows[i].lon - rows[500].lon);
    }
    const n = API.gpMarkBreaks(rows);
    ok('six minutes of standing still is not a break', n === 0, n + ' found');
}

head('A source this test cannot describe keeps its straight lines');
{
    /* An import with no usable speed channel: every step looks impossible.
       Cutting it into 2 000 fragments would be worse than leaving it. */
    const rows = straight(2000, 100);
    rows.forEach(r => { r.kph = 0; });
    const n = API.gpMarkBreaks(rows);
    ok('nothing is marked when the rule fits nothing', n === 0, n + ' found');
    ok('and no sample is left flagged', rows.every(r => !r.brk));
}

head('A jump cannot time a lap');
{
    /* The gate sits across the road ahead. The car teleports from before it to
       after it — two readings on opposite sides of the line, and no crossing
       between them, because the car was never on the line. */
    const rows = straight(2000, 106);
    const gateAt = rows[1200];
    const gate = { lat: gateAt.lat, lon: gateAt.lon, heading: 90, half_width_m: 15 };

    const clean = API.gpGateHits(rows, gate, 0, rows.length - 1);
    ok('driven through, the gate fires once', clean.hits.length === 1,
       clean.hits.length + ' hits');

    const jumped = teleport(straight(2000, 106), 1150, 444);
    API.gpMarkBreaks(jumped);
    const h = API.gpGateHits(jumped, gate, 0, jumped.length - 1);
    ok('jumped over, it does not fire at all', h.hits.length === 0,
       h.hits.length + ' hits');
}

head('A run with a jump in it is never a clean time');
{
    const rows = teleport(straight(4000, 106), 2000, 444);
    API.gpMarkBreaks(rows);
    const runs = API.gpGradeRuns(rows, [
        { from: 0, to: 1500, tFrom: rows[0].t, tTo: rows[1500].t },
        { from: 1600, to: 3000, tFrom: rows[1600].t, tTo: rows[3000].t }
    ]);
    ok('the run without it is clean', runs[0].flag === null, String(runs[0].flag));
    ok('the run with it is flagged "jump"', runs[1].flag === 'jump', String(runs[1].flag));
    ok('and says how far it jumped', Math.abs(runs[1].flagM - 444) < 2,
       runs[1].flagM.toFixed(1) + ' m');
}

head('The smoother does not drag the line across the hole');
{
    /* Found in the running app, not here: the trace was still drawing a
       staircase of 200 m lines beside the break, and none of them was a
       break to skip. gpSmoothAxis integrates SPEED, so 444 m of ground cost
       40 ms of axis — the fitting window spanned the jump and fitted a
       quadratic through samples half a kilometre apart. The break has to be a
       wall in the axis, not just a flag on a sample. */
    const jumped = teleport(straight(2000, 106), 1000, 444);
    API.gpMarkBreaks(jumped);
    gp.trace = jumped; gp.pathKey = null; gp.path = null; gp.liveMode = false;
    const P = API.gpSmoothPath();
    ok('every sample still has a smoothed position', P && P.length === 2000);

    const mLon = M_PER_DEG * Math.cos(jumped[0].lat * Math.PI / 180);
    let worst = 0, worstAt = -1;
    for (let k = 1; k < P.length; k++) {
        if (jumped[k].brk) continue;                 /* the break itself is not drawn */
        const d = Math.hypot((P[k][1] - P[k - 1][1]) * mLon,
                             (P[k][0] - P[k - 1][0]) * M_PER_DEG);
        if (d > worst) { worst = d; worstAt = k; }
    }
    ok('no smoothed step is longer than a sample of road', worst < 2,
       worst.toFixed(1) + ' m at ' + worstAt);

    /* And each side still lands on its own samples rather than somewhere
       between the two halves. */
    const off = k => Math.hypot((P[k][1] - jumped[k].lon) * mLon,
                                (P[k][0] - jumped[k].lat) * M_PER_DEG);
    ok('the samples either side sit on the road they were taken on',
       off(999) < 1 && off(1000) < 1 && off(1001) < 1,
       off(999).toFixed(2) + ' / ' + off(1000).toFixed(2) + ' / ' + off(1001).toFixed(2) + ' m');
}

head('The map draws no line where there is no line');
{
    /* The real drawing code, lifted out of the Leaflet layer and given a
       canvas context that records instead of painting. This is the assertion
       the whole exercise is for: after a jump, no stroke joins the two sides
       of it. */
    const m = /^            _strand: function \(st, pr, ox, oy, phase\) \{/m.exec(SRC);
    if (!m) throw new Error('not found: _strand');
    let i = SRC.indexOf('{', m.index + 20), d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { j++; break; } } }
    const body = SRC.slice(i, j);

    const gpTrace = { trace: null };
    const strand = new Function('gp', 'GP_TRACE_CASE', 'GP_TRACE_MIN_W',
        'return function (st, pr, ox, oy, phase) ' + body + ';')(gpTrace, '#0a0c0e', 1.0);

    /* One metre of ground per pixel, so the recorded coordinates ARE metres. */
    const project = rows => {
        const ax = new Float64Array(rows.length), ay = new Float64Array(rows.length);
        const mLon = M_PER_DEG * Math.cos(rows[0].lat * Math.PI / 180);
        for (let k = 0; k < rows.length; k++) {
            ax[k] = (rows[k].lon - rows[0].lon) * mLon;
            ay[k] = -(rows[k].lat - rows[0].lat) * M_PER_DEG;
        }
        return { ax: ax, ay: ay };
    };
    const draw = rows => {
        const segs = [];
        let at = null;
        const ctx = {
            lineWidth: 0, globalAlpha: 1, strokeStyle: '',
            setLineDash() {}, beginPath() { at = null; }, stroke() {},
            moveTo(x, y) { at = [x, y]; },
            lineTo(x, y) { if (at) segs.push(Math.hypot(x - at[0], y - at[1])); at = [x, y]; }
        };
        gpTrace.trace = rows;
        strand.call({
            _ctx: ctx, _wk: 1,
            _bounds: { min: { x: -1e9, y: -1e9 }, max: { x: 1e9, y: 1e9 } }
        }, { from: 0, to: rows.length - 1, width: 4, casing: 0, col: '#fff' },
           project(rows), 0, 0, 1);
        return segs;
    };

    const clean = straight(2000, 106);
    API.gpMarkBreaks(clean);
    const a = draw(clean);
    ok('a clean lap is drawn as one unbroken line', a.length === 1999, a.length + ' segments');
    ok('and every segment is one sample of road', Math.max(...a) < 2,
       Math.max(...a).toFixed(2) + ' m longest');

    const jumped = teleport(straight(2000, 106), 1000, 444);
    API.gpMarkBreaks(jumped);
    const b = draw(jumped);
    ok('the jumped one is drawn as two, with nothing between them',
       b.length === 1998, b.length + ' segments');
    ok('and NO segment crosses the jump', Math.max(...b) < 2,
       Math.max(...b).toFixed(2) + ' m longest');

    /* The regression this replaces: without the marks, the same samples draw a
       443 m bar straight across the map. */
    jumped.forEach(r => { r.brk = false; });
    const c = draw(jumped);
    ok('... which is exactly what it used to do', Math.max(...c) > 400,
       Math.max(...c).toFixed(0) + ' m bar');
}

/* ---- the real thing ---------------------------------------------------- */
head('The 22 Aug ring, sample by sample');
if (!fs.existsSync(RING)) {
    console.log('  --   skipped: ' + RING + ' is not on this machine');
} else {
    const rows = zlib.gunzipSync(fs.readFileSync(RING)).toString('utf8')
        .trim().split('\n').map(JSON.parse);
    ok('the whole ring loaded', rows.length === 168105, rows.length + ' samples');

    const t0 = Date.now();
    const n = API.gpMarkBreaks(rows);
    const ms = Date.now() - t0;

    /* Every one of these is written up in docs/IN_THE_CAR_2026-08-22.md, found
       by hand before any of this code existed. */
    const found = [];
    rows.forEach((r, i) => { if (r.brk) found.push({ i: i, m: Math.round(r.brkM), time: !!r.brkTime }); });
    ok('six breaks in 168 105 samples, and no more', n === 6,
       n + ' found: ' + found.map(f => f.i + '/' + f.m + 'm').join(' '));

    const at = i => found.find(f => f.i === i);
    ok('the lost fix at 84 115 is found', !!at(84115));
    ok('it is 444 m', at(84115) && at(84115).m === 444, at(84115) ? at(84115).m + ' m' : '-');
    ok('and it is the ONLY one whose clock is wrong',
       found.filter(f => f.time).length === 1 &&
       found.filter(f => f.time)[0].i === 84115,
       found.filter(f => f.time).map(f => f.i).join(' '));

    [[67819, 39], [68243, 183], [70363, 143], [71423, 81]].forEach(([i, m]) => {
        ok('the writer stall at ' + i + ' is found, ' + m + ' m of road',
           !!at(i) && Math.abs(at(i).m - m) <= 1, at(i) ? at(i).m + ' m' : 'missing');
        ok('  ... and its clock is left alone', !!at(i) && at(i).time === false);
    });
    ok('the 100 m creep across the 6-minute pause is found', !!at(25281));

    ok('the 16-hour gap between Friday and Saturday is NOT a break — the car ' +
       'was parked in the same spot', !at(52257));

    ok('marking the whole ring costs under 200 ms', ms < 200, ms + ' ms');
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'passed all ' + pass) + ' checks');
process.exit(fail ? 1 : 0);
