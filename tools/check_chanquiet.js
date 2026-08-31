/* A channel that never said anything is empty, not badly scaled.
 *
 * A recording carries one column per configured channel whether or not a
 * frame with that id ever arrived — the quiet marker (0xFFFF) fills it end to
 * end. Studio drew that as a named lane with an empty well, and, for an id
 * nothing describes, a red "not decoded" beside it. That is an answer to a
 * question nobody asked: the column is not badly scaled, it is empty.
 *
 * Measured on the 22 Aug Falcon run at Mallala — twelve channels, ten
 * minutes, every one of the 8 103 samples quiet on all twelve, because the
 * puck had gone into a different car and never saw one of the ECU ids it was
 * still logging. Twelve lanes said "not decoded". None said "no CAN arrived".
 *
 * What this pins down:
 *   - a column with a value anywhere is live, however rarely it speaks
 *   - a column quiet end to end is marked quiet and draws as an empty lane
 *   - "not decoded" never survives on a quiet column
 *   - a whole quiet bus says so ONCE, not once per lane
 *   - a partly quiet bus says it on each quiet lane, since it is a fact about
 *     that channel rather than about the recording
 *   - the scan is cached, and the cache follows the recording
 *
 *   node tools/check_chanquiet.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

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

const STALE = constOf('GP_CHAN_STALE');

/* gpLaneRowsAll reaches into the drift engine, the puck's selection and the
   GPS lanes, none of which this is about — so the real gpChanQuiet is taken
   verbatim, and the lane assembly it feeds is exercised through the same
   branch the app runs, with everything around it stubbed. */
const gp = {};
const API = new Function('gp', 'GP_CHAN_STALE',
    grab('gpChanQuiet') + '\n;return { gpChanQuiet: gpChanQuiet };'
)(gp, STALE);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
const head = s => console.log('\n' + s);

/* n samples, m channels; `speak` decides what channel c says at sample i. */
function recording(n, m, speak) {
    gp.traceChanIds = Array.from({ length: m }, (_, c) => 'ch' + (c + 1));
    gp.trace = Array.from({ length: n }, (_, i) => ({
        lat: -34.4165, lon: 138.5048, kph: 60, hdg: 90, g: 0, t: i * 40,
        can: Array.from({ length: m }, (_, c) => speak(i, c))
    }));
    gp._quietKey = null; gp._quiet = null;
}

head('A column is quiet only when it is quiet all the way through');
{
    recording(2000, 3, (i, c) => {
        if (c === 0) return 1234;                       /* speaks constantly */
        if (c === 1) return i === 1999 ? 7 : STALE;     /* speaks once, at the very end */
        return STALE;                                   /* never speaks */
    });
    const q = API.gpChanQuiet();
    ok('a channel with a value at every sample is live', q[0] === false);
    ok('a channel that speaks ONCE, on the last sample, is live', q[1] === false);
    ok('a channel that never speaks is quiet', q[2] === true);
}

head('The Falcon at Mallala: twelve channels, nothing on any of them');
{
    recording(8103, 12, () => STALE);
    const q = API.gpChanQuiet();
    ok('all twelve are quiet', q.length === 12 && q.every(Boolean));

    /* And the reverse, so this cannot pass by always saying quiet. */
    recording(8103, 12, () => 0);
    const live = API.gpChanQuiet();
    ok('a bus reading zero is NOT quiet — zero is a reading', live.every(x => x === false));
}

head('Nothing is claimed about a recording that carries no columns');
{
    gp.trace = [{ lat: 0, lon: 0, kph: 0, hdg: 0, g: 0, t: 0, can: null }];
    gp.traceChanIds = null; gp._quietKey = null; gp._quiet = null;
    ok('no channels means no answer, not twelve false ones', API.gpChanQuiet() === null);

    /* A sample without a `can` array in the middle of one that has them must
       not be read as everything going quiet. */
    recording(100, 2, () => 5);
    gp.trace[50].can = null;
    gp._quietKey = null; gp._quiet = null;
    ok('a bare sample does not silence a live channel',
       API.gpChanQuiet().every(x => x === false));
}

head('The scan is cached, and the cache belongs to the recording');
{
    recording(50000, 12, (i, c) => (c === 3 ? 1 : STALE));
    const t0 = Date.now(); const a = API.gpChanQuiet(); const cold = Date.now() - t0;
    const t1 = Date.now(); const b = API.gpChanQuiet(); const warm = Date.now() - t1;
    ok('the same answer comes back', a === b);
    ok('and it is not recomputed', warm <= 1, cold + ' ms cold, ' + warm + ' ms warm');

    /* Open a DIFFERENT recording with the same ids, the same length and the
       same clock, and clear nothing. The answer must still move with it, or
       one forgotten cache-clear shows the last session's channels as live in
       this one. */
    const ids = gp.traceChanIds.slice();
    const before = gp.trace;
    recording(50000, 12, () => STALE);
    gp.traceChanIds = ids;
    gp._quietKey = null; gp._quiet = null; gp._quietFor = null;
    const fresh = API.gpChanQuiet();
    ok('the new recording reads as silent', fresh.every(Boolean));

    /* Now hand it the OLD array back with the stale answer still in place. */
    gp.trace = before;
    const back = API.gpChanQuiet();
    ok('swapping the samples under a cache with nothing cleared still answers ' +
       'for the samples in front of it', back[3] === false && back.filter(Boolean).length === 11,
       JSON.stringify(back.map(x => x ? 'quiet' : 'live')));
}

/* ---- what the lane says --------------------------------------------------
 * The branch under test lives inside gpLaneRowsAll, which cannot be lifted
 * whole. Rather than copy it — a copy would drift and then pass while the app
 * failed — this asserts on the SOURCE of that branch: the properties it sets,
 * and the draw code that reads them. */
head('The lane says the right thing, and stops saying the wrong one');
{
    const branch = /if \(quiet && quiet\[idx\]\) \{[\s\S]*?\n                        \}/.exec(SRC);
    ok('the quiet branch exists in gpLaneRowsAll', !!branch);
    const b = branch ? branch[0] : '';
    ok('it marks the lane quiet', /lane\.quiet = true/.test(b));
    ok('it withdraws "not decoded"', /lane\.raw = null/.test(b));
    ok('it draws the lane as empty', /lane\.absent = function \(\) \{ return true; \}/.test(b));
    ok('a whole silent bus says it once, on the first lane',
       /allQuiet[\s\S]*idx === 0[\s\S]*: null/.test(b));
    ok('a single silent channel says it on its own lane',
       /Nothing arrived on this id during this recording/.test(b));

    const draw = /\} else if \(lane\.quiet\) \{[\s\S]*?\n                \}/.exec(SRC);
    ok('the strip has a tag for it', !!draw && /no frames/.test(draw[0]));
    ok('and it is tested BEFORE the "not decoded" tag, which it outranks',
       SRC.indexOf('} else if (lane.quiet) {') < SRC.indexOf('} else if (lane.raw) {'));
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'passed all ' + pass) + ' checks');
process.exit(fail ? 1 : 0);
