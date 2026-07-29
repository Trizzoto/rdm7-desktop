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
    'gpMetres', 'gpSecs', 'gpStep', 'gpSignedDist', 'gpSplitRows',
    'gpTrackById', 'gpActiveTrack', 'gpIsTrial', 'gpRunWord', 'gpTrackUid', 'gpTracksSave',
    'gpTraceHome', 'gpKmBetween', 'gpMatchTrack', 'gpHeadingAt', 'gpAngleDiff',
    'gpLoopClosure', 'gpProposeLine', 'gpAutoLine', 'gpAutoSetUp', 'gpStints'];
const NEEDED_VAR = ['GP_TRACE_HZ', 'GP_DT', 'GP_MAX_STEP_S', 'GP_MATCH_KM', 'GP_CLOSE_M',
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

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
