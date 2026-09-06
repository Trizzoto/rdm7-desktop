/* Lining footage up by what is in it, and the two other bits of arithmetic
 * ADR-0066 added (repeatability's trim, and how often a channel arrived).
 *
 * The video half cannot be exercised here — node has no <video> — but the part
 * that decides is pure arithmetic and it is the part that can be wrong without
 * anybody noticing: a correlation that finds a peak in the wrong place still
 * returns a confident-looking number, and it will move somebody's footage.
 *
 * So the motion series is SYNTHESISED at a known offset and the engine has to
 * find it. If it cannot find an offset it was handed on a plate, it certainly
 * cannot find one in a GoPro file.
 *
 *   node tools/check_autosync.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

function grabFn(s, name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' + name + ' = function)', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    let i = s.indexOf('{', m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return s.slice(m.index, j).replace(/^\s*window\.(\w+) = function/, 'function $1');
}
function grabVar(s, name) {
    const re = new RegExp('^        var ' + name + ' = [^\n]*$', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const VARS = ['GP_SYNC_BIN', 'GP_SYNC_BIN_SEEK', 'GP_SYNC_SEARCH', 'GP_SYNC_MIN_R',
              'GP_SYNC_MARGIN', 'GP_CHANGAP_RATIO', 'GP_CHANGAP_MIN_S', 'GP_REPEAT_MIN_LAPS'];
const FNS = ['gpSyncGrid', 'gpSyncNorm', 'gpSyncSpeed', 'gpSyncCorrelate',
             'gpSpanTrim', 'gpChanRates', 'gpChanHz', 'gpChanEvery'];

const parts = [], missing = [];
for (const v of VARS) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

const HZ = 25;
/* A drive with a shape: seven corners a lap, laps that are NOT identical —
   because identical ones make the correlation genuinely ambiguous and that is
   a different test (the one the refusal path is for). */
function makeTrace(secs, seed) {
    const rows = [];
    const CORN = [[0.06, 74], [0.23, 52], [0.31, 112], [0.49, 44], [0.60, 86], [0.79, 58], [0.93, 98]];
    for (let i = 0; i < secs * HZ; i++) {
        const t = i / HZ, lap = Math.floor(t / 90), p = (t % 90) / 90;
        let v = 205;
        for (const [cp, cv] of CORN) {
            const d = Math.abs(((p - cp + 0.5) % 1 + 1) % 1 - 0.5);
            if (d < 0.05) v = Math.min(v, cv + (205 - cv) * Math.pow(d / 0.05, 1.7));
        }
        /* every lap a bit different, as real ones are */
        v *= 1 - 0.05 * ((lap * 7 + (seed || 0)) % 5) / 5;
        v += Math.sin(t * 2.7 + lap) * 3;
        rows.push({ t: i * (1000 / HZ), kph: Math.max(0, v) });
    }
    return rows;
}

function env(rows) {
    const ctx = {
        console, isFinite, Math, JSON, Float64Array, Array, Object, Number, NaN, Infinity,
        parseFloat, parseInt,
        gp: { trace: rows, traceChanIds: null, traceChanDefs: null, ghostFence: null },
        gpTlIdxAt(sec) {
            const i = Math.round(sec * HZ);
            return (i >= 0 && i < rows.length) ? i : null;
        },
        gpTlSessDur: () => (rows.length - 1) / HZ,
        gpSecs: (rws, a, b) => (rws[b].t - rws[a].t) / 1000
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    return ctx;
}

/* ══ the trim ════════════════════════════════════════════════════════════ */
console.log('the spread, with the extremes taken off');
{
    const E = env(makeTrace(10));
    /* The bug this exists to stop: at seven values a 10th/90th percentile trim
       lands on index 0 and index 6 and removes nothing at all, so one spin
       decides which corner a driver is told to practise. */
    const seven = [1, 2, 3, 4, 5, 6, 40];
    const t = E.gpSpanTrim(seven);
    ok('seven values really are trimmed', t.trimmed === 2, JSON.stringify(t));
    ok('…so one outlier does not set the span', t.span === 4, 'span ' + t.span + ', not 39');
    ok('and it says how many it kept', t.kept === 5, String(t.kept));

    const four = E.gpSpanTrim([1, 2, 3, 40]);
    ok('below five it does not trim, and says so',
       four.trimmed === 0 && four.span === 39, JSON.stringify(four));

    const many = E.gpSpanTrim(Array.from({ length: 20 }, (_, i) => i));
    ok('a long session trims a tenth from each end', many.trimmed === 4, JSON.stringify(many));
    ok('two values are a difference, not a spread', E.gpSpanTrim([5]) === null);
}

/* ══ the correlation ═════════════════════════════════════════════════════ */
console.log('\nit finds an offset it was not told');
function motionFor(E, rows, offsetS, from, span, bin) {
    /* The film's motion, standing in for what the camera would have seen: a
       monotonic function of speed, so it shares the SHAPE and nothing else —
       different units, different scale, an offset and a curve. Anything that
       only works on a copy of the speed trace is not being tested. */
    const pts = [];
    for (let t = 0; t < span; t += bin / 2) {
        const idx = Math.round((from + offsetS + t) * HZ);
        if (idx < 0 || idx >= rows.length) continue;
        pts.push({ t: t, m: 3 + Math.pow(rows[idx].kph, 1.3) * 0.02 });
    }
    return pts;
}
{
    const rows = makeTrace(600);
    const E = env(rows);
    const BIN = E.GP_SYNC_BIN;
    /* The film starts 220 s into the recording and the app thinks it starts at
       200 — so the answer it has to find is +20. */
    const TRUE_AT = 220, THINKS = 200, SPAN = 80;
    const pts = motionFor(E, rows, TRUE_AT, 0, SPAN, BIN);
    const grid = E.gpSyncGrid(pts, 0, SPAN, BIN);
    ok('the samples land on a grid', !!grid, grid ? String(grid.length) : 'null');
    const mN = E.gpSyncNorm(grid);
    ok('and normalise', !!mN);
    const res = E.gpSyncCorrelate(mN, THINKS, BIN);
    ok('it returns a result', !!res, JSON.stringify(res));
    if (res) {
        ok('it finds the offset, to within a bin',
           near(res.shift, TRUE_AT - THINKS, BIN),
           'wanted ' + (TRUE_AT - THINKS) + ', got ' + res.shift.toFixed(2));
        ok('…and is sure about it', res.r > 0.8, 'r = ' + res.r.toFixed(3));
        ok('…and clearly beats the runner-up',
           res.second === null || res.r >= res.second * E.GP_SYNC_MARGIN,
           'best ' + res.r.toFixed(2) + ' vs ' + (res.second === null ? '—' : res.second.toFixed(2)));
    }
}
{
    /* Backwards, and on the coarser grid the seek path uses. */
    const rows = makeTrace(600);
    const E = env(rows);
    const BIN = E.GP_SYNC_BIN_SEEK;
    const TRUE_AT = 150, THINKS = 190, SPAN = 90;
    const pts = motionFor(E, rows, TRUE_AT, 0, SPAN, BIN);
    const res = E.gpSyncCorrelate(E.gpSyncNorm(E.gpSyncGrid(pts, 0, SPAN, BIN)), THINKS, BIN);
    ok('a negative offset is found too, on the coarse grid',
       res && near(res.shift, TRUE_AT - THINKS, BIN),
       res ? 'wanted -40, got ' + res.shift.toFixed(2) : 'null');
}
{
    /* Noise, not signal. Nothing in the recording matches, and the engine must
       come back weak rather than confident about the tallest lump of nothing. */
    const rows = makeTrace(400);
    const E = env(rows);
    const BIN = E.GP_SYNC_BIN;
    const pts = [];
    let x = 1;
    for (let t = 0; t < 70; t += BIN / 2) {
        x = (x * 1103515245 + 12345) % 2147483648;
        pts.push({ t: t, m: (x / 2147483648) * 100 });
    }
    const res = E.gpSyncCorrelate(E.gpSyncNorm(E.gpSyncGrid(pts, 0, 70, BIN)), 100, BIN);
    ok('random motion does not produce a confident answer',
       !res || res.r < E.GP_SYNC_MIN_R || (res.second !== null && res.r < res.second * E.GP_SYNC_MARGIN),
       res ? 'r ' + res.r.toFixed(2) + ' vs second ' + (res.second === null ? '—' : res.second.toFixed(2)) : 'null');
}
{
    /* A film of a stationary car. There is no shape, and a correlation against
       a flat line is a division by zero waiting to be reported as certainty. */
    const E = env(makeTrace(300));
    const flat = [];
    for (let t = 0; t < 60; t += 0.25) flat.push({ t: t, m: 7 });
    const grid = E.gpSyncGrid(flat, 0, 60, E.GP_SYNC_BIN);
    ok('a film where nothing moves normalises to nothing, not to noise',
       E.gpSyncNorm(grid) === null);
}
{
    const E = env(makeTrace(300));
    ok('too few samples is refused rather than padded',
       E.gpSyncGrid([{ t: 0, m: 1 }, { t: 1, m: 2 }], 0, 3, E.GP_SYNC_BIN) === null);
}

/* ══ how often a channel arrived ═════════════════════════════════════════ */
console.log('\nhow often a channel actually arrived');
function withChans(secs, fresh) {
    /* `fresh(col, i)` says whether that channel had a new value at sample i. */
    const rows = makeTrace(secs);
    for (let i = 0; i < rows.length; i++) {
        rows[i].can = [0, 1, 2].map((c) => (fresh(c, i) ? 100 + c : null));
    }
    return rows;
}
{
    /* Channel 0 every sample, channel 1 every fifth — evenly — and channel 2
       every fifth with a four-second hole in the middle. Only the third is a
       fault, and the difference between the second and the third is the whole
       point of measuring the worst interval as well as the median. */
    const rows = withChans(120, (c, i) => {
        if (c === 0) return true;
        if (c === 1) return i % 5 === 0;
        const t = i / HZ;
        if (t > 50 && t < 54) return false;
        return i % 5 === 0;
    });
    const E = env(rows);
    E.gp.traceChanIds = [10, 11, 12];
    E.gp.traceChanDefs = [{ name: 'RPM' }, { name: 'Throttle' }, { name: 'Brake' }];
    const R = E.gpChanRates();
    ok('one reading per channel', R && R.length === 3, R ? String(R.length) : 'null');
    if (R) {
        ok('a channel on every sample reads as the log rate',
           near(R[0].hz, HZ, 1), R[0].hz.toFixed(1) + ' Hz');
        ok('a channel every fifth sample reads as a fifth of it',
           near(R[1].hz, HZ / 5, 0.6), R[1].hz.toFixed(1) + ' Hz');
        ok('…and evenly slow is NOT a fault', R[1].bursty === false,
           'worst ' + R[1].worst_s.toFixed(2) + ' vs median ' + R[1].median_s.toFixed(2));
        ok('a channel that stops and comes back IS one', R[2].bursty === true,
           'worst ' + R[2].worst_s.toFixed(2) + ' vs median ' + R[2].median_s.toFixed(2));
        ok('and it says where to look', R[2].at > 0 && R[2].at < rows.length, String(R[2].at));
    }
}
{
    const rows = withChans(60, () => true);
    const E = env(rows);
    E.gp.traceChanIds = [1];
    ok('a recording with no channels at all is not a fault',
       env(makeTrace(60)).gpChanRates() === null);
    const R = E.gpChanRates();
    ok('a perfectly steady channel is never bursty', R && R[0].bursty === false);
}
{
    const E = env(makeTrace(60));
    ok('a rate reads in Hz above one, and in seconds below',
       E.gpChanHz(25) === '25 Hz' && E.gpChanHz(0.5) === '2.0 s', E.gpChanHz(0.5));
    ok('an interval reads in milliseconds under a second',
       E.gpChanEvery(0.04) === '40 ms' && E.gpChanEvery(2.5) === '2.5 s');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
