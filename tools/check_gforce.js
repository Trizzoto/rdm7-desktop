/* Longitudinal g, and the two things that are not acceleration.
 *
 * g is worked out from how fast the speed changed, which is only meaningful
 * when there was a real interval to change over. Two cases break that, and
 * both are in his real recordings:
 *
 *   a BREAK   the recorder stopped and started again. The speed either side
 *             is fine; the time between them is a hole, not a moment. Reading
 *             it as one produced **+15.26 g** on the 2026-08-23 Mallala
 *             session — a number no car makes and no tyre survives.
 *   a GLITCH  a bad fix moves the speed further than physics allows.
 *
 * Neither was caught, and neither was VISIBLE either: the lane that draws g
 * scales itself to the session's 95th percentile, so a single enormous sample
 * sat outside the scale looking like nothing at all. It only surfaced when the
 * grip circle asked for the true maximum and got fifteen.
 *
 * The lateral channel has had both guards for ages. This pins them onto the
 * longitudinal one.
 *
 *   node tools/check_gforce.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

function grabFn(src, name) {
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

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const WANT = ['gpComputeG', 'gpMarkBreaks', 'gpNominalStep', 'gpGapS', 'gpMetres', 'gpSecs'];
const parts = [], missing = [];
for (const f of WANT) {
    try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); }
}
/* the break thresholds come out of the file, never restated here */
/* Numeric literals, and then the two derived ones in dependency order —
   GP_DT is 1/GP_TRACE_HZ, not a number, so a digits-only pattern misses it
   and the harness dies inside gpGapS instead of reporting anything. */
for (const c of ['GP_BREAK_SLACK', 'GP_BREAK_FLOOR_M', 'GP_BREAK_QUIET_K',
                 'GP_BREAK_QUIET_M', 'GP_BREAK_MAX_FRAC']) {
    const m = new RegExp('^ +var ' + c + ' = [0-9.]+;', 'm').exec(src);
    if (m) parts.unshift(m[0].trim()); else missing.push(c);
}
['GP_DT', 'GP_TRACE_HZ'].forEach(function (c) {
    const m = new RegExp('^ +var ' + c + ' = [^;\\n]+;', 'm').exec(src);
    if (m) parts.unshift(m[0].trim()); else missing.push(c);
});
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

const F = new Function(`
    /* The functions here live inside the workspace IIFE, where gp is ambient.
       gpMarkBreaks records WHY it found nothing on it — "no gaps" and "this
       recording cannot be tested for gaps" are different answers and the
       health panel needs to tell them apart — so the sandbox has to provide
       it, the way every other harness does. */
    var gp = {};
    function gpN(v) { return (v === undefined || v === null || isNaN(v)) ? null : Number(v); }
    ${parts.join('\n')}
    return { computeG: gpComputeG, markBreaks: gpMarkBreaks,
             scan: function () { return gp.breakScan; } };
`)();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* A steady 25 Hz run at a constant speed, which is the baseline every case
   below is a deviation from. */
function run(n, kph, t0) {
    const rows = [];
    let t = t0 === undefined ? 1000000 : t0;
    let lat = -34.4, lon = 138.5;
    for (let i = 0; i < n; i++) {
        const v = typeof kph === 'function' ? kph(i) : kph;
        rows.push({ lat: lat, lon: lon, kph: v, hdg: 90, t: t });
        /* move the car the distance that speed implies, so gpMarkBreaks sees
           a coherent path rather than a car teleporting on the spot */
        lon += (v / 3.6) * 0.04 / (111320 * Math.cos(lat * Math.PI / 180));
        t += 40;
    }
    return rows;
}
function maxAbsG(rows) {
    return rows.reduce((a, r) => Math.max(a, Math.abs(r.g)), 0);
}

console.log('ordinary driving still produces ordinary numbers');
let rows = run(200, 100);
F.computeG(rows);
ok('a constant speed is no acceleration', maxAbsG(rows) < 0.01, maxAbsG(rows).toFixed(3));

/* 0 to 100 km/h in 4 s is 0.71 g — brisk, real, and must survive. */
rows = run(200, i => Math.min(100, i * 0.04 * 25));
F.computeG(rows);
let peak = maxAbsG(rows);
ok('a real hard launch is kept', peak > 0.5 && peak < 1.0, peak.toFixed(3) + ' g');

/* Braking is negative, and the sign is load-bearing: the grip circle and the
   "hardest braking" moment both read it. */
rows = run(200, i => Math.max(0, 100 - i * 0.04 * 25));
F.computeG(rows);
/* Sampled mid-ramp: at i=100 the speed has just reached zero and half the
   smoothing window is clamped, which halves the gradient and would be
   measuring the clamp rather than the braking. */
ok('braking comes out negative, and about the right size',
   rows[50].g < -0.6 && rows[50].g > -0.85, String(rows[50].g));

console.log('\nthe hole in the recording');
/* The real shape: a stint at 100, the recorder stops for four minutes, and it
   resumes stationary somewhere else. */
rows = run(120, 100).concat((function () {
    const tail = run(120, 0);
    const jump = 240000;                       /* four minutes later */
    tail.forEach(r => { r.t += 120 * 40 + jump; r.lon += 0.02; });
    return tail;
})());
F.markBreaks(rows);
F.computeG(rows);
ok('the recording break is found', rows.some(r => r.brk));
ok('and no sample claims more than 3 g across it', maxAbsG(rows) <= 3,
   maxAbsG(rows).toFixed(2) + ' g');
/* This is the measured regression: without the guard it read +15.26. */
ok('specifically, nothing near the fifteen g it used to read', maxAbsG(rows) < 4,
   maxAbsG(rows).toFixed(2) + ' g');
const atBreak = rows.filter(r => r.brk);
ok('the break sample itself reports no acceleration at all',
   atBreak.every(r => r.g === 0), JSON.stringify(atBreak.map(r => r.g).slice(0, 4)));

console.log('\na bad fix, with no break to explain it');
/* One sample of nonsense speed in the middle of a clean run. */
rows = run(200, 80);
rows[100].kph = 900;
F.markBreaks(rows);
F.computeG(rows);
ok('a wild speed sample cannot push g past the physical limit',
   maxAbsG(rows) <= 3, maxAbsG(rows).toFixed(2) + ' g');

console.log('\nnothing infinite ever reaches a consumer');
rows = run(60, 50);
rows.forEach(r => { r.t = 5000; });            /* every sample the same instant */
F.markBreaks(rows);
F.computeG(rows);
ok('zero elapsed time yields 0, not Infinity',
   rows.every(r => isFinite(r.g)), 'got ' + rows.map(r => r.g).slice(0, 3).join(','));
ok('every g in every case above is a finite number',
   rows.every(r => typeof r.g === 'number' && isFinite(r.g)));

console.log('\nthe limit is the same one cornering already used');
const gate = /Math\.abs\(gv\) > 3/.test(src);
ok('3 g, stated in the code rather than implied', gate);

console.log('\nthe marking says which kind of nothing it found');
/* gpMarkBreaks returns 0 both when the drive is whole and when it gave up
   because more than one step in fifty looked impossible. Downstream that is
   correctly the same answer — no marks — but "clean" and "untested" are
   different things to tell somebody, and the health panel reads the
   difference off gp.breakScan (ADR-0049). The return value is unchanged and
   check_breaks still owns what it means. */
{
    const whole = [];
    for (let i = 0; i < 300; i++)
        whole.push({ lat: -34.4 + i * 1e-5, lon: 138.5, kph: 90, hdg: 0, t: 1000 + i * 40 });
    const n1 = F.markBreaks(whole);
    ok('a whole drive marks nothing', n1 === 0, String(n1));
    ok('…and records that the test applied and found nothing',
       !!F.scan() && F.scan().reverted === false && F.scan().found === 0,
       JSON.stringify(F.scan()));

    /* Every step impossible: 2 km apart at walking pace, 40 ms apart. Well
       past the 2% that makes the whole marking meaningless. */
    const junk = [];
    for (let i = 0; i < 300; i++)
        junk.push({ lat: -34.4 + i * 0.02, lon: 138.5, kph: 4, hdg: 0, t: 1000 + i * 40 });
    const n2 = F.markBreaks(junk);
    ok('a recording the test cannot describe marks nothing either', n2 === 0, String(n2));
    ok('…but records that it GAVE UP rather than found a clean drive',
       !!F.scan() && F.scan().reverted === true && F.scan().found > 0,
       JSON.stringify(F.scan()));
    ok('…and the two are distinguishable, which is the whole point',
       F.scan().reverted === true, JSON.stringify(F.scan()));

    F.markBreaks(null);
    ok('nothing to test leaves no claim behind at all', F.scan() === null,
       JSON.stringify(F.scan()));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
