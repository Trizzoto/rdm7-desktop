/* "Can I trust this recording?" — the panel that reads out what the app
 * already knew (ADR-0049).
 *
 * Nothing here measures anything. Every number the panel shows was already
 * being computed somewhere and thrown away, so the failures worth catching are
 * failures of REPORTING:
 *
 *   - a verdict that averages instead of pointing at the wrong row
 *   - "no gaps" said about a recording the gap test could not describe, which
 *     is the difference between a clean drive and an untested one
 *   - a drift fit that is refused, unanchored or mis-scaled and still reads ok
 *   - a recording saved before any of this existed badged as healthy
 *
 * The last two are the 23 August Mallala session, which is why the panel
 * exists at all.
 *
 *   node tools/check_health.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

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

const FNS = ['gpHealth', 'gpHealthVerdict', 'gpPanelHealthHtml', 'gpReadyRow'];
const parts = [], missing = [];
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

/* A drive with nothing wrong with it, unless a test says otherwise. */
function cleanRows(n) {
    const rows = [];
    for (let i = 0; i < (n || 400); i++)
        rows.push({ lat: -34.4 + i * 1e-5, lon: 138.5, kph: 90, hdg: 0, t: 1000 + i * 40,
                    g: 0, brk: false, brkTime: false, brkM: 0 });
    return rows;
}

function env(opt) {
    opt = opt || {};
    const rows = opt.rows || cleanRows();
    const gp = {
        trace: rows,
        traceLaps: opt.laps === undefined ? [{ from: 0, to: rows.length - 1 }] : opt.laps,
        ghostFence: opt.ghostFence === undefined ? null : opt.ghostFence,
        lapsFrom: opt.lapsFrom === undefined ? 'gate' : opt.lapsFrom,
        traceChanIds: opt.chanIds === undefined ? ['a', 'b', 'c'] : opt.chanIds,
        breakScan: opt.scan === undefined ? { marked: 0, found: 0, reverted: false } : opt.scan,
        pathSigma: opt.sigma === undefined ? 0.3 : opt.sigma,
        video: opt.video === undefined ? null : opt.video,
        healthOpen: !!opt.open
    };
    const shim = `
        var gp = ARGgp;
        function gpN(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
        function gpEsc(t) { return String(t); }
        /* The smoother is the thing that MEASURES the noise; the panel only
           reads gp.pathSigma and asks for it if nobody has yet. */
        function gpSmoothPath() { gp.pathSigma = ARGsigma; }
        function gpCleanRuns() {
            return (gp.traceLaps || []).filter(function (l) { return !l.ghost && !l.flag; });
        }
        function gpNoLapsWhy() { return 'BECAUSE'; }
        function gpRunWord() { return gp.lapsFrom === 'gate' ? 'lap' : 'run'; }
        function gpChanQuiet() { return ARGquiet; }
        function gpDriftAngle() { return ARGdrift; }
        function gpVideoCover() { return ARGcover; }
        function gpCurSessionMeta() { return ARGmeta; }
        function gpPanelEmpty(t) { return '[empty]' + t; }
        function gpRenderGridSoft() { }
        ${parts.join('\n')}
        return { health: gpHealth, verdict: gpHealthVerdict, html: gpPanelHealthHtml, gp: gp };
    `;
    return new Function('ARGgp', 'ARGsigma', 'ARGquiet', 'ARGdrift', 'ARGcover', 'ARGmeta',
        shim)(gp,
              opt.sigma === undefined ? 0.3 : opt.sigma,
              opt.quiet === undefined ? [false, false, false] : opt.quiet,
              opt.drift === undefined ? null : opt.drift,
              opt.cover === undefined ? null : opt.cover,
              opt.meta === undefined ? null : opt.meta);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
/* Every row is keyed by the label the panel shows, so the checks read like the
   panel does. */
function row(E, k) {
    const H = E.health();
    return (H.rows || []).filter(r => r.k === k)[0] || null;
}
function toneOf(E, k) { const r = row(E, k); return r ? r.tone : '(no row)'; }

/* ══ the verdict ═════════════════════════════════════════════════════════ */
console.log('the verdict points at a row, it does not average');
{
    const E = env();
    ok('all clear reads ok', E.verdict([{ tone: 'ok' }, { tone: 'ok' }]).tone === 'ok');
    ok('one warning among many ok rows is a warning',
       E.verdict([{ tone: 'ok' }, { tone: 'warn' }, { tone: 'ok' }]).tone === 'warn');
    ok('one bad among many warnings is bad',
       E.verdict([{ tone: 'warn' }, { tone: 'warn' }, { tone: 'bad' }]).tone === 'bad');
    ok('the count is everything not ok, not just the worst',
       E.verdict([{ tone: 'warn' }, { tone: 'bad' }, { tone: 'ok' }]).n === 2);
    ok('rows with no tone are facts, not faults',
       E.verdict([{ tone: null }, { tone: 'ok' }]).tone === 'ok' &&
       E.verdict([{ tone: null }]).n === 0);
}

/* ══ the fix ═════════════════════════════════════════════════════════════ */
console.log('\nthe gap test says which kind of nothing it found');
{
    ok('a whole drive is ok', toneOf(env(), 'The fix') === 'ok');

    const holed = cleanRows();
    holed[100].brk = true; holed[100].brkM = 40;
    ok('a hole the clock knows about is a warning',
       toneOf(env({ rows: holed, scan: { marked: 1, found: 1, reverted: false } }), 'The fix') === 'warn');

    const jumped = cleanRows();
    jumped[100].brk = true; jumped[100].brkTime = true; jumped[100].brkM = 444;
    const J = env({ rows: jumped, scan: { marked: 1, found: 1, reverted: false } });
    ok('a jump the clock got wrong is bad', toneOf(J, 'The fix') === 'bad');
    ok('…and it says how far, because that is the size of the lie',
       /444 m/.test(row(J, 'The fix').sub), row(J, 'The fix').sub);

    /* THE check this panel exists for. gpMarkBreaks returns 0 both when the
       drive is whole and when it gave up, and reporting the second as clean
       is the panel lying about the one thing it is for. */
    const R = env({ scan: { marked: 0, found: 900, reverted: true } });
    ok('a gap test that gave up is NOT reported as a clean drive',
       toneOf(R, 'The fix') === 'warn', toneOf(R, 'The fix'));
    ok('…and it says the test did not apply, not that there were no gaps',
       /not checked/.test(row(R, 'The fix').v) && !/held/.test(row(R, 'The fix').v),
       JSON.stringify(row(R, 'The fix')));
    ok('a recording never scanned at all says so too, without crying wolf',
       toneOf(env({ scan: null }), 'The fix') === null);
}
/* That gpMarkBreaks actually RECORDS the difference the panel reads is
   checked in check_gforce.js, where the whole break-marking chain is already
   lifted. This file tests what the panel does with the answer. */

/* ══ position noise — measured on every recording, never shown until now ══ */
console.log('\nthe position noise finally has somewhere to be');
{
    ok('steady is ok', toneOf(env({ sigma: 0.3 }), 'Position') === 'ok');
    ok('0.8 m is still ok', toneOf(env({ sigma: 0.8 }), 'Position') === 'ok');
    ok('past it is a warning', toneOf(env({ sigma: 0.81 }), 'Position') === 'warn');
    ok('2 m is the last warning', toneOf(env({ sigma: 2 }), 'Position') === 'warn');
    ok('past that it is bad', toneOf(env({ sigma: 2.01 }), 'Position') === 'bad');
    ok('and the number itself is shown', /0\.30 m/.test(row(env({ sigma: 0.3 }), 'Position').v));
}

/* ══ what timed it ═══════════════════════════════════════════════════════ */
console.log('\nwhat timed it, and what that means');
{
    ok('a timing line is ok', toneOf(env({ lapsFrom: 'gate' }), 'Timing') === 'ok');
    const S = env({ lapsFrom: 'stops' });
    ok('cut at the stops is a warning', toneOf(S, 'Timing') === 'warn');
    ok('…and says these are not lap times',
       /not laps/.test(row(S, 'Timing').sub), row(S, 'Timing').sub);
    ok('…and carries the existing explanation rather than writing a second one',
       /BECAUSE/.test(row(S, 'Timing').sub));
    const N = env({ lapsFrom: null });
    ok('nothing timing it at all is bad', toneOf(N, 'Timing') === 'bad');
    ok('…and it is the app’s own reason', /BECAUSE/.test(row(N, 'Timing').sub));
}
{
    const flagged = env({ laps: [{ from: 0, to: 99 }, { from: 100, to: 199, flag: 'jump' }] });
    ok('a flagged run is a warning', toneOf(flagged, 'Flagged laps') === 'warn');
    ok('…counted, not listed', row(flagged, 'Flagged laps').v === '1');
    ok('a ghost lap is somebody else’s day and is not counted',
       row(env({ laps: [{ from: 0, to: 9, ghost: true, flag: 'jump' }] }), 'Flagged laps') === null);
    ok('no flags, no row', row(env(), 'Flagged laps') === null);
}

/* ══ channels ════════════════════════════════════════════════════════════ */
console.log('\nchannels, and the whole-bus case said once');
{
    ok('all talking is ok', toneOf(env({ quiet: [false, false, false] }), 'Channels') === 'ok');
    ok('some silent is a warning', toneOf(env({ quiet: [true, false, false] }), 'Channels') === 'warn');
    const A = env({ quiet: [true, true, true] });
    ok('all silent is bad', toneOf(A, 'Channels') === 'bad');
    ok('…and says it is not a scaling problem',
       /scaling problem/.test(A.health().rows.filter(r => r.k === 'Channels')[0].sub));
    const none = env({ chanIds: [] });
    ok('a recording with no channels is a fact, not a fault',
       toneOf(none, 'Channels') === null, toneOf(none, 'Channels'));
}

/* ══ the angle — where item 1 went ═══════════════════════════════════════ */
console.log('\nthe drift fit stops keeping its diagnostics to itself');
function drift(o) {
    const n = 400;
    const d = { ok: new Array(n).fill(1), beta: new Array(n).fill(20),
                conf: new Array(n).fill(o.conf === undefined ? 1.5 : o.conf),
                scale: o.scale === undefined ? 1.0 : o.scale,
                bias: o.bias === undefined ? 0.1 : o.bias,
                fitN: o.fitN === undefined ? 4100 : o.fitN,
                weak: !!o.weak, anchors: o.anchors === undefined ? 12 : o.anchors,
                worst: o.worst === undefined ? 2 : o.worst };
    return d;
}
{
    ok('no angle source is a fact, not a fault',
       toneOf(env({ drift: null }), 'Slip angle') === null);
    ok('…and it says the angle is never inferred from the path',
       /never worked out from the path/.test(row(env({ drift: null }), 'Slip angle').sub));

    const W = env({ drift: drift({ weak: true }) });
    ok('a fit that could not be made is bad', toneOf(W, 'Slip angle') === 'bad');
    ok('…and says what driving would fix it',
       /grip driving|without sliding/.test(W.health().rows.filter(r => r.k === 'Slip angle')[0].sub),
       row(W, 'Slip angle').sub);

    ok('a sensor reading well off is a warning',
       toneOf(env({ drift: drift({ scale: 1.24 }) }), 'Slip angle') === 'warn');
    ok('…and a real 1.008 is not — that is a good fit, not a fault',
       toneOf(env({ drift: drift({ scale: 1.008 }) }), 'Slip angle') === 'ok');

    ok('nothing to check the angle against is a warning',
       toneOf(env({ drift: drift({ anchors: 0 }) }), 'Slip angle') === 'warn');

    /* The Mallala row: closing at both ends says nothing about the middle. */
    const M = env({ drift: drift({ conf: 1.5, worst: 9 }) });
    ok('confident overall but far worse somewhere is a warning',
       toneOf(M, 'Slip angle') === 'warn', toneOf(M, 'Slip angle'));
    ok('…and shows both numbers, so the gap between them is visible',
       /typical/.test(row(M, 'Slip angle').v) && /worst/.test(row(M, 'Slip angle').v),
       row(M, 'Slip angle').v);

    const G = env({ drift: drift({}) });
    ok('an even fit is ok', toneOf(G, 'Slip angle') === 'ok');
    ok('…and the working is shown even when nothing is wrong',
       /4100 samples/.test(row(G, 'Slip angle').sub) && /scale/.test(row(G, 'Slip angle').sub),
       row(G, 'Slip angle').sub);
}

/* ══ video and the download ══════════════════════════════════════════════ */
console.log('\nfootage, and what the recorder said at download');
{
    ok('no video, no row', row(env(), 'Video') === null);
    const D = env({ video: { dead: true } });
    ok('a picture that will not decode is bad', toneOf(D, 'Video') === 'bad');
    ok('…and offers the fix that exists', !!row(D, 'Video').fix,
       JSON.stringify(row(D, 'Video').fix));
    ok('short coverage is a warning',
       toneOf(env({ video: {}, cover: { frac: 0.5 } }), 'Video') === 'warn');
    ok('full coverage is ok',
       toneOf(env({ video: {}, cover: { frac: 1 } }), 'Video') === 'ok');
}
{
    ok('a recording saved before any of this has no download row',
       row(env({ meta: { id: 'x' } }), 'Download') === null);
    ok('a clean download is ok',
       toneOf(env({ meta: { ring: { wrapped: false, dropped: 0, holes: 0 } } }), 'Download') === 'ok');
    ok('a wrapped ring is a warning',
       toneOf(env({ meta: { ring: { wrapped: true, dropped: 0, holes: 0 } } }), 'Download') === 'warn');
    ok('dropped samples are a warning',
       toneOf(env({ meta: { ring: { wrapped: false, dropped: 12, holes: 0 } } }), 'Download') === 'warn');
    ok('so are holes stepped over — counted since the ring learned to skip them',
       toneOf(env({ meta: { ring: { wrapped: false, dropped: 0, holes: 3 } } }), 'Download') === 'warn');
}

/* ══ the panel itself ════════════════════════════════════════════════════ */
console.log('\none line, and under it only what is wrong');
{
    const good = env();
    const h = good.html();
    ok('a clean recording says so in one line', /Nothing looks wrong/.test(h));
    ok('…and shows no rows until asked',
       (h.match(/gp-row'/g) || []).length === 0, String((h.match(/gp-row'/g) || []).length));

    const openGood = env({ open: true });
    ok('opened, every check is there',
       (openGood.html().match(/gp-row'/g) || []).length === openGood.health().rows.length);

    const bad = env({ sigma: 3, lapsFrom: null });
    const bh = bad.html();
    ok('two faults are counted in the headline', /2 things/.test(bh), bh.slice(0, 200));
    ok('…and only those two rows are shown collapsed',
       (bh.match(/gp-row'/g) || []).length === 2, String((bh.match(/gp-row'/g) || []).length));
    ok('one fault reads as one thing, not "1 things"',
       /One thing/.test(env({ sigma: 3 }).html()));
    ok('the lamp carries the tone', /gp-lamp bad/.test(bh));
}
{
    /* The cache must follow the recording, or a panel shows the previous
       session's verdict — the same rule gpChanQuiet's cache keeps. */
    const E = env({ lapsFrom: 'gate' });
    const first = E.health();
    ok('the answer is memoised', E.health() === first);
    E.gp.lapsFrom = 'stops';
    ok('…but re-splitting the laps invalidates it', E.health() !== first);
    ok('…and the new answer is the new one', toneOf(E, 'Timing') === 'warn');

    /* The key follows the recording, and it cannot see a re-split that lands
       on the same lap count with different run flags. Found by driving the
       real app, not by this file: a lap flagged after a re-split left the
       panel showing the verdict from before it. gpSplitLaps clears every
       other derived answer and now clears this one, so the belt is the key
       and the braces are the clear. */
    const F = env({ laps: [{ from: 0, to: 199 }, { from: 200, to: 399 }] });
    F.health();
    F.gp.traceLaps[1].flag = 'jump';       /* same count, different truth */
    ok('a flag appearing on the same number of laps is not seen by the key alone',
       toneOf(F, 'Flagged laps') === '(no row)', toneOf(F, 'Flagged laps'));
    F.gp.healthKey = ''; F.gp.healthCache = null;   /* what gpSplitLaps now does */
    ok('…and clearing the cache, as the re-split does, shows it',
       toneOf(F, 'Flagged laps') === 'warn', toneOf(F, 'Flagged laps'));
}
{
    /* And the source really does clear it there, rather than this file
       describing a fix nobody made. */
    const cleared = /gp\.healthKey = ""; gp\.healthCache = null;/.test(src);
    ok('gpSplitLaps clears the verdict with the rest', cleared);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
