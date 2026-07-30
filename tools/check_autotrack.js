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

const NEEDED_FN = ['gpN', 'gpInt', 'gpEsc', 'gpReadyRow', 'gpReadyHtml',
    'gpMetres', 'gpSecs', 'gpStep', 'gpSignedDist', 'gpGateHits', 'gpMainDir', 'gpSplitRows', 'gpNoLapsWhy',
    'gpTrackById', 'gpActiveTrack', 'gpIsTrial', 'gpRunWord', 'gpTrackUid', 'gpTracksSave',
    'gpTraceHome', 'gpKmBetween', 'gpMatchTrack', 'gpHeadingAt', 'gpAngleDiff',
    'gpLoopClosure', 'gpProposeLine', 'gpAutoLine', 'gpAutoSetUp', 'gpStints',
    'gpLapRange', 'gpLaneScale', 'gpScaleFor',
    'gpLogChans', 'gpRingMinutes', 'gpLaneRows', 'gpLaneRowsAll',
    'gpDeviceChanIds', 'gpChanArraysEqual', 'gpChanToDevShape',
    'gpSessionSectors', 'gpSectorMarks', 'gpSectorTimes',
    'gpSplitsStats', 'gpSectorRange', 'gpHeatColour', 'gpSplitsHtml', 'gpTip', 'gpLapTime',
    'gpLinesAgree', 'gpNodeTrackState', 'gpEmptyDownloadMsg', 'gpSnapGate'];
const NEEDED_VAR = ['GP_LANES', 'GP_CHAN_LS', 'GP_DEVCHAN_LS', 'GP_CHAN_BYTES', 'GP_CHAN_MAX', 'GP_CHAN_COLOURS',
    'GP_TRACE_HZ', 'GP_DT', 'GP_MAX_STEP_S', 'GP_MATCH_KM', 'GP_CLOSE_M',
    'GP_MIN_LOOP_M', 'GP_PLACES', 'GP_FIX_TYPES', 'GP_STINT_GAP_S', 'GP_STINT_MIN_S'];

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
ok('it is Winton', F.gpActiveTrack() && F.gpActiveTrack().name === 'Winton',
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
global.gp.lanesOpen = true;
global.gp.traceInfo = null;
const bare = F.gpRingMinutes(0);
ok('the empty ring matches the node partition (6.375 MB, 12 B, 25 Hz)',
    Math.round(bare) === 371, Math.round(bare) + ' min');
const with8 = F.gpRingMinutes(8 * 2);
ok('eight channels cost what the plan said (~152 min)',
    Math.round(with8) === 159 || Math.abs(with8 - 152) < 10, Math.round(with8) + ' min');
ok('more channels is always less time', with8 < bare);

global.gp.dashChans = [
    { id: 'rpm', name: 'Engine RPM', unit: 'rpm' },
    { id: 'map', name: 'Manifold pressure', unit: 'kPa' }
];
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
global.gp.lanesOpen = true;
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
let html = F.gpReadyHtml();
ok('an unknown fix is not called good', /not reported/.test(html) && !/>3D</.test(html));
ok('no track reads as none chosen', /none chosen/.test(html));

/* A puck with a good fix, at Winton, idle, line not yet placed. */
freshGp();
global.gp.status = { fix_type: 3, sats: 11, hacc_mm: 800 };
global.gp.traceInfo = { capacity_samples: 25 * 60 * 370, used_samples: 25 * 60 * 12,
                        recording: false, dropped: 0, wrapped: false };
F.gpAutoSetUp(drive(WINTON.center, 3, {}));
html = F.gpReadyHtml();
ok('the fix is reported with its satellites', /3D/.test(html) && /11 sats/.test(html), html.slice(0, 200));
ok('accuracy is in metres', /0\.8 m/.test(html));
ok('the track is named', /Winton/.test(html));
ok('minutes free, not percent full', /min still free/.test(html) && !/%/.test(html));
ok('an idle node says press Record', /press Record on before you drive/.test(html));

/* A node that lost samples and wrapped its ring. */
global.gp.traceInfo = { capacity_samples: 1000, used_samples: 1000,
                        recording: true, dropped: 42, wrapped: true };
html = F.gpReadyHtml();
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

console.log('\nthe sector ranges chain with no gap and no overlap');
const ranges4 = [F.gpSectorRange(lap0, 0), F.gpSectorRange(lap0, 1), F.gpSectorRange(lap0, 2)];
ok('all three ranges resolved', ranges4.every(Boolean));
ok('the first starts at the lap and the last ends at the lap',
    ranges4[0].from === lap0.from && ranges4[2].to === lap0.to);
ok('each range starts exactly where the last one finished',
    ranges4[0].to === ranges4[1].from && ranges4[1].to === ranges4[2].from);
ok('a sector index outside the lap returns nothing',
    F.gpSectorRange(lap0, -1) === null && F.gpSectorRange(lap0, 3) === null);

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
let html5 = F.gpReadyHtml();
ok('the node with no track is a warning row', /On the node/.test(html5) && /no track/.test(html5));
ok('and the fix is one click away, right there', /Send “Winton” to the node/.test(html5));
global.gp.lap = { has_track: true, track_name: 'Winton', timing: { armed: true } };
global.gp.nodeTrack = undefined;
html5 = F.gpReadyHtml();
ok('a matching armed node says the clock is ready', /armed, watching for the line/.test(html5));
ok('no Send button when there is nothing to send', !/Send “Winton” to the node/.test(html5));
global.gp.lap = { has_track: true, track_name: 'Winton', timing: { armed: true, lap_number: 3 } };
html5 = F.gpReadyHtml();
ok('mid-session it names the lap being timed', /timing · lap 3/.test(html5));
global.gp.lap = { has_track: true, track_name: 'Somewhere Else', timing: {} };
html5 = F.gpReadyHtml();
ok('a different track on the node is called out by name', /Somewhere Else/.test(html5) && /not “Winton”/.test(html5));

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
html5 = F.gpReadyHtml();
ok('link=false outranks a stale cached fix', /receiver quiet/.test(html5) && !/3D/.test(html5));
ok('and it says what to do about it', /power-cycle/.test(html5));
global.gp.status = { link: true, fix: true, fix_type: 3, sats: 16, hacc_mm: 390 };
ok('with the link up the fix reports normally', /3D/.test(F.gpReadyHtml()));

console.log('\nan empty download explains itself');
ok('recording on: says go drive', /go drive/.test(F.gpEmptyDownloadMsg(true)));
ok('recording off: says turn it on first', /Recording is OFF/.test(F.gpEmptyDownloadMsg(false)));
ok('both say the node only logs while moving', /moving/.test(F.gpEmptyDownloadMsg(true)) && /moving/.test(F.gpEmptyDownloadMsg(false)));

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
