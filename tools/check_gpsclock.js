/* The two ways a GNSS lies about what time it is, and the anchor that has to
 * survive both.
 *
 * A receiver read before it has decoded the navigation message's UTC
 * parameters hands back GPS time labelled UTC. Two faults come out of that
 * together, and this repo has now been bitten by both at once:
 *
 *   week number   a download landed 316 weeks in the past and filed the
 *                 2026-08-23 drift day under 2020. Weekday is preserved, so
 *                 nothing downstream looked wrong.
 *   leap seconds  GPS runs 18 s ahead of UTC. The same download never took
 *                 those off, so every sample was dated 18 s late.
 *
 * Both are measurable against things we independently know — the PC's clock
 * for the week, and the anchor's OWN time-of-week for the leap — which is
 * what gpTraceAnchor does. The numbers below are the real ones read off his
 * library on 2026-08-29 (offset -18.4 s from the good download, -0.8 s from
 * the broken one), not invented ones.
 *
 *   node tools/check_gpsclock.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

function grabFrom(src, name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j);
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [];
const missing = [];
for (const n of ['gpTraceAnchor', 'gpTowUtc', 'gpSampleDate']) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}
/* the constants come out of the file too — a harness carrying its own copy of
   a threshold agrees with itself and with nothing else */
for (const c of ['GP_WEEK_MS', 'GP_GPS_UTC_LEAP_S', 'GP_FUTURE_TOL_MS']) {
    const m = new RegExp('^ +var ' + c + ' = [0-9]+;', 'm').exec(src);
    if (m) parts.unshift(m[0].trim()); else missing.push(c);
}

if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

const build = new Function(`
    var gp = { status: null };
    function gpN(v) { return (v === undefined || v === null || isNaN(v)) ? null : Number(v); }
    ${parts.join('\n')}
    return { anchor: gpTraceAnchor, towUtc: gpTowUtc, sampleDate: gpSampleDate,
             setStatus: function (s) { gp.status = s; },
             LEAP: GP_GPS_UTC_LEAP_S, WEEK: GP_WEEK_MS };
`);
const F = build();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* The anchor is the fix the node holds AT DOWNLOAD TIME, so it belongs beside
   the PC's clock — not beside the recording, which can be any age. Anchoring
   these cases at the drive's own date instead is what a first draft of this
   harness did, and every case then failed by exactly one week: a six-day-old
   anchor is more than half a week from now, so the week snap fired, correctly,
   on a fixture that had no business being that old. */
const REAL = Date.now();

/* The status a healthy receiver reports: utc in UTC, itow in GPS time, so
   the two differ by exactly the leap seconds. */
function healthy(atMs) {
    return { utc: new Date(atMs).toISOString(),
             itow_ms: ((atMs - 259200000) % F.WEEK) + F.LEAP * 1000 };
}
/* The broken one: the SAME time-of-week in both fields — GPS time wearing a
   UTC label, which is what an undecoded almanac produces. */
function noLeap(atMs) {
    const s = healthy(atMs);
    return { utc: new Date(atMs + F.LEAP * 1000).toISOString(), itow_ms: s.itow_ms };
}
function weekShifted(st, weeks) {
    return { utc: new Date(Date.parse(st.utc) - weeks * F.WEEK).toISOString(),
             itow_ms: st.itow_ms };
}

console.log('the leap seconds a receiver has not worked out yet');
F.setStatus(healthy(REAL));
let a = F.anchor();
ok('a receiver that already applied them is left alone',
   Math.abs(a.utc - REAL) < 1000, 'moved ' + (a.utc - REAL) + ' ms');

F.setStatus(noLeap(REAL));
a = F.anchor();
ok('one that did not gets the ' + F.LEAP + ' s taken off',
   Math.abs(a.utc - REAL) < 1000, 'off by ' + (a.utc - REAL) + ' ms');
ok('and it is the LEAP that moved, not something rounder',
   Math.abs((a.utc - (REAL + F.LEAP * 1000)) + F.LEAP * 1000) < 1000);

console.log('\nthe measured article: -18.4 s good, -0.8 s broken');
/* residual = the anchor's own utc time-of-week minus its itow. This is the
   quantity that was read off the two real downloads. */
function residual(st) {
    let r = F.towUtc(Date.parse(st.utc)) - st.itow_ms;
    if (r > F.WEEK / 2) r -= F.WEEK;
    if (r < -F.WEEK / 2) r += F.WEEK;
    return r / 1000;
}
ok('a healthy anchor reads about -18 s, as the good download did',
   Math.abs(residual(healthy(REAL)) + F.LEAP) < 1.1, residual(healthy(REAL)) + 's');
ok('a leapless one reads about 0 s, as the broken download did',
   Math.abs(residual(noLeap(REAL))) < 1.1, residual(noLeap(REAL)) + 's');

console.log('\nthe week number, and both faults arriving together');
F.setStatus(weekShifted(healthy(REAL), 316));
a = F.anchor();
ok('316 weeks in the past is snapped back to this week',
   Math.abs(a.utc - REAL) < 1000, 'off by ' + ((a.utc - REAL) / 1000) + ' s');
/* This is the one that actually happened. */
F.setStatus(weekShifted(noLeap(REAL), 316));
a = F.anchor();
ok('and the real fault — 316 weeks AND no leap — comes back to the right second',
   Math.abs(a.utc - REAL) < 1000, 'off by ' + ((a.utc - REAL) / 1000) + ' s');

console.log('\nwhat must NOT be touched');
/* A clock a couple of minutes out is a clock error, not a leap or a week.
   Correcting it would be inventing precision. */
F.setStatus(healthy(REAL + 120000));
a = F.anchor();
ok('a two-minute clock error is left exactly as it is',
   Math.abs(a.utc - (REAL + 120000)) < 1000,
   'moved ' + ((a.utc - REAL - 120000) / 1000) + ' s');
/* Most of a week out is neither a whole week nor a leap — no reading is safe. */
F.setStatus({ utc: new Date(REAL - Math.round(F.WEEK * 0.6)).toISOString(),
              itow_ms: healthy(REAL).itow_ms });
ok('a date most of a week out is refused rather than guessed', F.anchor() === null);
F.setStatus({ utc: 'not a date', itow_ms: 1000 });
ok('an unparseable clock is refused', F.anchor() === null);
F.setStatus({ utc: new Date(REAL).toISOString(), itow_ms: null });
ok('a fix with no time-of-week is refused', F.anchor() === null);

console.log('\nthe anchor still dates samples the way it always did');
F.setStatus(healthy(REAL));
a = F.anchor();
ok('the sample the anchor was taken on dates to itself',
   Math.abs(F.sampleDate(a, a.itow) - a.utc) < 1,
   String(F.sampleDate(a, a.itow) - a.utc));
ok('a sample 10 s later dates 10 s later',
   Math.abs(F.sampleDate(a, a.itow + 10000) - a.utc - 10000) < 1);
ok('and one from before the anchor dates earlier, not into next week',
   Math.abs(F.sampleDate(a, a.itow - 30000) - a.utc + 30000) < 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
