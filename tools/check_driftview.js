/* The Drift view: the angle lane, corner playback, and the live readout.
 *
 * The engine is checked elsewhere — check_drift.js proves the angle itself
 * against a drive whose slip angle is known by construction. What is pinned
 * here is the VIEW built on top of it, and specifically the parts a later
 * change could quietly break without any test noticing:
 *
 *   - the lane's data: one bracket per corner the lap actually drove, the
 *     full-marks line always inside the plot, nothing outside the lap
 *   - gpIdxSecondsAfter walks, so a stop point lands a second past the exit
 *     on a 10 Hz import and a 25 Hz download alike
 *   - the geometry the per-frame path reads is computed OUTSIDE the cache
 *     branch (a cached frame with it undefined puts NaN into every
 *     coordinate, which canvas discards in silence — the picture stays and
 *     the cursor stops)
 *   - playback writes slots and never rebuilds the column
 *   - the stop point is armed by one thing and cleared by every deliberate
 *     move
 *   - the six class names the view added are its own
 *
 * Run against the committed Mallala golden (ADR-0050) rather than the
 * generated drift fixture: that one is gitignored and rebuilt from a seed, so
 * a checkout without it would silently skip everything.
 *
 *   node tools/check_driftview.js
 */
const fs = require('fs');
const path = require('path');
const G = require(path.join(__dirname, 'golden_lib.js'));

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');
const MAN = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'fixtures.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}

/* ---- lifting, the same rule as every harness here: verbatim, never a copy */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}
function varBlock(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1, d = 0, j = i;
    for (; j < SRC.length; j++) {
        const c = SRC[j];
        if (c === '[' || c === '{' || c === '(') d++;
        else if (c === ']' || c === '}' || c === ')') d--;
        else if (c === ';' && d === 0) { j++; break; }
    }
    return SRC.slice(m.index, j);
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const CONSTS = ['GP_DRIFT_MIN_KPH', 'GP_DRIFT_ON', 'GP_DRIFT_OFF', 'GP_DRIFT_HOLD_S',
    'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G', 'GP_DRIFT_STAR_DEG', 'GP_DRIFT_STAR_SETTLE',
    'GP_DRIFT_RHO_MIN_KPH', 'GP_DRIFT_SPIN', 'GP_DRIFT_SPIN_DROP', 'GP_DRIFT_SCORE_VER',
    'GP_DRIFT_ROUGH', 'GP_DRIFT_LINK_FRAC', 'GP_MAX_STEP_S', 'GP_CHAN_STALE', 'GP_NO_T',
    'GP_BREAK_SLACK', 'GP_BREAK_FLOOR_M', 'GP_BREAK_QUIET_M', 'GP_BREAK_QUIET_K',
    'GP_BREAK_MAX_FRAC', 'GP_COAST_G', 'GP_BRAKE_G', 'GP_CORNER_PAD', 'GP_TURN_DPS',
    'GP_TURN_MIN_S', 'GP_TURN_MIN_DEG', 'GP_TURN_SAME_S', 'GP_CORNER_RUNUP',
    'GP_DLANE_H', 'GP_DLANE_PAD'];

const FNS = ['gpN', 'gpMetres', 'gpMetresPerDeg', 'gpHaversineM', 'gpSecs', 'gpStep', 'gpHz',
    'gpChanDefsById', 'gpChanFixes', 'gpChanFixApply', 'gpChanFixFor', 'gpChanRawRange',
    'gpChanWouldRead', 'gpChanDef', 'gpChanValue', 'gpChanDefsFor', 'gpDashChansCached',
    'gpSignedDist', 'gpCrossAt', 'gpSpanSecs', 'gpGateHits', 'gpMainDir', 'gpChannels',
    'gpComputeG', 'gpHeadingAt', 'gpArcLength', 'gpCornerScan', 'gpFindCorners',
    'gpCornerPhases', 'gpNearestIndex', 'gpNominalStep', 'gpMarkBreaks', 'gpGapS',
    'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess', 'gpDriftSrcPrefs',
    'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle', 'gpDriftSeek', 'gpDriftSwitches',
    'gpDriftSegments', 'gpDriftStats', 'gpDriftForget', 'gpDriftCornerRead', 'gpDriftSpun',
    'gpDriftStars', 'gpDriftLinkMap', 'gpDriftUnits', 'gpDriftBoard', 'gpDriftBest',
    'gpDriftCorners', 'gpDriftRefLap', 'gpMyChans', 'gpLapRange', 'gpCleanRuns',
    'gpSplitRows', 'gpMoveRuns', 'gpOrientGates', 'gpRunsFromCrossings', 'gpRunGapMs',
    'gpRunBreakM', 'gpGradeRuns', 'gpDeadMs',
    /* the view's own */
    'gpDriftLaneData', 'gpIdxSecondsBefore', 'gpIdxSecondsAfter'];

function sandbox(track) {
    const gp = { tracks: { active: null, tracks: track ? [track] : [] } };
    const win = { localStorage: { getItem: () => null, setItem: () => { } } };
    const K = {};
    CONSTS.forEach(n => { try { K[n] = constOf(n); } catch (e) { } });
    K.GP_DRIFT_STAR_W = eval('(' + /var GP_DRIFT_STAR_W = (\{[^}]*\})/.exec(SRC)[1] + ')');
    const stubs = [
        'function gpEsc(s) { return String(s == null ? "" : s); }',
        'function gpTracksSave() { }',
        'function gpTracksReady() { }',
        'function gpTrackUid() { return "trk_t"; }',
        'function gpAllChans() { return []; }',
        'function gpRowsPack(rows) { return { n: rows.length }; }',
        'function gpSesUid() { return "ses_t"; }',
        'function gpActiveTrack() { return ARGtrack; }',
        'var GP_MAX_SECTORS = 8;'
    ].join('\n');
    const names = Object.keys(K);
    const args = ['gp', 'window', 'GP_DT', 'GP_TRACE_HZ', 'ARGtrack'].concat(names);
    const body = varBlock('GP_VBO_ROLE') + '\n' + varBlock('GP_PLACES') + '\n' + stubs + '\n' +
        FNS.map(grab).join('\n') +
        '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};';
    const API = new Function(...args, body)(gp, win, 1 / 25, 25, track || null,
        ...names.map(n => K[n]));
    return { API, gp, K };
}

/* ---- the lane, over a real recording ----------------------------------- */
console.log('the lane, on the 23 August Mallala session');

const spec = MAN.fixtures.find(f => f.name === 'mallala-2026-08-23');
const fx = spec ? G.readFixture(spec) : null;
if (!fx) {
    console.log('  -- fixture missing, skipping the measured half');
} else {
    const track = JSON.parse(JSON.stringify(fx.track || spec.track));
    const S = sandbox(track), API = S.API, gp = S.gp, K = S.K;
    gp.trace = fx.rows;
    gp.traceChanIds = fx.chanIds || null;
    gp.traceChanDefs = fx.chanDefs || null;
    gp.ghostFence = null; gp.chan = null; gp.chanKey = '';
    gp.driftSrcPref = null; gp.driftUnit = 0;
    gp.tracks.active = track.id;
    API.gpComputeG(gp.trace);
    gp.traceLaps = API.gpSplitRows(gp.trace, {});
    gp.selLap = 0; gp.cmpLap = -1;

    const d = API.gpDriftAngle();
    const board = API.gpDriftBoard();
    ok('the recording still carries an angle to draw', !!d);
    ok('and a board to draw brackets from', !!board);

    const r = API.gpLapRange();
    const L = API.gpDriftLaneData(r);
    ok('the lane has data', !!L);

    if (L && board) {
        ok('the x axis is time, and it starts at zero',
           L.secs[0] === 0 && L.span > 0,
           'secs[0]=' + L.secs[0] + ' span=' + L.span);
        /* Float32Array on purpose: one entry per sample, and six microseconds
           of rounding on a 145 second lap is nothing a lane can draw. */
        ok('the span matches the lap it is drawing',
           Math.abs(L.span - API.gpSecs(gp.trace, r.from, r.to)) < 1e-3,
           'lane ' + L.span + ' vs lap ' + API.gpSecs(gp.trace, r.from, r.to));
        /* The one standard the rating is graded against has to be ON the
           picture, or the line is drawn against nothing. */
        ok('the full-marks line is inside the plot',
           L.yMax >= K.GP_DRIFT_STAR_DEG, 'yMax=' + L.yMax + ' vs ' + K.GP_DRIFT_STAR_DEG);
        ok('and the scale is bounded either way',
           L.yMax >= 46 && L.yMax <= 100, 'yMax=' + L.yMax);

        const cells = board.cells[gp.selLap] || [];
        const drove = cells.filter(Boolean).length;
        ok('one bracket per corner this lap actually drove',
           L.brackets.length > 0 && L.brackets.length <= drove,
           L.brackets.length + ' brackets, ' + drove + ' cells on this lap');
        ok('every bracket runs forwards',
           L.brackets.every(b => b.b > b.a),
           JSON.stringify(L.brackets.filter(b => b.b <= b.a).slice(0, 3)));
        ok('and none of them leaves the lap',
           L.brackets.every(b => b.a >= 0 && b.b <= L.span + 1e-6));
        ok('a bracket carries either a rating or a reason, never neither',
           L.brackets.every(b => (b.rated && b.stars !== null) ||
                                 (!b.rated && !!b.note)),
           JSON.stringify(L.brackets.filter(b =>
               !((b.rated && b.stars !== null) || (!b.rated && b.note))).slice(0, 2)));
        ok('the selected unit is the one marked',
           L.brackets.filter(b => b.on).every(b => b.unit === gp.driftUnit));
        ok('the sideways stretches stay inside the lap',
           L.segs.every(s => s.a >= 0 && s.b <= L.span + 1e-6 && s.b > s.a),
           L.segs.length + ' segments');
        /* A measured angle has no error bar to draw; a derived one does. */
        ok('the band is drawn only for a derived angle', L.direct === !!d.direct);

        /* Selecting another corner must move the mark, not the geometry. */
        gp.driftUnit = Math.min(1, board.units.length - 1);
        const L2 = API.gpDriftLaneData(r);
        ok('picking another corner moves only the mark',
           L2.brackets.length === L.brackets.length && L2.span === L.span &&
           L2.yMax === L.yMax);
        gp.driftUnit = 0;

        /* A lap that drove nothing must not invent brackets. */
        const nLaps = gp.traceLaps.length;
        let anyEmptyOk = true;
        for (let li = 0; li < nLaps; li++) {
            gp.selLap = li;
            const Li = API.gpDriftLaneData(API.gpLapRange());
            if (!Li) continue;
            const cs = (board.cells[li] || []).filter(Boolean).length;
            if (Li.brackets.length > cs) anyEmptyOk = false;
        }
        gp.selLap = 0;
        ok('no lap gets more brackets than it has corner reads', anyEmptyOk);
    }

    /* ---- the stop point's walk ------------------------------------------ */
    console.log('\ngpIdxSecondsAfter walks, so a stop point lands in seconds');
    const rows = gp.trace;
    const mid = Math.floor((r.from + r.to) / 2);
    const after = API.gpIdxSecondsAfter(mid, 1.0);
    const back = API.gpIdxSecondsBefore(after, 1.0);
    ok('one second forward is about one second',
       Math.abs(API.gpSecs(rows, mid, after) - 1.0) < 0.15,
       'got ' + API.gpSecs(rows, mid, after).toFixed(3) + ' s');
    ok('and it is the mirror of gpIdxSecondsBefore',
       Math.abs(back - mid) <= 2, 'mid=' + mid + ' round trip=' + back);
    ok('it never runs past the end of the lap',
       API.gpIdxSecondsAfter(r.to, 30) === r.to);
    ok('nor backwards', API.gpIdxSecondsAfter(mid, 0) >= mid);
}

/* ---- what the source has to keep true ---------------------------------- */
console.log('\nthe drawing keeps its contract');

const lane = grab('gpDrawDriftLane');
const cacheAt = lane.indexOf('if (stale) {');
const plotAt = lane.indexOf('var plotX =');
ok('gpDrawDriftLane computes its geometry before the cache branch',
   plotAt >= 0 && cacheAt >= 0 && plotAt < cacheAt,
   'plotX at ' + plotAt + ', the cache branch at ' + cacheAt +
   ' — inside it, a cached frame reads plotX undefined, every coordinate ' +
   'goes NaN, and canvas discards NaN silently: the cursor stops moving');
ok('the per-frame path publishes the mapping the mouse needs',
   /gp\._dlane = \{/.test(lane) && lane.indexOf('gp._dlane = {') < cacheAt);
ok('the cache key carries everything the picture depends on',
   ['gp.sessionId', 'gp.driftKey', 'gp.driftSegKey', 'gp.selLap', 'gp.driftUnit']
       .every(k => new RegExp(k.replace('.', '\\.')).test(
           lane.slice(lane.indexOf('var key = ['), lane.indexOf('var bg =')))));

console.log('\nplayback moves the cursor, not the column');
const draw = grab('gpDrawPlayhead');
ok('gpDrawPlayhead drives the live readout', /gpDriftLive\(\)/.test(draw));
const live = grab('gpDriftLive');
ok('and the live readout never rebuilds anything',
   !/innerHTML\s*=\s*h\b/.test(live) && !/gpRenderDrift\(/.test(live));
ok('it reads its slots from a cache, not from the DOM',
   /gp\._dliveEls/.test(live) && !/querySelector/.test(live),
   'a querySelector per slot at 20 Hz is work nobody asked for');
ok('and it never asks the layout a question',
   !/offsetParent/.test(live),
   'offsetParent forces a synchronous layout — measured costing more than ' +
   'the work it skipped');

console.log('\nthe stop point is armed once and cleared by every deliberate move');
const ticker = grab('gpPlayResumeTicker');
ok('the ticker honours a stop point', /gp\.playStopAt/.test(ticker));
ok('and loops back rather than stopping when asked to',
   /gp\.playLoopFrom/.test(ticker));
/* A corner that ends on the line must STOP, not roll into the next lap. */
ok('the stop is checked before the roll-over',
   ticker.indexOf('gp.playStopAt') < ticker.indexOf('gpPlayRollOver'),
   'otherwise a corner at the end of a lap rolls into the next one');
ok('and before the video hands itself the clock',
   ticker.indexOf('gp.playStopAt') < ticker.indexOf('gpVideoTimeFor'),
   'the video has no stop point in it');
ok('gpPlayStop clears it', /gpPlayClearStop\(\)/.test(grab('gpPlayStop')));
ok('a scrub clears it', /gpPlayClearStop\(\)/.test(
   SRC.slice(SRC.indexOf('window.gpScrubTo = function'),
             SRC.indexOf('window.gpScrubTo = function') + 700)));

console.log('\nthe view owns its class names');
/* gpb-dhead and gpb-dtools went with the hero: the corner's name, its stars
   and its transport are on the CARD now, and the card is .gpb-ccard, shared
   with Corners. What is still drift's alone is the lane, the live readout, the
   angle picture, the disclosure, and the feed wrapper that scopes the card's
   drift-only styling. */
['gpb-dlane', 'gpb-dlive', 'gpb-dfeed', 'gpb-dspark', 'gpb-dhow']
    .forEach(function (c) {
        /* .gpb-phead was already the Analyse panel drag header when the shell
           change reused it; the page head inherited its layout and came out
           sideways. Every name here is checked against every OTHER class in
           the file. */
        const others = new RegExp('class=["\'][^"\']*\\b' + c + '\\b', 'g');
        const used = (SRC.match(others) || []).length;
        ok(c + ' is used, and only by this view', used > 0);
    });

console.log('\nevery control the view generates can be reached');
const rend = grab('gpRenderDrift');
const names = new Set();
let m2;
const re2 = /window\.(gp[A-Za-z]+)\(/g;
const bind = grab('gpDriftBind');
while ((m2 = re2.exec(bind))) names.add(m2[1]);
ok('found the handlers gpDriftBind wires', names.size >= 6, [...names].join(', '));
const dead = [...names].filter(n => !new RegExp('window\\.' + n + '\\s*=').test(SRC));
ok('all of them are exported onto window', dead.length === 0, dead.join(', '));
/* data-gp-dstep is gone as an attribute — the feed IS the list of corners, so
   there is nothing for a prev/next pair to do that clicking a card does not.
   gpDriftCornerStep survives as the [ and ] keys, and only as those, so they
   are the thing to hold on to. */
ok('[ and ] still step the corner, now that no button does',
   /if \(key === "\["\) \{ window\.gpDriftCornerStep\(-1\); return "corner"; \}/.test(SRC) &&
   /if \(key === "\]"\) \{ window\.gpDriftCornerStep\(1\); return "corner"; \}/.test(SRC));
ok('and nothing is left listening for the attribute they replaced',
   !/querySelectorAll\("\[data-gp-dstep\]"\)/.test(SRC),
   'a listener matching nothing is a control somebody will look for');
['data-gp-dplay', 'data-gp-dloop', 'data-gp-dlaps', 'data-gp-dhow', 'data-gp-dspark']
    .forEach(function (a) {
        ok(a + ' is both emitted and bound',
           rend.indexOf(a) >= 0 &&
           (bind.indexOf(a) >= 0 || grab('gpDriftSparks').indexOf(a) >= 0));
    });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
