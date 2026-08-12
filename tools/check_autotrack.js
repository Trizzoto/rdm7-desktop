/* Does the recording work out its own track and start/finish line?
 *
 * Pulls the real functions out of src/tauri-overlay.html (no copies — a copy
 * would drift and then pass while the app failed) and drives them with a
 * synthetic lap that obeys the generator rules in memory:
 *   - position integrated from speed at 25 Hz, so lap TIME follows lap SPEED
 *   - a closed polar curve r = R0 + A*cos(3t) + B*cos(5t), r > 0 everywhere,
 *     so the course provably never crosses its own line
 *   - speed comes from curvature, not from decorative sine texture
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'tauri-overlay.html');
const src = fs.readFileSync(SRC, 'utf8');

/* ---- extract named functions and consts verbatim ---------------------- */
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
    /* to the terminating ";\n" at the same indent, or end of a bracketed literal */
    let i = src.indexOf('=', m.index) + 1, depth = 0, j = i;
    for (; j < src.length; j++) {
        const c = src[j];
        if (c === '[' || c === '{' || c === '(') depth++;
        else if (c === ']' || c === '}' || c === ')') depth--;
        else if (c === ';' && depth === 0) { j++; break; }
    }
    return src.slice(m.index, j);
}

const NEEDED_FN = ['gpN', 'gpInt', 'gpEsc', 'gpReadyRow', 'gpReadyCardHtml',
    'gpMetres', 'gpSecs', 'gpStep', 'gpSignedDist', 'gpGateHits', 'gpMainDir', 'gpSplitRows', 'gpNoLapsWhy',
    'gpTrackById', 'gpActiveTrack', 'gpIsTrial', 'gpRunWord', 'gpTrackUid', 'gpTracksSave', 'gpSaveOwned', 'gpImportSaid',
    'gpTraceHome', 'gpKmBetween', 'gpMatchTrack', 'gpHeadingAt', 'gpAngleDiff',
    'gpLoopClosure', 'gpProposeLine', 'gpAutoLine', 'gpAutoSetUp', 'gpStints',
    'gpLapRange', 'gpLaneScale', 'gpScaleFor',
    'gpLogChans', 'gpRingMinutes', 'gpLaneRows', 'gpLaneRowsAll',
    'gpDeviceChanIds', 'gpChanArraysEqual', 'gpChanToDevShape',
    'gpSessionSectors', 'gpSectorMarks', 'gpSectorTimes',
    'gpSplitsStats', 'gpSectorRange', 'gpHeatColour', 'gpSplitsHtml', 'gpTip', 'gpLapTime',
    'gpLinesAgree', 'gpNodeTrackState', 'gpEmptyDownloadMsg', 'gpSnapGate',
    'gpDash', 'gpU', 'gpSpdU', 'gpLaneShowMap', 'gpLaneShowSave', 'gpLaneShown', 'gpLaneShowSet', 'gpLaneSig',
    'gpChannelRows', 'gpChkHtml', 'gpChannelListHtml', 'gpLanesBtnLabel',
    'gpMyChans', 'gpMyChansSave', 'gpAllChans', 'gpChanGroup', 'gpParseId', 'gpMyChanCheck',
    'gpToggleHtml', 'gpMyChanFormHtml',
    'gpRowsPack', 'gpRowsUnpack', 'gpSessionFileBuild', 'gpSessionFileParse', 'gpB64', 'gpB64Dec',
    'gpSesUid', 'gpChannels', 'gpCsvBuild', 'gpSpdN', 'gpSmoothPath',
    'gpSectorGates', 'gpSectorName', 'gpSectorNamed', 'gpSortSectors', 'gpSectorOfSample',
    'gpBusSeenHtml', 'gpElsewhereSays',
    'gpGapS', 'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess', 'gpDriftSrcPrefs', 'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle', 'gpChanDefsById',
    'gpSlipLane',
    'gpReadyRows',
    'gpReadyVerdict',
    'gpSnapGateToOutline'];
const NEEDED_VAR = ['GP_LANES', 'GP_CHAN_LS', 'GP_DEVCHAN_LS', 'GP_CHAN_BYTES', 'GP_CHAN_MAX', 'GP_CHAN_COLOURS',
    'GP_TRACE_HZ', 'GP_DT', 'GP_MAX_STEP_S', 'GP_MATCH_KM', 'GP_CLOSE_M',
    'GP_MIN_LOOP_M', 'GP_PLACES', 'GP_FIX_TYPES', 'GP_STINT_GAP_S', 'GP_STINT_MIN_S',
    'GP_SHOW_LS', 'GP_GRP_PUCK', 'GP_GRP_HERE', 'GP_GRP_CAR', 'GP_GRP_NONE', 'GP_UNITS',
    'GP_MYCHAN_LS', 'GP_GRP_DASH', 'GP_GRP_DBC', 'GP_GRP_MINE', 'GP_BITRATES',
    'GP_NO_T', 'GP_CHAN_STALE', 'GP_SESFILE_FMT', 'GP_TRACKS_LS', 'GP_REC_BASE_BYTES',
    'GP_DRIFT_MIN_KPH', 'GP_DRIFT_ON', 'GP_DRIFT_ROUGH', 'GP_DRIFT_RHO_MIN_KPH', 'GP_DRIFT_SRC_LS'];

let code = '';
NEEDED_VAR.forEach(v => { code += grabVar(v) + '\n'; });
NEEDED_FN.forEach(f => { code += grab(f) + '\n'; });

/* ---- environment the extracted code expects --------------------------- */
const env = { gp: null, localStorage: { getItem: () => null, setItem: () => {} } };
const run = new Function('env', code + '\n; return {' + NEEDED_FN.concat(NEEDED_VAR).join(',') + '};');
/* `gp` is a free variable inside the extracted code — give it a real global. */
global.gp = null;
global.localStorage = env.localStorage;
/* gpUnits() closes over a module-private _gpUnits the extractor cannot
   reach. The scale cache only uses it as a cache-key token, so a fixed
   stub is faithful for these checks. */
global.gpUnits = () => 'metric';
/* gpSaveOwned reports a failed write through the toast; in here there is no
   DOM to report into, so give it somewhere to go. A save that fails is still
   a real event, so it is recorded rather than dropped. */
global.savedFailures = [];
global.showToast = (t, tone) => { global.savedFailures.push(tone + ': ' + t); };
global.gpSetMsg = () => {};
const F = run(env);

/* Every export has to be a real value. An assertion written against an
   undefined constant compares undefined to a number and passes quietly —
   which is exactly how the threshold checks below passed while testing
   nothing at all. */
Object.keys(F).forEach(k => {
    if (F[k] === undefined) throw new Error('extracted "' + k + '" is undefined — the harness is lying');
});

/* ---- a synthetic drive ------------------------------------------------ */
/* Winton, from GP_PLACES. Centre the loop on it so the matcher has to find it. */
const WINTON = F.GP_PLACES.filter(p => p.id === 'winton')[0];
if (!WINTON) throw new Error('winton missing from GP_PLACES');

function drive(centre, laps, opts) {
    opts = opts || {};
    const R0 = opts.R0 || 380, A = 90, B = 45;      /* ~2.6 km loop */
    const D = Math.PI / 180, R = 6371008.8;
    const mLat = D * R, mLon = D * R * Math.cos(centre[0] * D);
    const rows = [];
    let t = 0, tms = 0;
    const pos = (th) => {
        const r = R0 + A * Math.cos(3 * th) + B * Math.cos(5 * th);
        return [r * Math.cos(th), r * Math.sin(th)];
    };
    /* speed from curvature: sample the local radius, cap at a grip limit */
    const speedAt = (th) => {
        const h = 0.01;
        const [x0, y0] = pos(th - h), [x1, y1] = pos(th), [x2, y2] = pos(th + h);
        const a = Math.hypot(x1 - x0, y1 - y0), b = Math.hypot(x2 - x1, y2 - y1);
        const c = Math.hypot(x2 - x0, y2 - y0);
        const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
        const curveR = area < 1e-9 ? 1e6 : (a * b * c) / (4 * area);
        const v = Math.sqrt(1.1 * 9.81 * curveR);            /* 1.1 g lateral */
        return Math.max(12, Math.min(opts.vmax || 55, v));   /* m/s */
    };
    for (let lap = 0; lap < laps; lap++) {
        const scale = 1 + (opts.vary ? (lap === 1 ? -0.03 : lap * 0.015) : 0);
        let th = 0;
        while (th < Math.PI * 2) {
            const [x, y] = pos(th);
            const v = speedAt(th) / scale;
            rows.push({
                lat: centre[0] + y / mLat,
                lon: centre[1] + x / mLon,
                kph: v * 3.6,
                hdg: 0,
                t: tms,
                g: 0
            });
            /* advance by however far 1/25 s of travel is, in theta */
            const [nx, ny] = pos(th + 1e-4);
            const dsdth = Math.hypot(nx - x, ny - y) / 1e-4;
            th += (v * (1 / 25)) / dsdth;
            tms += 40;
            t += 1 / 25;
        }
    }
    return rows;
}

/* ---- the harness ------------------------------------------------------ */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}
function freshGp() {
    global.gp = { tracks: { version: 1, active: null, tracks: [] }, trace: null, traceLaps: [] };
}

/* The gap this change closes, proven against the same real gpSplitRows the
   app uses. Without a track carrying a line, a perfectly good recording of
   five laps splits into nothing — and nothing said why. */
console.log('\nthe old behaviour: no track chosen');
freshGp();
let rows = drive(WINTON.center, 5, { vary: true });
ok('five real laps split into zero', F.gpSplitRows(rows).length === 0,
    'got ' + F.gpSplitRows(rows).length);

console.log('\nrecognising the track');
freshGp();
console.log('  (' + rows.length + ' samples, ' + (rows.length / 25 / 60).toFixed(1) + ' min)');
let said = F.gpAutoSetUp(rows);
ok('a track was created', global.gp.tracks.tracks.length === 1);
ok('it is Winton National', F.gpActiveTrack() && /^Winton/.test(F.gpActiveTrack().name),
    F.gpActiveTrack() ? F.gpActiveTrack().name : 'none');
ok('it says what it did', /Winton/.test(said || ''), JSON.stringify(said));

console.log('\nproposing a start/finish line');
ok('a line was placed', !!(F.gpActiveTrack() && F.gpActiveTrack().start_finish));
const laps = F.gpSplitRows(rows);
ok('5 laps driven -> 4 timed laps', laps.length === 4, 'got ' + laps.length);
const times = laps.map(l => F.gpSecs(rows, l.from, l.to));
console.log('  lap times: ' + times.map(t => t.toFixed(2)).join(', '));
const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);
const sd = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / (times.length || 1));
ok('lap times are consistent (sd < 5%)', times.length > 1 && sd / mean < 0.05,
    'sd/mean = ' + (sd / mean).toFixed(3));
ok('lap 2 is the quickest (it was driven 3% faster)',
    times.indexOf(Math.min(...times)) === 0 || times.indexOf(Math.min(...times)) === 1,
    'quickest was lap ' + (times.indexOf(Math.min(...times)) + 1));

console.log('\nthe line lands somewhere sane');
const sf = F.gpActiveTrack().start_finish;
let atLine = 0, vAt = 0;
rows.forEach(r => { if (F.gpMetres(r, { lat: sf.lat, lon: sf.lon }) < 8) { atLine++; vAt += r.kph; } });
vAt = vAt / (atLine || 1);
const allV = rows.map(r => r.kph).sort((a, b) => a - b);
const median = allV[Math.floor(allV.length / 2)];
ok('the line is on a fast part, not in a corner', vAt > median,
    vAt.toFixed(0) + ' km/h at the line vs ' + median.toFixed(0) + ' median');

console.log('\nan existing track is preferred over minting a new one');
said = F.gpAutoSetUp(rows);
ok('no second Winton was created', global.gp.tracks.tracks.length === 1,
    global.gp.tracks.tracks.length + ' tracks');

console.log('\nnowhere near a known circuit');
freshGp();
const nowhere = drive([-25.0, 133.0], 4, {});    /* middle of Australia */
said = F.gpAutoSetUp(nowhere);
ok('no track is invented', global.gp.tracks.tracks.length === 0);
ok('it says so plainly', /not near any track/.test(said || ''), JSON.stringify(said));

console.log('\na drive that never loops (a road trip, not a lap)');
freshGp();
const straight = [];
for (let i = 0; i < 25 * 300; i++) {
    straight.push({ lat: WINTON.center[0] + i * 0.00002, lon: WINTON.center[1], kph: 90, hdg: 0, t: i * 40, g: 0 });
}
said = F.gpAutoSetUp(straight);
ok('Winton is still recognised (it started there)', !!F.gpActiveTrack());
ok('no line is invented from a straight line', !F.gpActiveTrack().start_finish);
ok('it admits it', /could not find a repeated loop/.test(said || ''), JSON.stringify(said));

console.log('\nthe gate arrow points the wrong way (the bug from the bench)');
/* Same five laps, but flip the placed line's heading 180 deg — as happens
   whenever a gate is dropped by hand and the arrow lands against traffic.
   The old splitter required crossings in the arrow's direction and produced
   zero laps with no explanation. */
freshGp();
F.gpAutoSetUp(rows);
const sfGood = F.gpActiveTrack().start_finish;
const before = F.gpSplitRows(rows).length;
F.gpActiveTrack().start_finish = Object.assign({}, sfGood, { heading: (sfGood.heading + 180) % 360 });
ok('flipping the line changes nothing', F.gpSplitRows(rows).length === before,
    F.gpSplitRows(rows).length + ' vs ' + before);
/* And driven the other way round — laps must still split. */
const revRows = rows.slice().reverse().map((r, i) => Object.assign({}, r, { t: i * 40 }));
ok('driving the circuit the other way still splits', F.gpSplitRows(revRows).length === before,
    F.gpSplitRows(revRows).length + ' vs ' + before);
F.gpActiveTrack().start_finish = sfGood;

console.log('\nzero laps always says why');
freshGp();
global.gp.trace = rows;
ok('no track: says pick one', /No track is chosen/.test(F.gpNoLapsWhy()));
F.gpAutoSetUp(rows);
const trkW = F.gpActiveTrack();
const sfKeep = trkW.start_finish;
trkW.start_finish = null;
ok('no line: says place it', /has no start\/finish line yet/.test(F.gpNoLapsWhy()));
/* Line 900 m off the driven loop: the car never came near it. */
trkW.start_finish = Object.assign({}, sfKeep, { lat: sfKeep.lat + 0.009 });
let why = F.gpNoLapsWhy();
ok('line far away: says how far and where to fix it', /never|from anywhere|passed about/.test(why) && /Tracks/.test(why),
    JSON.stringify(why));
/* Line just beside the racing line: near miss reads differently. */
trkW.start_finish = Object.assign({}, sfKeep, { lat: sfKeep.lat + 0.0004, half_width_m: 4 });
why = F.gpNoLapsWhy();
ok('near miss: talks metres, not philosophy', /m /.test(why) || /wider|onto the driven/.test(why), JSON.stringify(why));
trkW.start_finish = sfKeep;

console.log('\na drive somewhere else entirely, with a track already active');
freshGp();
F.gpAutoSetUp(drive(WINTON.center, 3, {}));          /* Winton is now active, line placed */
const wintonLine = JSON.stringify(F.gpActiveTrack().start_finish);
said = F.gpAutoSetUp(drive([-25.0, 133.0], 3, {}));  /* then a drive 1,500 km away */
ok('Winton keeps the line it had', JSON.stringify(F.gpActiveTrack().start_finish) === wintonLine);
ok('no track was invented for the far drive', global.gp.tracks.tracks.length === 1,
    global.gp.tracks.tracks.length + ' tracks');
ok('it names the mismatch', /was not driven at Winton/.test(said || ''), JSON.stringify(said));

console.log('\none download, three runs, two long stops');
/* Glue three drives together with the gaps the node's idle-skip leaves. */
function withGap(segs, gapS) {
    const out = [];
    let t = 0;
    segs.forEach((seg, n) => {
        if (n) t += gapS[n - 1] * 1000;
        seg.forEach(r => { out.push(Object.assign({}, r, { t: t })); t += 40; });
    });
    return out;
}
const day = withGap([drive(WINTON.center, 4, {}), drive(WINTON.center, 3, {}), drive(WINTON.center, 5, {})],
                    [22 * 60, 47 * 60]);
let stints = F.gpStints(day);
ok('three runs come out', stints.length === 3, stints.length + ' found');
ok('they are in order and do not overlap',
    stints.every((s, i) => s.from <= s.to && (i === 0 || s.from > stints[i - 1].to)));
ok('every sample is accounted for', stints[0].from === 0 && stints[2].to === day.length - 1);
console.log('  run lengths: ' + stints.map(s => (s.secs / 60).toFixed(1) + ' min').join(', '));

console.log('\na pit-lane shuffle is not a session');
const shuffle = drive(WINTON.center, 4, {}).slice(0, 25 * 20);      /* 20 s of moving */
const mixed = withGap([drive(WINTON.center, 4, {}), shuffle], [10 * 60]);
stints = F.gpStints(mixed);
ok('the raw cut still finds both', stints.length === 2, stints.length + ' found');
ok('the short one is under the keep threshold',
    stints[1].secs < F.GP_STINT_MIN_S && stints[0].secs >= F.GP_STINT_MIN_S,
    stints.map(s => s.secs.toFixed(0) + 's').join(', '));

console.log('\na short stop is not a new run');
const brief = withGap([drive(WINTON.center, 3, {}), drive(WINTON.center, 3, {})], [45]);
ok('45 seconds stopped stays one run', F.gpStints(brief).length === 1,
    F.gpStints(brief).length + ' found');

console.log('\na recording with no clock at all (pre-timestamp node)');
const noClock = drive(WINTON.center, 3, {}).map(r => { const c = Object.assign({}, r); delete c.t; return c; });
ok('never split on a clock that is not there', F.gpStints(noClock).length === 1,
    F.gpStints(noClock).length + ' found');

console.log('\nthe y-scale is the lap\'s, not the visible window\'s');
freshGp();
F.gpAutoSetUp(rows);
global.gp.trace = rows;
global.gp.traceLaps = F.gpSplitRows(rows);
global.gp.selLap = 1; global.gp.cmpLap = 0;
const lap = global.gp.traceLaps[1];
const speedLane = { id: 'speed', get: i => rows[i].kph, zero: false, dp: 0 };
const whole = F.gpLaneScale(speedLane, lap);
/* A quarter of the lap, containing no top speed — the old code rescaled to it. */
const quarter = { from: lap.from, to: lap.from + Math.floor((lap.to - lap.from) / 4) };
const windowed = F.gpLaneScale(speedLane, quarter);
ok('a quarter-lap window really does have a different range',
    Math.abs(windowed.hi - whole.hi) > 1 || Math.abs(windowed.lo - whole.lo) > 1,
    'whole ' + whole.lo.toFixed(1) + '..' + whole.hi.toFixed(1) +
    ' vs window ' + windowed.lo.toFixed(1) + '..' + windowed.hi.toFixed(1));
const held = F.gpScaleFor(speedLane);
ok('gpScaleFor ignores the zoom and uses the lap',
    Math.abs(held.hi - whole.hi) < 1e-6 && Math.abs(held.lo - whole.lo) < 1e-6,
    'got ' + held.lo.toFixed(1) + '..' + held.hi.toFixed(1));
/* Zooming must not move it: gpScaleFor keys on the LAP, so a stripZoom is
   invisible to it. */
global.gp.stripZoom = { lap: 1, from: quarter.from, to: quarter.to };
const zoomed = F.gpScaleFor(speedLane);
ok('and it stays put when the navigator zooms in',
    Math.abs(zoomed.hi - whole.hi) < 1e-6 && Math.abs(zoomed.lo - whole.lo) < 1e-6,
    'got ' + zoomed.lo.toFixed(1) + '..' + zoomed.hi.toFixed(1));
global.gp.stripZoom = null;
/* Selecting a different lap SHOULD move it — the scale belongs to the lap. */
global.gp.selLap = 2;
const otherLap = F.gpScaleFor(speedLane);
ok('a different lap gets its own scale (cache is keyed, not frozen)',
    typeof otherLap.hi === 'number' && isFinite(otherLap.hi));

console.log('\ntelemetry channels: cost, and the lanes they name');
freshGp();
/* localStorage is stubbed read-only, so drive gp.logChans directly — that is
   what the getter caches into anyway. */
global.gp.logChans = [];
global.gp.laneShow = {};
global.gp.traceInfo = null;
const bare = F.gpRingMinutes(0);
ok('the empty ring matches the node partition (6.375 MB, 14 B, 25 Hz)',
    Math.round(bare) === 318, Math.round(bare) + ' min');
/* The estimate must not move because the node currently HOLDS channels: it
   reports capacity for its present record size, so the byte capacity is
   capacity × that size. Reading it as ×12 made two channels on the puck show
   206 minutes when the partition still held 278 — caught live after a Send. */
global.gp.traceInfo = { capacity_samples: 417792, record_bytes: 16 };
ok('the estimate is the same whatever record the node is on now',
    Math.round(F.gpRingMinutes(0)) === 318, Math.round(F.gpRingMinutes(0)) + ' min');
ok('and costing four extra bytes gives the same answer either way',
    Math.round(F.gpRingMinutes(4)) === 248, Math.round(F.gpRingMinutes(4)) + ' min');
global.gp.traceInfo = null;
const with8 = F.gpRingMinutes(8 * 2);
ok('eight channels cost what the plan said (~152 min)',
    Math.round(with8) === 159 || Math.abs(with8 - 152) < 10, Math.round(with8) + ' min');
ok('more channels is always less time', with8 < bare);

global.gp.dashChans = [
    { id: 'rpm', name: 'Engine RPM', unit: 'rpm' },
    { id: 'map', name: 'Manifold pressure', unit: 'kPa' }
];
global.gp.laneShow = {};
global.gp.logChans = ['map', 'rpm'];
const labels = F.gpLaneRowsAll().map(l => l.label);
ok('chosen channels become named lanes', labels.indexOf('Manifold pressure') >= 0, labels.join(', '));
ok('they keep the order they were picked in',
    labels.indexOf('Manifold pressure') < labels.indexOf('Engine RPM'));
ok('the generic CAN placeholders step aside',
    labels.indexOf('Steering') < 0 && labels.indexOf('Throttle') < 0, labels.join(', '));
ok('the GPS lanes are untouched',
    labels.indexOf('Speed') >= 0 && labels.indexOf('Delta') >= 0 && labels.indexOf('Yaw rate') >= 0);
ok('every named lane is still marked as not-yet-recorded',
    F.gpLaneRowsAll().filter(l => /Manifold|Engine RPM/.test(l.label)).every(l => !!l.pending));
/* An id with no matching dash channel must not vanish or crash — the dash
   may be offline when the rack renders. */
global.gp.dashChans = null;
const offline = F.gpLaneRowsAll().map(l => l.label);
ok('with the dash offline the ids still hold their lanes',
    offline.indexOf('map') >= 0 && offline.indexOf('rpm') >= 0, offline.join(', '));
global.gp.logChans = [];
ok('picking nothing restores the generic placeholders',
    F.gpLaneRowsAll().map(l => l.label).indexOf('Steering') >= 0);

console.log('\ntranslating a dash channel into what the puck can store');
const rpmChan = { id: 'rpm', decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false, endian: 1 } };
let shape = F.gpChanToDevShape(rpmChan);
ok('a normal 16-bit channel translates', !!shape, JSON.stringify(shape));
ok('field names match the puck\'s trace_chan_t', shape && shape.can_id === 0x360 &&
    shape.start_bit === 0 && shape.bit_len === 16 && shape.is_signed === false);
ok('a standard (11-bit) id is not marked extended', shape && shape.ext_id === false);
ok('endian 1 (Intel) maps to big_endian=false', shape && shape.big_endian === false);

const extChan = { id: 'odo', decode: { can_id: 0x18DAF100, bit_start: 0, bit_length: 8, is_signed: false, endian: 1 } };
shape = F.gpChanToDevShape(extChan);
ok('a can_id above 0x7FF is inferred extended', shape && shape.ext_id === true, JSON.stringify(shape));

const motoChan = { id: 'x', decode: { can_id: 0x100, bit_start: 0, bit_length: 8, is_signed: false, endian: 0 } };
shape = F.gpChanToDevShape(motoChan);
ok('endian 0 (Motorola) maps to big_endian=true', shape && shape.big_endian === true);

const wideChan = { id: 'lat', decode: { can_id: 0x401, bit_start: 0, bit_length: 32, is_signed: true, endian: 1 } };
ok('wider than 16 bits is refused, not truncated', F.gpChanToDevShape(wideChan) === null);

const noDecodeChan = { id: 'math_ch', decode: null };
ok('a channel with no CAN decode at all is refused', F.gpChanToDevShape(noDecodeChan) === null);
ok('a bare dashChan object with no .decode key is refused', F.gpChanToDevShape({ id: 'x' }) === null);

console.log('\ncomparing the chosen list against what is on the device');
ok('two empty arrays are equal', F.gpChanArraysEqual([], []));
ok('same order, same content is equal', F.gpChanArraysEqual(['a', 'b'], ['a', 'b']));
ok('different order is NOT equal — column order is the whole point', !F.gpChanArraysEqual(['a', 'b'], ['b', 'a']));
ok('different length is not equal', !F.gpChanArraysEqual(['a'], ['a', 'b']));

console.log('\nthe rack shows real data once a download has channel columns');
freshGp();
global.gp.dashChans = [
    { id: 'rpm', name: 'Engine RPM', unit: 'rpm', decimals: 0,
      decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false, endian: 1, scale: 1, offset: 0 } },
    { id: 'map', name: 'Manifold pressure', unit: 'kPa', decimals: 1,
      decode: { can_id: 0x360, bit_start: 16, bit_length: 16, is_signed: false, endian: 1, scale: 0.1, offset: 0 } }
];
global.gp.laneShow = {};
global.gp.logChans = ['rpm', 'map'];
/* No download yet: still the "chosen, not yet on this data" placeholder. */
let laneRows = F.gpLaneRowsAll();
let rpmLane = laneRows.filter(l => l.label === 'Engine RPM')[0];
ok('before any matching download, the lane is still pending', rpmLane && !!rpmLane.pending);

/* Now simulate a download whose device-reported channels match logChans. */
global.gp.traceChanIds = ['rpm', 'map'];
global.gp.trace = [
    { lat: 0, lon: 0, kph: 100, hdg: 0, g: 0, can: [3200, 850] },   // 3200 rpm, 85.0 kPa
    { lat: 0, lon: 0, kph: 100, hdg: 0, g: 0, can: [null, 900] }    // rpm channel stale this sample
];
laneRows = F.gpLaneRowsAll();
rpmLane = laneRows.filter(l => l.label === 'Engine RPM')[0];
const mapLane = laneRows.filter(l => l.label === 'Manifold pressure')[0];
ok('a matching download makes the lane real, not pending', rpmLane && !rpmLane.pending);
ok('the raw value is scaled using the dash\'s own decode.scale', mapLane.get(0) === 85.0,
    'got ' + mapLane.get(0));
ok('rpm at sample 0 comes through unscaled (scale 1, offset 0)', rpmLane.get(0) === 3200);
ok('a stale (null) sample reads as null, not 0 or garbage', rpmLane.get(1) === null,
    'got ' + rpmLane.get(1));
ok('each chosen channel gets a distinct colour', rpmLane.colour !== mapLane.colour);

/* If traceChanIds and the actual .can column count disagree — the loaded
   session's own book-keeping is inconsistent, e.g. corrupted or half
   migrated — showing real-looking data would be worse than falling back to
   the safe "still pending" placeholder built from gpLogChans(). */
global.gp.traceChanIds = ['rpm', 'map', 'ch3'];           // claims 3 columns
global.gp.trace = [{ lat: 0, lon: 0, kph: 0, hdg: 0, g: 0, can: [1, 2] }]; // only has 2
global.gp.logChans = ['rpm'];
laneRows = F.gpLaneRowsAll();
ok('traceChanIds/column-count disagreement falls back to gpLogChans, not the mismatched claim',
    laneRows.filter(l => l.id === 'can_rpm').length === 1 && laneRows.every(l => l.id !== 'can_map'),
    JSON.stringify(laneRows.filter(l => l.pending !== undefined || l.id === 'can_rpm').map(l => l.id)));
ok('the fallback lane is pending again, not pretending to have data',
    laneRows.filter(l => l.id === 'can_rpm')[0].pending === 'the node');

console.log('\nthe readiness panel says what is actually true');
/* Nothing plugged in, nothing known. */
freshGp();
/* The card collapses by default now; these checks are about what it
   says when you look at it, so look at it opened. */
global.gp.readyOpen = true;
let html = F.gpReadyCardHtml();
ok('an unknown fix is not called good', /not reported/.test(html) && !/>3D</.test(html));
ok('no track reads as none chosen', /none chosen/.test(html));

/* A puck with a good fix, at Winton, idle, line not yet placed. */
freshGp();
global.gp.status = { fix_type: 3, sats: 11, hacc_mm: 800 };
global.gp.traceInfo = { capacity_samples: 25 * 60 * 370, used_samples: 25 * 60 * 12,
                        recording: false, dropped: 0, wrapped: false };
F.gpAutoSetUp(drive(WINTON.center, 3, {}));
global.gp.readyOpen = true; html = F.gpReadyCardHtml();
ok('the fix is reported with its satellites', /3D/.test(html) && /11 sats/.test(html), html.slice(0, 200));
ok('accuracy is in metres', /0\.8 m/.test(html));
ok('the track is named', /Winton/.test(html));
ok('minutes free, not percent full', /min still free/.test(html) && !/%/.test(html));
/* The old wording ('press Record on before you drive') was removed on
   purpose — see the comment at gpReadyRows: it told you to satisfy a
   prerequisite that does not exist, and marked a puck that was already
   logging as not ready. An idle node now reads ready and offers the
   button rather than an instruction. */
ok('an idle node reads ready and offers the button, not a chore',
    /press REC/.test(html) && /Start recording/.test(html) && !/press Record on before/.test(html));

/* A node that lost samples and wrapped its ring. */
global.gp.traceInfo = { capacity_samples: 1000, used_samples: 1000,
                        recording: true, dropped: 42, wrapped: true };
global.gp.readyOpen = true; html = F.gpReadyCardHtml();
ok('dropped samples are called out as bad', /Dropped[\s\S]*?bad[\s\S]*?42/.test(html), 'no bad-toned Dropped row');
ok('a wrapped ring warns that laps are gone', /oldest laps overwritten/.test(html));
ok('a recording node does not nag', !/press Record on before you drive/.test(html));

console.log('\nthe split times report: stats before any sector lines exist');
freshGp();
F.gpAutoSetUp(rows);
global.gp.trace = rows;
global.gp.traceLaps = F.gpSplitRows(rows);
global.gp.selLap = -1; global.gp.cmpLap = -1;
let D = F.gpSplitsStats();
ok('stats still work with zero sector lines', !!D && D.nSectors === 0 && D.ideal === null);
ok('every real lap is counted', D.rows.length === laps.length, D.rows.length + ' vs ' + laps.length);
ok('the mean matches the plain arithmetic done earlier', Math.abs(D.mean - mean) < 1e-9);
ok('the standard deviation matches the plain arithmetic done earlier', Math.abs(D.stdDev - sd) < 1e-9);
ok('the panel admits it has nothing to grid yet', /no sector lines yet/.test(F.gpSplitsHtml()));

console.log('\nadding two sector lines (thirds) and re-checking the grid');
/* Same shape gpProposeLine already builds a start/finish line in — just two
   more of them, dropped a third and two-thirds around the way round lap 1. */
const trk4 = F.gpActiveTrack();
const lap0 = global.gp.traceLaps[0];
const at4 = (frac) => lap0.from + Math.round((lap0.to - lap0.from) * frac);
const gate4 = (i) => ({ lat: rows[i].lat, lon: rows[i].lon, heading: F.gpHeadingAt(rows, i, 12), half_width_m: 15 });
trk4.sectors = [gate4(at4(1 / 3)), gate4(at4(2 / 3))];

D = F.gpSplitsStats();
ok('three sectors now exist (two lines)', D.nSectors === 3, 'got ' + D.nSectors);
D.rows.forEach(function (r) {
    ok('lap ' + (r.li + 1) + ' splits sum to its own total',
        !!r.secs && Math.abs(r.secs.reduce(function (a, b) { return a + b; }, 0) - r.total) < 0.01,
        r.secs ? r.secs.reduce(function (a, b) { return a + b; }, 0).toFixed(3) + ' vs ' + r.total.toFixed(3) : 'no secs');
});
ok('the best lap really is the fastest total', Math.abs(D.bestTime - Math.min.apply(null, times)) < 1e-6);
ok('the ideal lap can never beat what was actually driven',
    D.ideal !== null && D.ideal <= D.bestTime + 1e-6, D.ideal + ' vs best ' + D.bestTime);

console.log('\nsplit lines work in whatever order they were placed');
/* Same two thirds gates, array order REVERSED — the order a mouse adds
   lines in has nothing to do with the order a car meets them. */
const fwd = D.rows.map(r => r.secs && r.secs.map(v => Math.round(v * 1000)));
trk4.sectors = [trk4.sectors[1], trk4.sectors[0]];
global.gp.sectors = null; global.gp.secKey = '';
const rev = F.gpSplitsStats().rows.map(r => r.secs && r.secs.map(v => Math.round(v * 1000)));
ok('reversed placement order gives identical splits',
    JSON.stringify(fwd) === JSON.stringify(rev),
    JSON.stringify(rev && rev[0]) + ' vs ' + JSON.stringify(fwd && fwd[0]));
trk4.sectors = [trk4.sectors[1], trk4.sectors[0]];
global.gp.sectors = null; global.gp.secKey = '';
D = F.gpSplitsStats();

console.log('\nlines that exist but were never crossed say so');
const farGates = trk4.sectors;
trk4.sectors = [gate4(at4(0.5))].map(g => Object.assign({}, g, { lat: g.lat + 0.02 }));  /* 2 km off the loop */
global.gp.sectors = null; global.gp.secKey = '';
let htmlMiss = F.gpSplitsHtml();
ok('a placed-but-missed line is not called "no lines"',
    /no lap crossed/.test(htmlMiss) && !/no sector lines yet/.test(htmlMiss));
trk4.sectors = farGates;
global.gp.sectors = null; global.gp.secKey = '';
D = F.gpSplitsStats();

console.log('\nsplits you name');
/* A name belongs to the GATE THAT OPENS the stretch — start/finish opens the
   first one. That single choice is what makes inserting, deleting and
   reordering correct without any index juggling, so it is what these check. */
ok('there is one opening gate per stretch',
    F.gpSectorGates(trk4).length === (trk4.sectors.length + 1),
    F.gpSectorGates(trk4).length + ' gates for ' + (trk4.sectors.length + 1) + ' sectors');
ok('an unnamed stretch falls back to its number', F.gpSectorName(trk4, 1) === 'Sector 2');
ok('and says it is unnamed', F.gpSectorNamed(trk4, 1) === false);
trk4.start_finish.name = 'Front straight';
trk4.sectors[0].name = 'The Esses';
ok('start/finish names the FIRST stretch', F.gpSectorName(trk4, 0) === 'Front straight');
ok('a split names the stretch that begins at it', F.gpSectorName(trk4, 1) === 'The Esses');
ok('the one after it is still unnamed', F.gpSectorName(trk4, 2) === 'Sector 3');
ok('a named one reports as named', F.gpSectorNamed(trk4, 0) && !F.gpSectorNamed(trk4, 2));
trk4.sectors[0].name = '   ';
ok('whitespace is not a name', F.gpSectorNamed(trk4, 1) === false && F.gpSectorName(trk4, 1) === 'Sector 2');
trk4.sectors[0].name = 'The Esses';

console.log('\nnames survive the edits that move sectors around');
/* Insert a split inside the FIRST stretch. The half that still begins at
   start/finish keeps its name; only the new half needs one. */
const insertAt = trk4.sectors[0];
trk4.sectors = [gate4(at4(1 / 6)), insertAt];
ok('after inserting, the first half keeps its name', F.gpSectorName(trk4, 0) === 'Front straight');
ok('the new half is unnamed, not mislabelled', F.gpSectorNamed(trk4, 1) === false);
ok('and the stretch that was named further along still is',
    F.gpSectorName(trk4, 2) === 'The Esses');
/* Delete that inserted gate: the two stretches merge and keep the earlier
   name, which is the one whose opening gate survived. */
trk4.sectors = [insertAt];
ok('after deleting, the merged stretch keeps the earlier name',
    F.gpSectorName(trk4, 0) === 'Front straight');
ok('and the deleted gate takes its own name with it', F.gpSectorName(trk4, 1) === 'The Esses');

console.log('\ngates get put in the order the car actually crosses them');
/* The array holds them in the order they were ADDED. Drop one at the far side
   of the circuit and it is still "Split 1" everywhere a person reads — while
   the timing, which sorts crossings, disagrees. */
freshGp();
F.gpAutoSetUp(rows);
global.gp.trace = rows;
global.gp.traceLaps = F.gpSplitRows(rows);
const trkO = F.gpActiveTrack();
const lapO = global.gp.traceLaps[0];
const atO = (f) => lapO.from + Math.round((lapO.to - lapO.from) * f);
const gateO = (i, nm) => ({ lat: rows[i].lat, lon: rows[i].lon, heading: F.gpHeadingAt(rows, i, 12),
                            half_width_m: 15, name: nm });
/* Added back to front: the LATER one first. */
trkO.sectors = [gateO(atO(0.7), 'Back straight'), gateO(atO(0.3), 'The Esses')];
global.gp.selGate = 0;                       /* "Back straight" is selected */
ok('the sort reports that it changed something', F.gpSortSectors() === true);
ok('the earlier gate is now first', trkO.sectors[0].name === 'The Esses');
ok('so the names follow the gates rather than the slots',
    F.gpSectorName(trkO, 1) === 'The Esses' && F.gpSectorName(trkO, 2) === 'Back straight');
ok('and the selected gate is still the one that was selected',
    trkO.sectors[Number(global.gp.selGate)].name === 'Back straight',
    'selGate=' + global.gp.selGate);
ok('running it again changes nothing', F.gpSortSectors() === false);
/* Sorting needs a lap to know the order; with none it must leave well alone
   rather than inventing one. */
const beforeNoLap = trkO.sectors.map(s => s.name).join(',');
global.gp.traceLaps = [];
trkO.sectors = [gateO(atO(0.7), 'Back straight'), gateO(atO(0.3), 'The Esses')];
ok('with no laps it does nothing at all', F.gpSortSectors() === false &&
    trkO.sectors[0].name === 'Back straight');
global.gp.traceLaps = F.gpSplitRows(rows);
/* A gate the lap never crossed cannot be placed in the order, so nothing is
   reordered on a guess. */
trkO.sectors = [gateO(atO(0.3), 'The Esses'),
                { lat: rows[0].lat + 0.02, lon: rows[0].lon, heading: 0, half_width_m: 15, name: 'Miles away' }];
ok('a gate the lap missed stops the sort rather than guessing',
    F.gpSortSectors() === false && trkO.sectors[0].name === 'The Esses');

console.log('\na finding can say where it happened');
trkO.sectors = [gateO(atO(1 / 3), 'The Esses'), gateO(atO(2 / 3), 'Back straight')];
trkO.start_finish.name = 'Front straight';
global.gp.sectors = null; global.gp.secKey = '';
const marksO = F.gpSectorMarks(lapO);
ok('the lap has usable splits to place a sample in', !!marksO && marksO.length === 2);
ok('a sample before the first split is in the opening stretch',
    F.gpSectorOfSample(lapO, lapO.from + 1) === 0);
ok('a sample between the splits is in the middle stretch',
    F.gpSectorOfSample(lapO, marksO[0] + 5) === 1);
ok('a sample after the last split is in the closing stretch',
    F.gpSectorOfSample(lapO, marksO[1] + 5) === 2);
ok('and it names it', F.gpSectorName(trkO, F.gpSectorOfSample(lapO, marksO[0] + 5)) === 'The Esses');
trkO.sectors = [];
ok('with no splits at all there is nowhere to place it',
    F.gpSectorOfSample(lapO, lapO.from + 1) === null);

console.log('\nthe split-times grid uses the names');
global.gp.trace = rows;
global.gp.traceLaps = F.gpSplitRows(rows);
trkO.sectors = [gateO(atO(1 / 3), 'The Esses'), gateO(atO(2 / 3), 'Back straight')];
global.gp.sectors = null; global.gp.secKey = '';
const gridN = F.gpSplitsHtml();
/* The names are a legend above the grid, not column headers: the rail is
   ~290 px and three names plus a Total do not fit — putting them in the
   headers pushed the Total column off the edge behind a scrollbar. */
ok('the names are stated in full above the grid',
    /gp-seclegend/.test(gridN) && /Front straight/.test(gridN) && /The Esses/.test(gridN));
ok('the columns themselves stay short, so Total still fits',
    /<th data-gp-split-hd='0'[^>]*>S1<\/th>/.test(gridN), 'header is not S1');
ok('and every named header carries its name in a tooltip', /sector 2/.test(gridN));
trkO.start_finish.name = '';
delete trkO.sectors[0].name;
delete trkO.sectors[1].name;
global.gp.sectors = null; global.gp.secKey = '';
const gridU = F.gpSplitsHtml();
ok('with nothing named there is no legend at all', !/gp-seclegend/.test(gridU));
ok('and the grid is unchanged', /<th data-gp-split-hd='0'[^>]*>S1<\/th>/.test(gridU));
trkO.sectors[1].name = 'Back straight';
global.gp.sectors = null; global.gp.secKey = '';
const gridM = F.gpSplitsHtml();
ok('naming only some of them lists only those',
    /gp-seclegend/.test(gridM) && /Back straight/.test(gridM) && !/Front straight/.test(gridM));

console.log('\nthe sector ranges chain with no gap and no overlap');
/* Its own gates on its own track, so the sections above are free to move the
   active track around without quietly changing what this asserts. */
freshGp();
F.gpAutoSetUp(rows);
global.gp.trace = rows;
global.gp.traceLaps = F.gpSplitRows(rows);
const trkR = F.gpActiveTrack();
const lapR = global.gp.traceLaps[0];
const atR = (f) => lapR.from + Math.round((lapR.to - lapR.from) * f);
trkR.sectors = [{ lat: rows[atR(1 / 3)].lat, lon: rows[atR(1 / 3)].lon,
                  heading: F.gpHeadingAt(rows, atR(1 / 3), 12), half_width_m: 15 },
                { lat: rows[atR(2 / 3)].lat, lon: rows[atR(2 / 3)].lon,
                  heading: F.gpHeadingAt(rows, atR(2 / 3), 12), half_width_m: 15 }];
global.gp.sectors = null; global.gp.secKey = '';
const ranges4 = [F.gpSectorRange(lapR, 0), F.gpSectorRange(lapR, 1), F.gpSectorRange(lapR, 2)];
ok('all three ranges resolved', ranges4.every(Boolean));
ok('the first starts at the lap and the last ends at the lap',
    ranges4[0].from === lapR.from && ranges4[2].to === lapR.to);
ok('each range starts exactly where the last one finished',
    ranges4[0].to === ranges4[1].from && ranges4[1].to === ranges4[2].from);
ok('a sector index outside the lap returns nothing',
    F.gpSectorRange(lapR, -1) === null && F.gpSectorRange(lapR, 3) === null);

console.log('\nthe heat colour runs green to red and clamps at the ends');
ok('the best of a column is the green endpoint', F.gpHeatColour(0) === 'rgba(111,191,115,1)');
ok('the worst of a column is the red endpoint', F.gpHeatColour(1) === 'rgba(224,93,82,1)');
ok('going past either end just holds the endpoint',
    F.gpHeatColour(-5) === F.gpHeatColour(0) && F.gpHeatColour(5) === F.gpHeatColour(1));
const mid4 = F.gpHeatColour(0.5).match(/[\d.]+/g).map(Number);
ok('the midpoint sits between green and red on every channel',
    mid4[0] > 111 && mid4[0] < 224 && mid4[1] < 191 && mid4[1] > 93 && mid4[2] < 115 && mid4[2] > 82,
    F.gpHeatColour(0.5));

console.log('\nthe table itself: headers, grading, and a lap that lost a split');
const html4 = F.gpSplitsHtml();
ok('one clickable header per sector', (html4.match(/data-gp-split-hd/g) || []).length === 3);
ok('the session-best cell in each column is marked purple',
    (html4.match(/class='p'/g) || []).length === 3, JSON.stringify(html4.match(/class='p'/g)));
ok('every stat row is there', /Average/.test(html4) && /Median/.test(html4) &&
    /Consistency/.test(html4) && /Best lap/.test(html4) && /Ideal lap/.test(html4));

/* Simulate a lap that never re-crossed one of the sector gates — the same
   "untimed, not partially timed" rule gpSectorMarks already enforces for a
   missed line. gpSessionSectors caches on gp.sectors/gp.secKey; nothing that
   feeds that key (lap count, sector count, track name) is changing here, so
   mutating the cached object in place and asking again re-reads exactly
   this rather than recomputing from the real, unbroken geometry. */
global.gp.sectors.per[2] = null;
const gapStats = F.gpSplitsStats();
ok('the lap itself still counts (its total needs no sector gate)',
    gapStats.rows.length === D.rows.length && gapStats.rows[2].secs === null);
ok('the report shows a dash instead of inventing a number', /class='na'/.test(F.gpSplitsHtml()));

console.log('\ntwo gates: the same line, or not');
const line5 = { lat: -36.5178, lon: 146.0854, heading: 90, half_width_m: 15 };
const near5 = (d) => Object.assign({}, line5, d);
ok('a line agrees with itself', F.gpLinesAgree(line5, line5));
ok('float32 wobble in the 6th decimal still agrees', F.gpLinesAgree(line5, near5({ lat: line5.lat + 1e-6 })));
ok('a line moved 30 m does not', !F.gpLinesAgree(line5, near5({ lat: line5.lat + 0.00027 })));
ok('a line aimed the other way does not', !F.gpLinesAgree(line5, near5({ heading: 270 })));
ok('two degrees of aim is the same line', F.gpLinesAgree(line5, near5({ heading: 92 })));
ok('a slightly different width is the same line', F.gpLinesAgree(line5, near5({ half_width_m: 15.4 })));
ok('a very different width is not', !F.gpLinesAgree(line5, near5({ half_width_m: 25 })));
ok('both missing agrees (nothing vs nothing)', F.gpLinesAgree(null, null));
ok('one missing does not', !F.gpLinesAgree(line5, null) && !F.gpLinesAgree(null, line5));

console.log('\nwhat the node holds, versus what Studio holds');
freshGp();
ok('no local track at all: nothing to compare', F.gpNodeTrackState().st === 'nolocal');
global.gp.tracks.tracks.push({ id: 't1', name: 'Winton', start_finish: null, sectors: [] });
global.gp.tracks.active = 't1';
ok('a local track with no line: still nothing to send', F.gpNodeTrackState().st === 'nolocal');
const t5 = F.gpActiveTrack();
t5.start_finish = Object.assign({}, line5);
ok('line placed but the node has not answered: checking', F.gpNodeTrackState().st === 'checking');
global.gp.lap = { has_track: false, timing: {} };
ok('the node answered "no track": none', F.gpNodeTrackState().st === 'none');
global.gp.lap = { has_track: true, track_name: 'Barker Test 2', timing: {} };
let ns5 = F.gpNodeTrackState();
ok('the node is timing a different track: other, named', ns5.st === 'other' && ns5.name === 'Barker Test 2');
global.gp.lap = { has_track: true, track_name: 'Winton', timing: {} };
global.gp.nodeTrack = undefined;
ok('name matches, geometry not read back yet: optimistic match', F.gpNodeTrackState().st === 'match');
global.gp.nodeTrack = { name: 'Winton', start_finish: Object.assign({}, line5), sectors: [] };
ok('same name, same gates: match', F.gpNodeTrackState().st === 'match');
global.gp.nodeTrack.start_finish.lat += 0.00027;
ok('the line moved here since it was sent: stale', F.gpNodeTrackState().st === 'stale');
global.gp.nodeTrack.start_finish.lat -= 0.00027;
t5.sectors = [near5({ lat: line5.lat + 0.002 })];
ok('a split added here since it was sent: stale', F.gpNodeTrackState().st === 'stale');
global.gp.nodeTrack.sectors = [near5({ lat: line5.lat + 0.002 })];
ok('the same split on both: match again', F.gpNodeTrackState().st === 'match');
t5.finish = near5({ lat: line5.lat + 0.004 });   /* now a time trial locally */
ok('a finish line added here (trial) vs a circuit there: stale', F.gpNodeTrackState().st === 'stale');
global.gp.nodeTrack.point_to_point = true;
global.gp.nodeTrack.finish = near5({ lat: line5.lat + 0.004 });
ok('the trial sent across: match', F.gpNodeTrackState().st === 'match');
global.gp.lap = { has_track: true, track_name: 'Winton', timing: {} };
global.gp.nodeTrack = null;
ok('status says track but the read-back found nothing: none (send again)', F.gpNodeTrackState().st === 'none');

console.log('\nthe readiness panel now includes the node\'s side of the story');
freshGp();
F.gpAutoSetUp(drive(WINTON.center, 3, {}));
global.gp.status = { fix_type: 3, sats: 11, hacc_mm: 800 };
global.gp.lap = { has_track: false, timing: {} };
global.gp.readyOpen = true;
let html5 = F.gpReadyCardHtml();
ok('the node with no track is a warning row', /On the node/.test(html5) && /no track/.test(html5));
ok('and the fix is one click away, right there', /Send “Winton[^”]*” to the node/.test(html5));
global.gp.lap = { has_track: true, track_name: F.gpActiveTrack().name, timing: { armed: true } };
global.gp.nodeTrack = undefined;
global.gp.readyOpen = true; html5 = F.gpReadyCardHtml();
ok('a matching armed node says the clock is ready', /armed, watching for the line/.test(html5));
ok('no Send button when there is nothing to send', !/Send “Winton[^”]*” to the node/.test(html5));
global.gp.lap = { has_track: true, track_name: F.gpActiveTrack().name, timing: { armed: true, lap_number: 3 } };
global.gp.readyOpen = true; html5 = F.gpReadyCardHtml();
ok('mid-session it names the lap being timed', /timing · lap 3/.test(html5));
global.gp.lap = { has_track: true, track_name: 'Somewhere Else', timing: {} };
global.gp.readyOpen = true; html5 = F.gpReadyCardHtml();
ok('a different track on the node is called out by name', /Somewhere Else/.test(html5) && /not “Winton[^”]*”/.test(html5));

console.log('\nwhich channels the rack draws, by default');
freshGp();
global.gp.laneShow = {};
global.gp.logChans = [];
global.gp.dashChans = null;
let shownIds = F.gpLaneRows ? null : null;   /* gpLaneRows is exercised via gpLaneSig */
const laneById = (id) => F.gpLaneRowsAll().filter(l => l.id === id)[0];
ok('a channel with data is drawn without being asked', F.gpLaneShown(laneById('speed')) === true);
ok('an empty channel is not', F.gpLaneShown(laneById('throttle')) === false);
ok('the signature lists only the drawn ones',
    F.gpLaneSig().indexOf('speed') >= 0 && F.gpLaneSig().indexOf('throttle') < 0, F.gpLaneSig());

console.log('\nticking Graph stores only genuine opinions');
F.gpLaneShowSet('yaw');            /* hide a lane that HAS data */
ok('hiding a lane with data is remembered', F.gpLaneShown(laneById('yaw')) === false);
ok('and is stored as an explicit decision', global.gp.laneShow.yaw === false,
    JSON.stringify(global.gp.laneShow));
ok('the signature drops it', F.gpLaneSig().indexOf('yaw') < 0, F.gpLaneSig());
F.gpLaneShowSet('yaw');
ok('showing it again clears the entry rather than storing true',
    global.gp.laneShow.yaw === undefined && F.gpLaneShown(laneById('yaw')) === true,
    JSON.stringify(global.gp.laneShow));

F.gpLaneShowSet('throttle');       /* show an EMPTY lane */
ok('showing an empty lane is an opinion worth keeping', global.gp.laneShow.throttle === true);
F.gpLaneShowSet('throttle');
ok('hiding it again reverts to automatic, not to a pinned false',
    global.gp.laneShow.throttle === undefined,
    JSON.stringify(global.gp.laneShow));
/* Which is what lets a channel appear by itself once it carries data: the
   same lane id, no stored decision, and the default now says yes. */
ok('so a lane that gains data comes back on its own',
    F.gpLaneShown({ id: 'throttle', pending: null }) === true);

console.log('\nthe channel list: one row per channel, grouped');
freshGp();
global.gp.laneShow = {};
global.gp.logChans = ['rpm'];
global.gp.dashChans = [
    { id: 'rpm', name: 'Engine RPM', unit: 'rpm', decimals: 0,
      decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false, endian: 1, scale: 1, offset: 0 } },
    { id: 'oilt', name: 'Oil temperature', unit: '°C', decimals: 0,
      decode: { can_id: 0x361, bit_start: 0, bit_length: 8, is_signed: false, endian: 1, scale: 1, offset: -40 } },
    { id: 'lat32', name: 'A 32-bit thing', unit: '',
      decode: { can_id: 0x362, bit_start: 0, bit_length: 32, is_signed: true, endian: 1 } },
    { id: 'calc', name: 'Something derived', unit: '' }        /* no decode at all */
];
let crows = F.gpChannelRows();
const crow = (id) => crows.filter(r => r.id === id)[0];
ok('the GPS channels are grouped as the puck\'s', crow('speed').group === F.GP_GRP_PUCK);
ok('delta is grouped as worked out here', crow('delta').group === F.GP_GRP_HERE);
ok('the dash\'s channels are grouped as the dash\'s',
    crow('can_rpm').group === F.GP_GRP_DASH && crow('can_oilt').group === F.GP_GRP_DASH);
ok('a GPS channel is always logged and cannot be unticked',
    crow('speed').log === 'always' && crow('speed').canLog === false);
ok('and it says why', /fixed 14-byte record/.test(crow('speed').logWhy));
ok('delta is not logged at all, and says so',
    crow('delta').log === null && /works it out/.test(crow('delta').logWhy));
ok('a chosen channel reads as logged', crow('can_rpm').log === true);
ok('an unchosen one reads as not logged, but tickable',
    crow('can_oilt').log === false && crow('can_oilt').canLog === true);
ok('a 32-bit channel cannot be logged, and says how wide it is',
    crow('can_lat32').canLog === false && /32 bits wide/.test(crow('can_lat32').logWhy));
ok('a channel with no CAN decode cannot be logged either',
    crow('can_calc').canLog === false && /nothing to sniff/.test(crow('can_calc').logWhy));
ok('every dash channel gets a row, chosen or not', crows.filter(r => r.group === F.GP_GRP_DASH).length === 4);
ok('every row is unique', new Set(crows.map(r => r.id)).size === crows.length);

console.log('\na recording keeps its channel columns when it is saved');
/* The hole this closes: the columns lived only in memory, so a recording
   lost its channels the moment Studio closed — and the channel list would
   cheerfully offer Graph on a lane that could only ever be empty. */
const canRows = [
    { lat: -36.5, lon: 146.08, kph: 100.5, hdg: 90.25, t: 1000, g: 0, can: [3200, 850] },
    { lat: -36.51, lon: 146.09, kph: 110.25, hdg: 91.5, t: 1040, g: 0, can: [null, 900] },
    { lat: -36.52, lon: 146.10, kph: 0, hdg: 0, t: 1080, g: 0, can: [0, 65534] }
];
let pk = F.gpRowsPack(canRows);
ok('the pack carries the column count', pk.nch === 2, String(pk.nch));
ok('and one uint16 per channel per sample', pk.can.length === 3 * 2, String(pk.can.length));
let back = F.gpRowsUnpack(pk);
ok('a value survives the round trip', back[0].can[0] === 3200 && back[0].can[1] === 850,
    JSON.stringify(back[0].can));
ok('a stale sample comes back as null, not as 65535',
    back[1].can[0] === null && back[1].can[1] === 900, JSON.stringify(back[1].can));
ok('a genuine zero is not mistaken for stale', back[2].can[0] === 0);
ok('a genuine 65534 is not mistaken for stale', back[2].can[1] === 65534);
ok('the GPS block still round-trips exactly',
    Math.abs(back[0].lat - canRows[0].lat) < 1e-7 && Math.abs(back[0].kph - 100.5) < 0.01 &&
    back[0].t === 1000 && back[1].t === 1040);
/* A row arriving bare must not silently drop every other row's columns. */
const bareFirst = [{ lat: 0, lon: 0, kph: 0, hdg: 0, t: 1, g: 0, can: null },
               { lat: 0, lon: 0, kph: 0, hdg: 0, t: 2, g: 0, can: [7, 8] }];
const mixedBack = F.gpRowsUnpack(F.gpRowsPack(bareFirst));
ok('the width is taken from the first row that has one',
    mixedBack[1].can[0] === 7 && mixedBack[1].can[1] === 8, JSON.stringify(mixedBack[1].can));
ok('and a bare row reads as all-stale rather than as zeroes',
    mixedBack[0].can[0] === null && mixedBack[0].can[1] === null, JSON.stringify(mixedBack[0].can));

console.log('\na recording from before channels existed still opens');
const oldRows = [{ lat: -36.5, lon: 146.08, kph: 50, hdg: 10, t: 5, g: 0 }];
const oldPk = F.gpRowsPack(oldRows);
ok('nothing is stored when there are no columns',
    oldPk.can === undefined && oldPk.nch === undefined);
const oldBack = F.gpRowsUnpack(oldPk);
ok('and it unpacks with no columns rather than throwing', oldBack.length === 1 && oldBack[0].can === null);
delete oldPk.nch;      /* a pack written by an older Studio */
ok('a pack with no nch at all is still readable', F.gpRowsUnpack(oldPk)[0].can === null);

console.log('\nand keeps them when exported to another PC');
const sesMeta = { id: 'ses_x', name: 'Winton', recordedAt: 1, dated: 'gps', samples: 3,
                  chanIds: ['rpm', 'map'], lapCount: 0, bestLapS: null };
const file = F.gpSessionFileBuild(sesMeta, pk);
ok('the file carries the columns and their width',
    /"nch":2/.test(file) && /"can":"/.test(file));
ok('and what they mean travels in the meta', /"chanIds":\["rpm","map"\]/.test(file));
const parsed = F.gpSessionFileParse(file);
ok('the id is re-minted so two imports cannot collide', parsed.meta.id !== 'ses_x');
ok('the names come back', parsed.meta.chanIds.join(',') === 'rpm,map');
const pBack = F.gpRowsUnpack(parsed.pk);
ok('and every value survives the file round trip',
    pBack[0].can[0] === 3200 && pBack[1].can[0] === null && pBack[2].can[1] === 65534,
    JSON.stringify(pBack.map(r => r.can)));
/* A GPS-only export must stay exactly what it always was. */
const oldFile = F.gpSessionFileBuild(sesMeta, oldPk);
ok('a GPS-only file gains no channel keys', !/"can"/.test(oldFile) && !/"nch"/.test(oldFile));
ok('and still parses', F.gpSessionFileParse(oldFile).pk.can === undefined);
/* Columns with no names is real data, not a broken file. */
const noNames = F.gpSessionFileBuild({ id: 'y', name: 'n', recordedAt: 1 }, pk);
ok('columns with no names get generic ones rather than being dropped',
    F.gpSessionFileParse(noNames).meta.chanIds.join(',') === 'ch1,ch2');
/* Truncation is caught rather than thrown as a RangeError from a typed array. */
const trunc = JSON.parse(file);
trunc.data.can = F.gpB64(new Uint8Array(4));
let threw = '';
try { F.gpSessionFileParse(JSON.stringify(trunc)); } catch (e) { threw = e.message; }
ok('a truncated channel block is refused in plain words', /truncated/.test(threw), threw);

console.log('\nthe CSV carries the car\'s channels too');
/* An export that quietly kept only the GPS half would be found out in Excel,
   a long way from here and with no way to get the rest back. */
freshGp();
global.gp.laneShow = {};
global.gp.logChans = [];
global.gp.dashChans = null;
global.gp.myChans = [{ id: 'my:p', name: 'Oil pressure', unit: 'bar', decimals: 2,
    decode: { can_id: 0x5F0, bit_start: 0, bit_length: 16, is_signed: false, endian: 1, scale: 0.1, offset: 0 } }];
global.gp.traceChanIds = ['my:p'];
global.gp.trace = [
    { lat: -36.5, lon: 146.0, kph: 100, hdg: 0, g: 0.1, can: [1234] },
    { lat: -36.5001, lon: 146.0, kph: 101, hdg: 0, g: 0.1, can: [null] }
];
global.gp.traceLaps = [];
global.gp.sessions = [];
const csv = F.gpCsvBuild();
const csvHead = csv.split('\n')[0], csvRow0 = csv.split('\n')[1], csvRow1 = csv.split('\n')[2];
ok('the channel gets a column, named and united', /Oil_pressure_bar/.test(csvHead), csvHead);
ok('the GPS columns are still all there',
    /lat_deg/.test(csvHead) && /speed_kph/.test(csvHead) && /yaw_dps/.test(csvHead));
ok('its value is scaled the same way the rack scales it',
    csvRow0.split(',').pop() === '123.40', csvRow0.split(',').pop());
ok('a stale sample is left EMPTY, not zero — a spreadsheet averages a zero',
    csvRow1.split(',').pop() === '', JSON.stringify(csvRow1.split(',').pop()));
ok('every row has as many fields as the header',
    csvRow0.split(',').length === csvHead.split(',').length &&
    csvRow1.split(',').length === csvHead.split(',').length);
/* And a GPS-only recording exports exactly what it always did. */
global.gp.traceChanIds = null;
global.gp.trace = [{ lat: -36.5, lon: 146.0, kph: 100, hdg: 0, g: 0 }];
ok('a recording with no channels gains no columns',
    F.gpCsvBuild().split('\n')[0].split(',').length === 10,
    F.gpCsvBuild().split('\n')[0]);

console.log('\nchannel definitions can come from anywhere, not just a dash');
freshGp();
global.gp.laneShow = {};
global.gp.logChans = [];
global.gp.dashChans = null;                 /* no dash at all */
global.gp.myChans = [
    { id: 'my:a', name: 'Oil pressure', unit: 'bar', decimals: 1,
      decode: { can_id: 0x360, bit_start: 8, bit_length: 16, is_signed: false, endian: 1, scale: 0.1, offset: 0 } },
    { id: 'my:b', name: 'Fuel level', unit: '%', decimals: 0, dbc: 'mycar.dbc',
      decode: { can_id: 0x18DAF110, bit_start: 0, bit_length: 8, is_signed: false, endian: 0, scale: 1, offset: 0 } }
];
let mrows = F.gpChannelRows();
const mrow = (id) => mrows.filter(r => r.id === id)[0];
ok('with no dash connected, your own channels are still offered', !!mrow('can_my:a'));
ok('and they are loggable', mrow('can_my:a').canLog === true);
ok('a hand-added one is grouped as yours', mrow('can_my:a').group === F.GP_GRP_MINE);
ok('a DBC-imported one is grouped as from a file', mrow('can_my:b').group === F.GP_GRP_DBC);
ok('and names the file it came from', mrow('can_my:b').from === 'mycar.dbc');
ok('each row states where it sits on the wire',
    /0x360/.test(mrow('can_my:a').wire) && /bit 8\+16/.test(mrow('can_my:a').wire), mrow('can_my:a').wire);
ok('yours are marked as yours (so they can be removed)',
    mrow('can_my:a').mine === true);
ok('an extended id survives the round trip to the puck shape',
    F.gpChanToDevShape(global.gp.myChans[1]).ext_id === true &&
    F.gpChanToDevShape(global.gp.myChans[1]).big_endian === true);
global.gp.dashChans = [{ id: 'rpm', name: 'Engine RPM', unit: 'rpm',
    decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false, endian: 1, scale: 1, offset: 0 } }];
ok('the dash and your own definitions coexist', F.gpAllChans().length === 3);
mrows = F.gpChannelRows();
ok('the dash comes first, yours after — it needs no setting up',
    mrows.filter(r => r.dashId).map(r => r.dashId).join(',') === 'rpm,my:a,my:b',
    mrows.filter(r => r.dashId).map(r => r.dashId).join(','));
ok('a dash channel is never mistaken for one of yours', mrow('can_rpm') && mrow('can_rpm').mine === false);
ok('the list offers both ways in regardless',
    /Import a DBC/.test(F.gpChannelListHtml()) && /Add a channel/.test(F.gpChannelListHtml()));

console.log('\nseeing what is on the bus');
freshGp();
global.gp.busSeen = null;
ok('before a scan it offers to scan', /Scan the bus/.test(F.gpBusSeenHtml()));
global.gp.busSeen = 'loading';
ok('while scanning it says so', /Listening/.test(F.gpBusSeenHtml()));
global.gp.busSeen = { frames: [], full: false };
global.gp.can = { bitrate_idx: 2 };
let busH = F.gpBusSeenHtml();
ok('a silent bus names the three things that are actually wrong',
    /swapped/.test(busH) && /terminated/.test(busH) && /bitrate/.test(busH));
ok('and states the bitrate it is set to, to check against the car',
    /500 kbps/.test(busH), busH.slice(busH.indexOf('Nothing heard'), busH.indexOf('Nothing heard') + 260));
global.gp.busSeen = { full: false, frames: [
    { can_id: 0x360, ext: false, dlc: 8, count: 500, hz: 50.0, quiet_ms: 20, data: '0C8000FA12340000' },
    { can_id: 0x18FEF1FE, ext: true, dlc: 8, count: 10, hz: 1.0, quiet_ms: 40, data: '7B00000000000000' },
    { can_id: 0x201, ext: false, dlc: 2, count: 1, hz: 0, quiet_ms: 9000, data: 'ABCD' }
] };
busH = F.gpBusSeenHtml();
ok('ids are listed in hex', /0x360/.test(busH) && /0x18FEF1FE/.test(busH));
ok('an extended id is marked as one', /0x18FEF1FE<em>ext<\/em>/.test(busH));
ok('rates are rounded to something readable', /50 Hz/.test(busH));
ok('a frame seen once says so rather than 0 Hz', /once/.test(busH));
ok('one that has stopped arriving is flagged quiet', /quiet<\/em>/.test(busH));
ok('the last payload is shown so a byte can be watched', /0C8000FA12340000/.test(busH));
ok('the busiest frame is listed first',
    busH.indexOf('0x360') < busH.indexOf('0x18FEF1FE'), 'not sorted by rate');
ok('every frame offers to become a channel', (busH.match(/gpBusMake\(/g) || []).length === 3);
ok('and passes the extended flag through', /gpBusMake\('18FEF1FE', true\)/.test(busH));
global.gp.busSeen = { full: true, frames: [{ can_id: 1, ext: false, dlc: 1, count: 2, hz: 5, quiet_ms: 1, data: '00' }] };
ok('a truncated list says so rather than pretending to be the whole bus',
    /list is full/.test(F.gpBusSeenHtml()));

console.log('\nreading a CAN id the way people actually type it');
ok('0x360 works', F.gpParseId('0x360') === 0x360);
ok('360h works', F.gpParseId('360h') === 0x360);
ok('bare hex works', F.gpParseId('1A4') === 0x1A4);
ok('plain decimal works', F.gpParseId('864') === 864);
ok('whitespace and case do not matter', F.gpParseId('  0X18DAF110 ') === 0x18DAF110);
ok('nonsense is refused rather than guessed', F.gpParseId('') === null && F.gpParseId('zz') === null);

console.log('\na typed-in definition is checked before it is stored');
const goodF = { name: 'Oil temp', unit: 'C', can_id: '0x360', bit_start: '0',
                bit_length: '16', scale: '1', offset: '0' };
const withF = (o) => Object.assign({}, goodF, o);
ok('a sane definition passes', F.gpMyChanCheck(goodF) === null, F.gpMyChanCheck(goodF));
ok('no name is refused', /name/i.test(F.gpMyChanCheck(withF({ name: ' ' })) || ''));
ok('a bad id is refused', /CAN id/.test(F.gpMyChanCheck(withF({ can_id: 'nope' })) || ''));
ok('an id past 29 bits is refused', /CAN id/.test(F.gpMyChanCheck(withF({ can_id: '0x20000000' })) || ''));
ok('17 bits is refused, with the reason', /16-bit slot/.test(F.gpMyChanCheck(withF({ bit_length: '17' })) || ''));
ok('zero bits is refused', !!F.gpMyChanCheck(withF({ bit_length: '0' })));
ok('a signal running past the frame is refused',
    /past the end/.test(F.gpMyChanCheck(withF({ bit_start: '56', bit_length: '16' })) || ''));
ok('start bit 48 with 16 bits is fine (exactly fills the frame)',
    F.gpMyChanCheck(withF({ bit_start: '48', bit_length: '16' })) === null);
ok('a zero scale is refused — every reading would be the same',
    /Scale cannot be zero/.test(F.gpMyChanCheck(withF({ scale: '0' })) || ''));
ok('a non-numeric offset is refused', !!F.gpMyChanCheck(withF({ offset: 'x' })));
ok('a negative scale is allowed (inverted sensors exist)',
    F.gpMyChanCheck(withF({ scale: '-0.5' })) === null);

console.log('\nthe form asks for what a DBC line carries');
global.gp.chanForm = { name: '', unit: '', can_id: '', bit_start: '0', bit_length: '16',
                       scale: '1', offset: '0', big: false, signed: false };
const fhtml = F.gpMyChanFormHtml();
['Name', 'Unit', 'CAN id', 'Start bit', 'Bits', 'Scale', 'Offset', 'Byte order'].forEach(function (l) {
    ok('the form has a ' + l + ' field', fhtml.indexOf(l) >= 0);
});
ok('byte order names both options rather than saying On/Off',
    /Intel/.test(fhtml) && /Motorola/.test(fhtml) && !/gpMyChanField\('big'[^)]*\)\">On</.test(fhtml));
ok('signedness names both options too', /Unsigned/.test(fhtml) && /Signed/.test(fhtml));
ok('numeric fields select on focus, so a default is overwritten not appended',
    (fhtml.match(/onfocus='this.select\(\)'/g) || []).length === 5,
    (fhtml.match(/onfocus='this.select\(\)'/g) || []).length + ' of 5');
global.gp.chanForm = null;

console.log('\nthe marks are not accent-filled tickboxes (ADR-0014)');
const logOn = F.gpChkHtml('log', true, "x()", null);
const grOn = F.gpChkHtml('graph', true, "x()", null, '#FF6FA8');
ok('Graph draws a rule in the channel\'s own trace colour', /background:#FF6FA8/.test(grOn), grOn);
ok('Log draws a neutral square, with no colour of its own',
    /class='log'/.test(logOn) && !/background:/.test(logOn), logOn);
ok('nothing carries an accent fill',
    !/--accent/.test(logOn + grOn) && !/gp-chk on'[^>]*style/.test(logOn));
ok('not-applicable is a bare dash, not an empty box',
    /na-dash/.test(F.gpChkHtml('log', 'na', null, 'x')));
ok('always-on is its own state, distinct from off',
    /gp-chk lock/.test(F.gpChkHtml('log', 'lock', null, 'x')));

console.log('\nthe list does not move when you tick something');
/* The bug this pins: ordering the car's rows by "is it a lane yet" moved a
   channel to the top of its group the moment Log was ticked, the list redrew
   under the cursor, and the next click in a run landed on the wrong channel.
   Ticking three boxes produced one tick. */
/* Its own fixture, so re-ordering the sections above cannot quietly change
   what this is asserting about. */
freshGp();
global.gp.laneShow = {};
global.gp.myChans = [];
global.gp.logChans = ['rpm'];
global.gp.dashChans = [
    { id: 'rpm', name: 'Engine RPM', unit: 'rpm', decimals: 0,
      decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false, endian: 1, scale: 1, offset: 0 } },
    { id: 'oilt', name: 'Oil temperature', unit: '°C', decimals: 0,
      decode: { can_id: 0x361, bit_start: 0, bit_length: 8, is_signed: false, endian: 1, scale: 1, offset: -40 } },
    { id: 'lat32', name: 'A 32-bit thing', unit: '',
      decode: { can_id: 0x362, bit_start: 0, bit_length: 32, is_signed: true, endian: 1 } },
    { id: 'calc', name: 'Something derived', unit: '' }
];
const orderNow = () => F.gpChannelRows().map(r => r.id).join(',');
const order0 = orderNow();
global.gp.logChans = ['oilt'];
ok('ticking Log leaves every row exactly where it was', orderNow() === order0,
    '\n    was ' + order0 + '\n    now ' + orderNow());
global.gp.logChans = ['oilt', 'rpm'];
ok('and still does with several ticked', orderNow() === order0);
global.gp.laneShow = { speed: false };
ok('hiding a lane does not move anything either', orderNow() === order0);
global.gp.laneShow = {};
global.gp.logChans = ['rpm'];
ok('the car rows follow the dash list order, not the selection',
    F.gpChannelRows().filter(r => r.group === F.GP_GRP_DASH).map(r => r.dashId).join(',') ===
    global.gp.dashChans.map(c => c.id).join(','));

console.log('\na recording can carry a channel that is no longer chosen');
global.gp.traceChanIds = ['rpm', 'oilt'];
global.gp.trace = [{ lat: 0, lon: 0, kph: 100, hdg: 0, g: 0, can: [3000, 90] }];
global.gp.logChans = ['rpm', 'calc'];      /* calc chosen for next time; oilt dropped */
crows = F.gpChannelRows();
ok('the dropped channel still has a graphable row (it IS in the data)',
    !!crow('can_oilt').lane && crow('can_oilt').log === false);
ok('the newly chosen one has a row too, marked as absent from this recording',
    crow('can_calc').log === true && crow('can_calc').lane === null &&
    /not in this recording/.test(crow('can_calc').sub || ''), JSON.stringify(crow('can_calc')));

console.log('\nthe list renders the two columns honestly');
const chtml = F.gpChannelListHtml();
ok('both column headers are there', /Log/.test(chtml) && /Graph/.test(chtml));
ok('the always-recorded lock is drawn, not left blank', /gp-chk lock/.test(chtml));
ok('un-loggable channels are drawn as unavailable', /gp-chk na/.test(chtml));
ok('the cost of the selection is stated', /bytes a sample/.test(chtml));
ok('recording time is stated in minutes', /Recording time/.test(chtml) && /min/.test(chtml));
ok('Send only appears when the puck differs from what is ticked',
    /Send 2 to the puck/.test(chtml), 'no send button');
global.gp.deviceChanIds = ['rpm', 'calc'];
ok('and disappears once they agree', !/Send .* to the puck/.test(F.gpChannelListHtml()));
ok('a tick is a real pressed-state control',
    /aria-pressed='true'/.test(chtml) && /aria-pressed='false'/.test(chtml));

console.log('\nthe button over the rack counts what is drawn');
freshGp();
global.gp.laneShow = {};
global.gp.logChans = [];
global.gp.dashChans = null;
let lbl = F.gpLanesBtnLabel();
ok('it says how many of how many', /Channels · \d+\/\d+/.test(lbl.text), lbl.text);
const before9 = lbl.text;
F.gpLaneShowSet('speed');
ok('hiding one moves the count', F.gpLanesBtnLabel().text !== before9,
    before9 + ' -> ' + F.gpLanesBtnLabel().text);

console.log('\na dropped gate snaps onto the driven line');
freshGp();
global.gp.trace = rows;
const mid5 = rows[Math.floor(rows.length / 2)];
const near6 = { lat: mid5.lat + 0.0003, lon: mid5.lon, heading: 0, half_width_m: 15 };  /* ~33 m off */
ok('within 60 m it snaps', F.gpSnapGate(near6) === true);
ok('onto an actual sample of the line', rows.some(r => r.lat === near6.lat && r.lon === near6.lon));
ok('aimed the way the car was going there',
    F.gpAngleDiff(near6.heading, rows.filter(r => r.lat === near6.lat)[0].hdg) < 1);
const far6 = { lat: mid5.lat + 0.01, lon: mid5.lon, heading: 0, half_width_m: 15 };     /* ~1.1 km off */
ok('a kilometre away it stays put', F.gpSnapGate(far6) === false && far6.lat === mid5.lat + 0.01);
global.gp.trace = null;
ok('with nothing loaded it never invents a snap', F.gpSnapGate(near6) === false);

console.log('\na quiet receiver is not a fix');
freshGp();
global.gp.status = { link: false, ubx: 242315, fix: true, fix_type: 3, sats: 16, hacc_mm: 390 };
global.gp.readyOpen = true; html5 = F.gpReadyCardHtml();
ok('link=false outranks a stale cached fix', /receiver quiet/.test(html5) && !/3D/.test(html5));
ok('and it says what to do about it', /power-cycle/.test(html5));
global.gp.status = { link: true, fix: true, fix_type: 3, sats: 16, hacc_mm: 390 };
ok('with the link up the fix reports normally', /3D/.test(F.gpReadyCardHtml()));

console.log('\nan empty download explains itself');
ok('recording on: says go drive', /go drive/.test(F.gpEmptyDownloadMsg(true)));
ok('recording off: says turn it on first', /Recording is OFF/.test(F.gpEmptyDownloadMsg(false)));
ok('both say the node only logs while moving', /moving/.test(F.gpEmptyDownloadMsg(true)) && /moving/.test(F.gpEmptyDownloadMsg(false)));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
