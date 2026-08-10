/* Does the Drift view read a real circuit correctly?
 *
 * check_drift.js proves the angle engine against an analytic figure. This
 * proves the WHOLE CHAIN against a real one: it runs the fixture through the
 * app's own VBO importer — the same code an imported drift-box log goes
 * through, minutes and positive-west longitude and HHMMSS clock included —
 * and then asks the Drift view's own functions what they see, against a truth
 * file the generator wrote at the same time.
 *
 * The geometry is Mallala's real final complex, so the corners are whatever
 * the survey says they are rather than something chosen to be easy.
 *
 *   node tools/make_drift_fixture.js /tmp/mallala-drift.vbo
 *   node tools/check_mallala.js      /tmp/mallala-drift.vbo
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VBO = process.argv[2] || path.join(ROOT, 'mallala-drift.vbo');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

/* ---- pull the real code out of the app -------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { j++; break; } } }
    return SRC.slice(m.index, j);
}
function varBlock(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf(m[0].endsWith('{') ? '{' : (SRC[m.index + m[0].length] === '[' ? '[' : '{'), m.index);
    const open = SRC[i], close = open === '{' ? '}' : ']';
    let d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === open) d++; else if (SRC[j] === close) { d--; if (!d) { j++; break; } } }
    return SRC.slice(m.index, j) + ';';
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const K = {};
['GP_DRIFT_MIN_KPH', 'GP_DRIFT_GAP_S', 'GP_DRIFT_MIN_S', 'GP_DRIFT_ON', 'GP_DRIFT_OFF',
 'GP_DRIFT_HOLD_S', 'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G', 'GP_DRIFT_CLIP_FADE_M',
 'GP_DRIFT_MIN_SHAPE_M', 'GP_DRIFT_SCORE_VER', 'GP_DRIFT_ROUGH', 'GP_MAX_STEP_S',
 'GP_CHAN_STALE'].forEach(n => K[n] = constOf(n));

const FNS = [
    'gpN', 'gpMetres', 'gpMetresPerDeg', 'gpSecs', 'gpStep', 'gpChanDefsById',
    'gpSignedDist', 'gpGateHits', 'gpMainDir', 'gpChannels', 'gpComputeG',
    'gpGapS', 'gpDriftRuns', 'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess',
    'gpDriftSrcPrefs', 'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle',
    'gpDriftSeek', 'gpDriftSwitches', 'gpDriftSegments', 'gpDriftStats',
    'gpCourses', 'gpCourseActive', 'gpCourseStamp', 'gpCourseClean',
    'gpZoneGeom', 'gpZoneNear', 'gpDriftCard', 'gpDriftBest', 'gpDriftForget',
    'gpVboClockMs', 'gpVboSpeedScale', 'gpVboParse', 'gpHaversineM'
];

const gp = {};
const win = { localStorage: { getItem: () => null, setItem: () => {} } };
const fakeTrack = { id: 't', name: 'Mallala', courses: [] };
let libChans = [];
/* gpVboParse leans on a few app-wide helpers that are not what is under test */
const stubs = `
    function gpRowsPack(rows) { return { n: rows.length }; }
    function gpEsc(s) { return String(s == null ? "" : s); }
    function gpSesUid() { return "ses_fixture"; }
`;
const ARGN = ['gp', 'window', 'GP_DT', 'GP_TRACE_HZ', 'gpActiveTrack', 'GP_ZONE_GEO', 'gpAllChans', ...Object.keys(K)];
const API = new Function(...ARGN,
    /* GP_PLACES comes along for the ride: the importer recognises the circuit
       from where the driving happened, so a fixture built on Mallala's own
       survey should come back NAMED Mallala. That is worth asserting. */
    varBlock('GP_VBO_ROLE') + '\n' + varBlock('GP_PLACES') + '\n' + stubs + '\n' +
    FNS.map(grab).join('\n') +
    '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};'
)(gp, win, 1 / 25, 25, () => fakeTrack, new WeakMap(), () => libChans, ...Object.keys(K).map(n => K[n]));

/* ---- load the fixture through the real importer ----------------------- */
const truth = JSON.parse(fs.readFileSync(VBO.replace(/\.vbo$/, '') + '.truth.json', 'utf8'));
const parsed = API.gpVboParse(fs.readFileSync(VBO, 'utf8'), path.basename(VBO));

/* gpVboParse hands back the file's own FLOATS in rows[].cv, and separately a
   per-channel scale/offset it fitted so those floats survive as u16 in
   storage. A loaded session carries the u16, and every reader decodes it with
   those defs. So encode here exactly as saving does — otherwise the decode
   runs a second time over already-decoded values, and the channel arrives
   pinned near its own minimum with a one-degree spread. (It did: the yaw
   channel read a constant -254 deg/s and the calibration had nothing to work
   with.) */
const defs = parsed.meta.chanDefs;
gp.trace = parsed.rows.map(r => ({
    lat: r.lat, lon: r.lon, kph: r.kph, hdg: r.hdg, g: 0, t: r.ms,
    can: r.cv && r.cv.map((v, k) => v === null || v === undefined ? null
        : Math.max(0, Math.min(65535, Math.round((v - defs[k].offset) / defs[k].scale))))
}));
gp.traceChanIds = parsed.meta.chanIds;
gp.traceChanDefs = defs;
API.gpComputeG(gp.trace);
gp.ghostFence = null; gp.chan = null; gp.chanKey = ''; gp.selLap = -1;
gp.driftSel = 0; gp.driftSrcPref = null; gp.courseId = null;
API.gpDriftForget();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
const head = s => console.log('\n' + s);

head('The file survives the round trip');
{
    ok('it parses at all', !!parsed && parsed.rows.length > 2000, parsed.rows.length + ' samples');
    ok('the channel comes through named and united',
       parsed.meta.chanDefs.length === 1 && /yaw/i.test(parsed.meta.chanDefs[0].name) &&
       /deg\/s/i.test(parsed.meta.chanDefs[0].unit),
       JSON.stringify(parsed.meta.chanDefs[0] && { n: parsed.meta.chanDefs[0].name, u: parsed.meta.chanDefs[0].unit }));
    /* Longitude positive-west and latitude-in-minutes are the two traps that
       silently put a session in the wrong hemisphere. Mallala is at
       -34.4, +138.5; anything else means the encoding is wrong. */
    const lat = gp.trace[0].lat, lon = gp.trace[0].lon;
    ok('and it lands at Mallala, not its mirror image',
       Math.abs(lat - -34.41) < 0.05 && Math.abs(lon - 138.50) < 0.05,
       lat.toFixed(4) + ', ' + lon.toFixed(4));
}

head('Runs');
{
    const runs = API.gpDriftRuns();
    ok('all five runs are found', runs.length === truth.length, runs.length + ' runs');
    let sameSpan = true;
    runs.forEach((r, i) => { if (!truth[i] || Math.abs((r.to - r.from) - (truth[i].to - truth[i].from)) > 2) sameSpan = false; });
    ok('each covers the driving it should', sameSpan);
    const dur = runs.map(r => API.gpSecs(gp.trace, r.from, r.to));
    ok('and their lengths are right', dur.every((d, i) => Math.abs(d - truth[i].secs) < 0.5),
       dur.map(d => d.toFixed(1)).join(' / ') + ' s');
}

head('The angle, against what the car really did');
{
    const d = API.gpDriftAngle();
    ok('an angle source is found without being told', !!d, d ? 'from "' + d.src.name + '"' : '');
    ok('and it is worked out, not passed through', d && !d.direct);
    ok('the gyro scale is recovered', d && Math.abs(d.scale - 1.008) < 0.01,
       d ? 'fitted ' + d.scale.toFixed(4) + ' against a true 1.008' : '');
    ok('the zero offset is recovered', d && Math.abs(d.bias - 0.42) < 0.35,
       d ? 'fitted ' + d.bias.toFixed(3) + ' against a true 0.42' : '');

    /* truth beta is regenerated by the fixture; re-derive it from the file's
       own ordering so the comparison is sample for sample */
    const runs = API.gpDriftRuns();
    let worstPeak = 0;
    runs.forEach((r, i) => {
        const st = API.gpDriftStats(r);
        const e = Math.abs(st.angle.peak - truth[i].peakBeta);
        if (e > worstPeak) worstPeak = e;
    });
    ok('every run\'s widest angle is within 4 deg of the truth', worstPeak < 4,
       'worst run out by ' + worstPeak.toFixed(1) + ' deg');

    let claimed = 0, covered = 0;
    for (let i = 0; i < gp.trace.length; i++) if (d && d.ok[i]) claimed++;
    ok('most of the driving carries an angle', claimed / gp.trace.length > 0.6,
       (100 * claimed / gp.trace.length).toFixed(0) + '% of samples');
    let rough = 0;
    runs.forEach(r => { if (API.gpDriftStats(r).angle.rough) rough++; });
    ok('no run is flagged rough', rough === 0, rough + ' rough');
}

head('What the driver would read');
{
    const runs = API.gpDriftRuns();
    console.log('   run  entry  low   exit   time   sw   angle  held   +/-');
    runs.forEach((r, i) => {
        const st = API.gpDriftStats(r);
        console.log('    ' + (i + 1) +
            st.entryKph.toFixed(0).padStart(7) + st.lowKph.toFixed(0).padStart(6) +
            st.exitKph.toFixed(0).padStart(7) + st.secs.toFixed(1).padStart(7) +
            String(st.switches).padStart(5) +
            (st.angle ? st.angle.peak.toFixed(0).padStart(7) + '°' + st.angle.held.toFixed(0).padStart(6) + '°'
                      : '      —     —') +
            (st.angle ? ('±' + st.angle.conf.toFixed(0)).padStart(6) : '') +
            '   ' + truth[i].name);
    });
    const sts = runs.map(r => API.gpDriftStats(r));
    ok('entry speeds match the file', sts.every((s, i) => Math.abs(s.entryKph - truth[i].entryKph) < 1.5),
       sts.map(s => s.entryKph.toFixed(0)).join('/'));
    ok('the slowest point is found', sts.every((s, i) => Math.abs(s.lowKph - truth[i].lowKph) < 1.5));
    /* The complex is right-left-right, so a run that holds angle through it
       has two direction changes in it. */
    ok('two switches per run, as the corners demand',
       sts.every(s => s.switches === 2), sts.map(s => s.switches).join('/'));
    /* Run 4 was driven with the most commitment and should win on angle;
       run 5 threw it away early. */
    const best = API.gpDriftBest();
    ok('the best run is the one that held the most angle', best === 3, 'picked run ' + (best + 1));
    ok('the run that dropped it reads lower than the one that did not',
       sts[4].angle.held < sts[3].angle.held,
       'run 5 held ' + sts[4].angle.held.toFixed(0) + '° vs run 4 ' + sts[3].angle.held.toFixed(0) + '°');
}

head('Scoring a course drawn on it');
{
    const runs = API.gpDriftRuns();
    const r0 = runs[3];                       /* the best run defines the line */
    const rows = gp.trace;
    /* a clip on the apex of the first right, and a zone along the exit */
    const apex = r0.from + Math.round((r0.to - r0.from) * 0.42);
    const zoneFrom = r0.from + Math.round((r0.to - r0.from) * 0.72);
    const zoneTo = r0.from + Math.round((r0.to - r0.from) * 0.92);
    const zpts = [];
    for (let i = zoneFrom; i <= zoneTo; i += 12) zpts.push([rows[i].lat, rows[i].lon]);
    fakeTrack.courses = [API.gpCourseClean({
        id: 'mal', name: 'Mallala complex', target_kph: 96, target_deg: 45,
        elements: [
            { k: 'clip', name: 'Inside clip', lat: rows[apex].lat, lon: rows[apex].lon, r: 3, max: 10 },
            { k: 'zone', name: 'Exit zone', pts: zpts, band: 4, max: 15 }
        ]
    })];
    gp.courseId = 'mal';
    console.log('   run  clip     zone     entry   angle    score');
    const cards = runs.map(r => API.gpDriftCard(r, API.gpCourseActive()));
    cards.forEach((c, i) => console.log('    ' + (i + 1) +
        (c.els[0].dist.toFixed(1) + ' m').padStart(8) +
        (Math.round(c.els[1].cover * 100) + '%').padStart(8) +
        (c.speed ? c.speed.pts.toFixed(1) : '—').padStart(8) +
        (c.angle ? c.angle.pts.toFixed(1) : 'n/m').padStart(8) +
        (c.got.toFixed(1) + ' / ' + c.max).padStart(13)));
    ok('the run the course was drawn on scores best on line',
       cards[3].els[0].pts + cards[3].els[1].pts >=
       Math.max.apply(null, cards.map(c => c.els[0].pts + c.els[1].pts)) - 0.01,
       'run 4 line ' + (cards[3].els[0].pts + cards[3].els[1].pts).toFixed(1));
    ok('every card is out of the same total when angle exists',
       cards.every(c => c.max === cards[0].max), 'out of ' + cards[0].max);
    ok('and the fastest entry takes the speed points', cards[4].speed.pts >= cards[0].speed.pts);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'passed all ' + pass) + ' checks');
process.exit(fail ? 1 : 0);
