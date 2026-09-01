/* The golden recordings: real drives, pinned (ADR-0050).
 *
 * Every other harness that touches the analysis engine runs on data we
 * generated, and synthetic data is exactly where this engine looks perfect —
 * check_mallala.js recovers a PLANTED 1.008 gyro scale, 65 checks, every time,
 * while the real 23 August session produced +54 then -48 degrees inside one
 * corner. A generator cannot plant the fault it does not know about.
 *
 * So: real recordings, committed, with answer sheets a person read and signed
 * off. Any engine change that moves one of these numbers fails here, loudly
 * and by name. Re-blessing is a normal event — run
 *
 *     node tools/make_expected.js <name>            see what moved
 *     node tools/make_expected.js <name> --bless    sign the new numbers off
 *
 * and say WHY in the commit message.
 *
 *   node tools/check_golden.js
 */
const fs = require('fs');
const path = require('path');
const G = require('./golden_lib.js');

const MANIFEST = path.join(G.FIXTURES, 'fixtures.json');
let pass = 0, fail = 0, skipped = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
}

if (!fs.existsSync(MANIFEST)) {
    console.log('no fixtures manifest — nothing to check');
    console.log('\n0 passed, 0 failed');
    process.exit(0);
}
const specs = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).fixtures;

/* Tolerances, tightest first. Counts and indices are EXACT: a break moving one
   sample, or a lap appearing, is never a rounding difference. Only the fitted
   floats get a window, and a narrow one. */
const TOL = {
    'hz': 0.001,
    'laps.timesS': 0.001,        /* interpolated crossings — deterministic, but float */
    'laps.bestS': 0.001,
    'runs.secs': 0.05,
    'gate.nearestM': 0.05,
    'angle.scale': 0.001,
    'angle.bias': 0.001,
    'angle.peakDeg': 0.05,
    'angle.typicalDeg': 0.01,
    'angle.worstDeg': 0.01
};
function tolFor(at) {
    if (TOL[at] !== undefined) return TOL[at];
    /* Array members inherit their array's tolerance: laps.timesS.3 -> laps.timesS */
    const parent = at.replace(/\.\d+$/, '');
    return TOL[parent] !== undefined ? TOL[parent] : 0;
}

/* Walk expected against actual and collect every leaf that moved by more than
   its tolerance. Reports the FIELD, not a count — "3 failed" costs more than
   it saves on a test like this. */
function compare(exp, got, at, out) {
    at = at || ''; out = out || [];
    if (Array.isArray(exp) || Array.isArray(got)) {
        const a = exp || [], b = got || [];
        if (a.length !== b.length) {
            out.push({ at: at + '.length', was: a.length, now: b.length });
            return out;
        }
        a.forEach(function (v, i) { compare(v, b[i], at + '.' + i, out); });
        return out;
    }
    if (exp && typeof exp === 'object' || got && typeof got === 'object') {
        const keys = Object.keys(Object.assign({}, exp || {}, got || {}));
        keys.forEach(function (k) {
            compare(exp ? exp[k] : undefined, got ? got[k] : undefined,
                    at ? at + '.' + k : k, out);
        });
        return out;
    }
    if (typeof exp === 'number' && typeof got === 'number') {
        const t = tolFor(at);
        if (Math.abs(exp - got) > t)
            out.push({ at: at, was: exp, now: got, tol: t });
        return out;
    }
    if (exp !== got) out.push({ at: at, was: exp, now: got });
    return out;
}

/* Why each of these is in the repo at all. */
const MEANS = {
    'mountbarker-ring-2026-08-22': [
        { what: 'the six breaks found by hand are still all six',
          holds: g => g.breaks.count === 6,
          detail: g => String(g.breaks.count) },
        { what: '…and exactly one of them still has a wrong clock — the 444 m at 84,115',
          holds: g => g.breaks.clockWrongAt.length === 1 &&
                      g.breaks.clockWrongAt[0] === 84115 &&
                      g.breaks.metres[5] === 444,
          detail: g => JSON.stringify(g.breaks.clockWrongAt) + ' ' + JSON.stringify(g.breaks.metres) },
        { what: 'a drive that never reaches its own timing line still times no laps',
          holds: g => g.laps.by !== 'gate' && g.gate.hits === 0 && g.gate.nearestM > 1000,
          detail: g => g.laps.by + ', nearest ' + g.gate.nearestM + ' m' },
        { what: '…and the angle on it is still REFUSED rather than given a number',
          holds: g => !!(g.angle && g.angle.weak),
          detail: g => JSON.stringify(g.angle && g.angle.weak) }
    ],
    'mallala-2026-08-23': [
        /* The recording the trust panel exists because of. The engine did not
           refuse this one — the fit succeeded, 152 anchors, scale within a
           few per cent — and it was still wrong in the middle of a leg. */
        { what: 'the +54° corner is still in it',
          holds: g => g.angle && g.angle.peakDeg >= 50,
          detail: g => 'peak ' + (g.angle && g.angle.peakDeg) + '°' },
        { what: '…and the fit still LOOKS fine, which is why nothing caught it',
          holds: g => g.angle && g.angle.weak === false && g.angle.anchors > 100 &&
                      g.angle.scale > 0.9 && g.angle.scale < 1.1,
          detail: g => JSON.stringify({ weak: g.angle.weak, anchors: g.angle.anchors,
                                        scale: g.angle.scale }) },
        /* This is the exact shape the trust panel's angle row watches for:
           confident nearly everywhere, far less certain somewhere. If a
           change to the engine ever flattens it, the panel stops warning
           about this recording and nobody would otherwise notice. */
        { what: '…and it is still confident overall but far worse somewhere',
          holds: g => g.angle && g.angle.worstDeg > Math.max(4, g.angle.typicalDeg * 3),
          detail: g => '±' + (g.angle && g.angle.typicalDeg) + '° typical, ±' +
                       (g.angle && g.angle.worstDeg) + '° worst' },
        { what: 'the lap it advertises is still reproducible from the file alone',
          holds: g => g.laps.by === 'gate' && g.laps.clean === 1 &&
                      Math.abs(g.laps.bestS - 136.091) < 0.002,
          detail: g => g.laps.by + ', ' + g.laps.clean + ' clean, best ' + g.laps.bestS }
    ]
};

specs.forEach(function (spec) {
    console.log('\n' + spec.name);
    const sheetPath = path.join(G.FIXTURES, spec.name + '.expected.json');
    const file = path.join(G.FIXTURES, spec.file);

    if (!fs.existsSync(file)) {
        /* A fixture that is not here is a fixture nobody committed, which is a
           real gap and is said out loud — but it is not a failure of the
           engine, so it does not fail the suite. */
        console.log('  --    the recording is not in tools/fixtures/ — skipped');
        skipped++;
        return;
    }
    if (!fs.existsSync(sheetPath)) {
        ok(spec.name + ' has an answer sheet', false,
           'run: node tools/make_expected.js ' + spec.name + ' --bless');
        return;
    }
    const sheet = JSON.parse(fs.readFileSync(sheetPath, 'utf8'));
    ok('the sheet was blessed by a person, on a date',
       !!sheet.blessedOn, JSON.stringify(sheet.blessedOn));

    const got = G.analyse(spec);
    ok('the recording still loads through the app’s own chain', !!got);
    if (!got) return;

    const moved = compare(sheet.answers, got);
    ok('every pinned number still holds', moved.length === 0,
       moved.map(function (m) {
           return m.at + ': was ' + JSON.stringify(m.was) + ', now ' + JSON.stringify(m.now) +
                  (m.tol ? '  (tolerance ' + m.tol + ')' : '');
       }).join('\n          '));

    /* The comparison above catches ANY drift. These say what the drift would
       MEAN — the property each recording was committed for. Without them a
       re-bless could quietly walk a fixture away from the thing it is here to
       hold still, and every number would still "match its sheet". */
    (MEANS[spec.name] || []).forEach(function (m) {
        ok('  ' + m.what, m.holds(got), m.detail ? m.detail(got) : '');
    });

    /* Say what is actually being held still, so a green run is informative
       rather than merely quiet. */
    const a = got;
    console.log('        ' + a.samples.toLocaleString() + ' samples at ' + a.hz + ' Hz · ' +
        a.breaks.count + ' break' + (a.breaks.count === 1 ? '' : 's') +
        (a.breaks.clockWrongAt.length ? ' (' + a.breaks.clockWrongAt.length + ' with a bad clock)' : '') +
        ' · ' + (a.laps.by === 'gate'
            ? a.laps.clean + ' clean laps, best ' + a.laps.bestS + ' s'
            : a.laps.by === 'stops' ? a.runs.count + ' runs, cut at the stops'
            : 'nothing timed it') +
        (a.angle ? ' · angle ' + (a.angle.weak ? 'refused (uncalibrated)'
                                              : '±' + a.angle.typicalDeg + '°') : ''));
});

if (skipped) {
    console.log('\n  ' + skipped + ' fixture(s) named in fixtures.json are not committed yet — ' +
                'see the _wanted note in that file.');
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
