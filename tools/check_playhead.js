/* Does the playhead sit BETWEEN samples, or snap to one?
 *
 * The clock was always right — 1x measured 1.016 against the wall — but the
 * car moved in sample-sized hops, because the position was a whole index.
 * On the 10 Hz Donington log that is five and a half metres at a time at
 * 200 km/h, redrawn at 20 fps, so half the frames were duplicates of the one
 * before and the motion read as wrong even though the timing was not.
 *
 * Same family as the lap-time quantisation: rounding to the sample grid.
 * gpLapPosAtSecs returns the sample AND the fraction of the step past it, and
 * gpDrawnAtF puts the car on the line between the two.
 *
 *   node tools/check_playhead.js
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

const WANT = ['gpSecs', 'gpSpanSecs', 'gpLapIdxAtSecs', 'gpLapPosAtSecs', 'gpDrawnAt', 'gpDrawnAtF',
              'gpPlayFrac', 'gpPlaySecs'];
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [], missing = [];
for (const n of WANT) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}

const F = new Function(`
    var GP_DT = 0.1;
    var gp = { trace: [], playIdx: 0, playSub: 0, playSubIdx: -1 };
    var LAP = { from: 0, to: 0 };
    function gpLapRange() { return LAP; }
    /* the drawn line is the raw fixes here; the smoother is not what is under test */
    function gpSmoothPath() { return null; }
    ${parts.join('\n')}
    return {
        gp: gp,
        pos: (typeof gpLapPosAtSecs === 'function') ? gpLapPosAtSecs : null,
        at: (typeof gpDrawnAtF === 'function') ? gpDrawnAtF : null,
        idx: (typeof gpLapIdxAtSecs === 'function') ? gpLapIdxAtSecs : null,
        frac: (typeof gpPlayFrac === 'function') ? gpPlayFrac : null,
        secs: (typeof gpPlaySecs === 'function') ? gpPlaySecs : null,
        setLap: function (l) { LAP = l; },
    };
`)();

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

if (missing.length) console.log('(not in this revision: ' + missing.join(', ') + ')\n');
if (!F.pos || !F.at) { console.log('interpolation helpers missing'); process.exit(1); }

/* A straight 10 Hz run heading due east, one metre-ish per sample. */
const N = 60;
F.gp.trace = [];
for (let i = 0; i < N; i++) {
    F.gp.trace.push({ lat: 10, lon: 20 + i * 0.001, kph: 100, hdg: 90, t: i * 100 });
}
const lap = { from: 0, to: N - 1 };

console.log('a moment between two samples is reported as such');
let p = F.pos(lap, 0.25);              /* a quarter of the way into step 0->1 */
ok('lands on the sample below', p.i === 2, 'got i=' + p.i);
ok('and carries the fraction past it', near(p.f, 0.5, 1e-6), 'got f=' + p.f);

p = F.pos(lap, 0.10);
ok('exactly on a sample gives a whole index', p.i === 1 && near(p.f, 0, 1e-6),
   'got i=' + p.i + ' f=' + p.f);

console.log('\nthe fraction actually moves the drawn point');
const a = F.at(2, 0), b = F.at(2, 0.5), c = F.at(3, 0);
ok('a half step sits between its two samples',
   b[1] > a[1] && b[1] < c[1], JSON.stringify([a[1], b[1], c[1]]));
ok('and sits halfway, not somewhere arbitrary',
   near(b[1], (a[1] + c[1]) / 2, 1e-9), 'got ' + b[1]);

console.log('\nsub-sample steps really are sub-sample');
/* 20 fps over 10 Hz data: every frame must be a new place, or the motion is
   the judder this whole change exists to remove. */
const seen = new Set();
for (let k = 0; k < 20; k++) {
    const q = F.pos(lap, k * 0.05);
    const ll = F.at(q.i, q.f);
    seen.add(ll[0].toFixed(9) + ',' + ll[1].toFixed(9));
}
ok('20 frames across 1 s give 20 distinct positions on a 10 Hz log',
   seen.size === 20, 'got ' + seen.size);

console.log('\nthe ends stay put');
p = F.pos(lap, -5);
ok('before the start clamps to the first sample', p.i === lap.from && p.f === 0);
p = F.pos(lap, 999);
ok('past the end clamps to the last sample', p.i === lap.to && p.f === 0);
ok('a zero fraction returns the sample point unchanged',
   F.at(4, 0)[1] === F.gp.trace[4].lon);
ok('a fraction off the end of the data does not invent a point',
   F.at(N - 1, 0.5)[1] === F.gp.trace[N - 1].lon);

console.log('\nit still agrees with the whole-sample answer');
ok('gpLapIdxAtSecs is unchanged for exact samples', F.idx(lap, 0.30) === 3,
   'got ' + F.idx(lap, 0.30));

/* ---- the playhead's clock, which is what the GHOST reads ---------------
 * The car is drawn at playIdx PLUS the fraction. The ghost was drawn at the
 * time of playIdx alone — the same figure rounded down to the sample below —
 * so on this 10 Hz log its clock only advanced every other ticker frame: it
 * stood still for a tenth of a second and then jumped, against a car gliding
 * past it. gpPlaySecs is the fractional answer, and it has to be the exact
 * inverse of gpLapPosAtSecs or the two end up on different clocks. */
if (!F.secs || !F.frac) {
    console.log('\n(gpPlaySecs / gpPlayFrac not in this revision)');
} else {
    F.setLap(lap);
    const place = (i, f, forIdx) => {
        F.gp.playIdx = i;
        F.gp.playSub = f;
        F.gp.playSubIdx = forIdx === undefined ? i : forIdx;
    };

    console.log('\nthe playhead clock carries the fraction');
    place(3, 0);
    ok('on a sample it is just that sample time', near(F.secs(), 0.30, 1e-9), 'got ' + F.secs());
    place(3, 0.5);
    ok('half a step past it is half a step later', near(F.secs(), 0.35, 1e-9), 'got ' + F.secs());
    place(0, 0.25);
    ok('and it works from the first sample too', near(F.secs(), 0.025, 1e-9), 'got ' + F.secs());

    console.log('\na fraction measured against another sample is ignored');
    /* Four transport buttons, the coach jumps and the lap roll-over all
       assign playIdx directly and leave playSub where it was. A fraction that
       outlived its index would draw the car past the wrong sample — pressing
       "back to the start" would land it a tenth of a second into the lap. */
    place(7, 0.8, 3);
    ok('the stale fraction does not count', F.frac() === 0, 'got ' + F.frac());
    ok('so the clock is the whole sample', near(F.secs(), 0.70, 1e-9), 'got ' + F.secs());
    place(7, 0.8, 7);
    ok('the fresh one does', near(F.frac(), 0.8, 1e-9), 'got ' + F.frac());

    console.log('\nround trip: what the ticker computes, the ghost reads back');
    /* This is the invariant the ghost depends on. The ticker turns a wall-clock
       moment into {i, f}; the ghost turns {i, f} back into a moment to find the
       reference lap at. If those two disagree by even part of a sample, the
       ghost is that far behind the car for ever. */
    let worst = 0;
    for (let k = 0; k < 200; k++) {
        const want = k * 0.0137;                    /* deliberately off the sample grid */
        if (want >= 5.9) break;
        const p = F.pos(lap, want);
        place(p.i, p.f);
        worst = Math.max(worst, Math.abs(F.secs() - want));
    }
    ok('every moment survives the round trip', worst < 1e-9, 'worst drift ' + worst);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
