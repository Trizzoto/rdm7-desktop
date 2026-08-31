/* Which start crossing a finish crossing belongs to.
 *
 * On a time-trial track — a start gate and a separate finish gate — a run is
 * the drive between them. The obvious pairing is "each start with the next
 * finish", and it is wrong, because a driver does not always finish what they
 * start. Cross the start, miss the finish gate or pull off, come back round
 * and cross the start again, and that first crossing is still sitting there
 * unpaired: it grabs the finish belonging to the SECOND attempt, times a
 * fifteen-minute "run", and hides the real one inside it.
 *
 * That is not hypothetical. A 92-minute Mount Barker recording showed four
 * runs of 2:49, 15:03, 11:52 and 19:46, and three of the four were this bug —
 * with genuine 2:44 and 2:38 runs buried underneath them.
 *
 * So the rule is the one a real timing loop uses: it re-arms every time the
 * car crosses the start line, and the run it times is the one from the most
 * recent arming. A start with no finish before the next start timed nothing.
 *
 * What this pins down:
 *   - a finish pairs with the LAST start before it, not the first unused one
 *   - an abandoned run times nothing rather than swallowing the next one
 *   - a finish before any start is not a run
 *   - a second finish with no start in between is not a second run
 *   - crossings the wrong way round are still filtered by direction
 *   - a circuit (one line, no finish gate) still times consecutive crossings
 *
 * Functions come verbatim out of src/tauri-overlay.html — a copy would drift
 * and then pass while the app failed.
 *
 *   node tools/check_runsplit.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

function grabFrom(src, name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' +
                          name + ' = function)', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j).replace(/^\s*window\.(\w+) = function/, 'function $1');
}

const WANT = ['gpN', 'gpSignedDist', 'gpCrossAt', 'gpGateHits', 'gpMainDir',
              'gpDeadMs', 'gpRunsFromCrossings', 'gpRunGapMs', 'gpRunBreakM', 'gpGradeRuns', 'gpSplitRows', 'gpSecs', 'gpSpanSecs'];
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = WANT.map(n => grabFrom(src, n));

const prelude = `
    var GP_DT = 1 / 25;
    var ACTIVE = null;
    function gpActiveTrack() { return ACTIVE; }
`;

const F = new Function(prelude + parts.join('\n') + `
    return { split: gpSplitRows, secs: gpSpanSecs,
             runs: gpRunsFromCrossings, deadMs: gpDeadMs,
             setTrack: function (t) { ACTIVE = t; } };
`)();

let pass = 0, fail = 0;
function ok(what, cond, got) {
    if (cond) { pass++; console.log('  ok   ' + what); }
    else { fail++; console.log('  FAIL ' + what + (got === undefined ? '' : '  got: ' + got)); }
}

/* ---- a synthetic drive up and down one straight ------------------------
 * Everything happens on one meridian, so the gates' `lateral` is exactly
 * zero and `along` is exactly metres north of the gate. That keeps the test
 * about the PAIRING rather than about floating-point geometry — the crossing
 * interpolation has its own coverage in check_laptime.js. */
const D = Math.PI / 180, R = 6371008.8;
const LAT0 = -35.0922136, LON0 = 138.8391329;
const HZ = 25;
const northAt = m => LAT0 + m / (D * R);

const START = { lat: LAT0, lon: LON0, heading: 0, half_width_m: 15 };
const FINISH = { lat: northAt(2200), lon: LON0, heading: 0, half_width_m: 15 };

/* Keyframes: [t seconds, metres north of the start gate]. Sampled at 25 Hz
   with linear interpolation between them, which is what a car driving at a
   steady speed between two points looks like to a gate. */
function drive(keys) {
    const rows = [];
    for (let k = 1; k < keys.length; k++) {
        const [t0, m0] = keys[k - 1], [t1, m1] = keys[k];
        const n = Math.round((t1 - t0) * HZ);
        for (let s = (k === 1 ? 0 : 1); s <= n; s++) {
            const f = s / n, t = t0 + (t1 - t0) * f, m = m0 + (m1 - m0) * f;
            rows.push({ lat: northAt(m), lon: LON0, t: Math.round(t * 1000),
                        kph: Math.abs((m1 - m0) / (t1 - t0)) * 3.6 });
        }
    }
    return rows;
}

const round = t => Math.round(t * 1000) / 1000;
const timesOf = (rows, laps) => laps.map(l => round(F.secs(rows, l)));

/* Out, round, and back to the paddock — twice cleanly, once abandoned. */
const DAY = drive([
    [0, -300],      /* paddock */
    [100, 0],       /* crosses the START at 100.0 */
    [260, 2200],    /* crosses the FINISH at 260.0  -> a 160 s run */
    [300, 2400],    /* rolls out past the finish */
    [500, -300],    /* drives back down: backward crossings of both gates */
    [600, 0],       /* crosses the START at 600.0 */
    [700, 1000],    /* ... and never reaches the finish */
    [800, -300],    /* turns back: another backward crossing of the start */
    [900, 0],       /* crosses the START at 900.0 */
    [1060, 2200],   /* crosses the FINISH at 1060.0 -> a second 160 s run */
    [1100, 2400]
]);

console.log('a start that was never finished times nothing');
F.setTrack({ start_finish: START, finish: FINISH });
const runs = F.split(DAY);
const t = timesOf(DAY, runs);
ok('two runs, not three', runs.length === 2, JSON.stringify(t));
ok('the first is the real 160 s', Math.abs(t[0] - 160) < 0.05, String(t[0]));
ok('the second is the real 160 s', Math.abs(t[1] - 160) < 0.05, String(t[1]));
ok('nothing runs long enough to span two attempts',
   t.every(x => x < 300), JSON.stringify(t));
/* The old pairing produced exactly this, which is the shape the user saw. */
ok('the abandoned start did not eat the next run',
   !t.some(x => Math.abs(x - 460) < 5), JSON.stringify(t));

console.log('\nthe finish belongs to the LATEST start before it');
/* Two starts in a row, then one finish: the run began at the second. */
const RESTART = drive([
    [0, -300], [100, 0],      /* start crossing #1 */
    [160, 400],               /* out a little way */
    [220, -300],              /* aborts, comes back (backward crossing) */
    [320, 0],                 /* start crossing #2 */
    [480, 2200],              /* finish -> 160 s from the SECOND start */
    [520, 2400]
]);
const rt = timesOf(RESTART, F.split(RESTART));
ok('one run', rt.length === 1, JSON.stringify(rt));
ok('timed from the second start', Math.abs(rt[0] - 160) < 0.05, String(rt[0]));

console.log('\na finish with no start before it is not a run');
const FINISH_FIRST = drive([
    [0, 1800],       /* joins the circuit past the start line */
    [40, 2200],      /* crosses the finish having never crossed the start */
    [80, 2400],
    [280, -300],     /* back to the paddock */
    [380, 0],        /* NOW crosses the start */
    [540, 2200],     /* and the finish -> the only run, 160 s */
    [580, 2400]
]);
const ff = timesOf(FINISH_FIRST, F.split(FINISH_FIRST));
ok('one run', ff.length === 1, JSON.stringify(ff));
ok('and it is the timed one', Math.abs(ff[0] - 160) < 0.05, String(ff[0]));

console.log('\ntwo finishes with no start between them make one run');
const DOUBLE_FIN = drive([
    [0, -300], [100, 0],      /* start */
    [260, 2200],              /* finish -> 160 s */
    [300, 2400],
    [340, 2100],              /* backs over the finish line the wrong way */
    [400, 2400]               /* and forward across it again, no start between */
]);
const df = timesOf(DOUBLE_FIN, F.split(DOUBLE_FIN));
ok('one run, not two', df.length === 1, JSON.stringify(df));
ok('timed to the FIRST finish', Math.abs(df[0] - 160) < 0.05, String(df[0]));

console.log('\ndirection still decides which crossings count');
/* Drive the whole thing the other way round: the gates fire in reverse, and
   the pairing must run finish-gate-first without inventing negative runs. */
const BACKWARDS = drive([
    [0, 2400], [100, 2200],   /* crosses the FINISH gate southbound */
    [260, 0],                 /* crosses the START gate southbound */
    [300, -300]
]);
const bw = timesOf(BACKWARDS, F.split(BACKWARDS));
ok('no run from a single pass the wrong way', bw.length === 0, JSON.stringify(bw));
ok('and certainly no negative time', bw.every(x => x > 0), JSON.stringify(bw));

console.log('\na circuit is still timed line to line');
F.setTrack({ start_finish: START, finish: null });
const LAPS = drive([
    [0, -300], [100, 0],      /* crossing 1 */
    [200, 900], [280, 0],     /* not a crossing: turns back before... no, passes */
    [300, -200],
    [400, 0],                 /* crossing 2 (forward) */
    [500, 900], [600, -200],
    [700, 0],                 /* crossing 3 (forward) */
    [800, 900]
]);
const cl = timesOf(LAPS, F.split(LAPS));
ok('consecutive crossings make laps', cl.length === 2, JSON.stringify(cl));
ok('each is the gap between them', cl.every(x => Math.abs(x - 300) < 0.05),
   JSON.stringify(cl));

/* ---- the dead time the line keeps after it fires -----------------------
 * "Minimum lap time" in the Tracks inspector. lap_core.c rejects a start
 * crossing that comes sooner than that after the line last fired
 * (crossings_rejected_mintime); Studio used to ignore it entirely, so a car
 * crawling over the line produced a five-second "lap" here that the dash
 * never reported. Two answers to one question, from the same samples.
 *
 * gpRunsFromCrossings(startHits, finishHits, isTrial, deadMs, diag) takes the
 * crossings straight, so these are about the rule and not about geometry.
 */
console.log('\nhow long the line stays deaf');
ok('the stored value, in ms', F.deadMs({ min_lap_time_s: 25 }) === 25000,
   String(F.deadMs({ min_lap_time_s: 25 })));
ok('zero means the ten seconds the dash forces', F.deadMs({ min_lap_time_s: 0 }) === 10000,
   String(F.deadMs({ min_lap_time_s: 0 })));
ok('and so does a negative one', F.deadMs({ min_lap_time_s: -5 }) === 10000);
ok('and a missing one', F.deadMs({}) === 10000);
ok('and no track at all', F.deadMs(null) === 10000);

/* crossing stubs: i is the sample index (ordering), t the instant in ms */
const X = (i, t) => ({ i: i, t: t });

console.log('\na circuit ignores a second crossing inside the dead time');
/* Crawling over the line: 0 s, then 3 s later, then a real lap at 95 s. */
let r = F.runs([X(0, 0), X(10, 3000), X(100, 95000)], [], false, 10000);
ok('one lap, not two', r.length === 1, JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));
ok('and it is the real 95 s one', r[0].tFrom === 0 && r[0].tTo === 95000,
   JSON.stringify(r[0]));

console.log('\nbut a crossing past the dead time counts');
r = F.runs([X(0, 0), X(10, 11000), X(100, 95000)], [], false, 10000);
ok('two laps', r.length === 2, JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));
ok('11 s then 84 s', (r[0].tTo - r[0].tFrom) === 11000 && (r[1].tTo - r[1].tFrom) === 84000,
   JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));

console.log('\nthe dead time is measured from the last crossing, not the last lap');
/* Three crossings 6 s apart: the second is rejected, and the third is
   measured against the FIRST (the last one that actually fired), so it is
   12 s clear and counts. */
r = F.runs([X(0, 0), X(10, 6000), X(20, 12000)], [], false, 10000);
ok('one lap', r.length === 1, JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));
ok('0 s to 12 s', r[0].tFrom === 0 && r[0].tTo === 12000, JSON.stringify(r[0]));

console.log('\nthe very first crossing is never too soon');
/* Nothing is armed yet, so there is no line to be deaf. */
r = F.runs([X(0, 500), X(10, 60000)], [], false, 10000);
ok('it arms and the next crossing closes a lap', r.length === 1, JSON.stringify(r));

console.log('\na sprint re-arms at once after its finish');
/* Cross start, cross finish 40 s later, then start again 2 s after that --
   well inside the dead time, but the line is DISARMED, and lap_core reaches
   its !armed branch before the min-time test. A second run must be possible
   straight away. */
r = F.runs([X(0, 0), X(50, 42000)], [X(40, 40000), X(90, 82000)], true, 10000);
ok('two runs', r.length === 2, JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));
ok('40 s then 40 s', (r[0].tTo - r[0].tFrom) === 40000 && (r[1].tTo - r[1].tFrom) === 40000,
   JSON.stringify(r.map(x => (x.tTo - x.tFrom) / 1000)));

console.log('\nbut a sprint restart INSIDE the dead time is jitter, not a retake');
/* Armed, and the start line fires again 3 s later: on a real hillclimb the
   car has not come back round in three seconds. Rejected, so the run still
   times from the first crossing. */
r = F.runs([X(0, 0), X(5, 3000)], [X(80, 90000)], true, 10000);
ok('one run', r.length === 1, JSON.stringify(r));
ok('timed from the first crossing', r[0].tFrom === 0 && r[0].tTo === 90000,
   JSON.stringify(r[0]));

console.log('\nand a real retake past the dead time still restarts it');
r = F.runs([X(0, 0), X(50, 40000)], [X(80, 90000)], true, 10000);
ok('one run', r.length === 1, JSON.stringify(r));
ok('timed from the SECOND crossing', r[0].tFrom === 40000, JSON.stringify(r[0]));

console.log('\nthe rejections are counted, so a diagnosis can say so');
const diag = {};
F.runs([X(0, 0), X(10, 3000), X(20, 4000), X(100, 95000)], [], false, 10000, diag);
ok('two crossings rejected', diag.rejectedMinTime === 2, String(diag.rejectedMinTime));

console.log('\nnothing to time');
F.setTrack({ start_finish: START, finish: FINISH });
ok('no samples', F.split([]).length === 0);
ok('one sample', F.split([{ lat: LAT0, lon: LON0, t: 0 }]).length === 0);
F.setTrack(null);
ok('no track', F.split(DAY).length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
