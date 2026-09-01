/* A recording is never silently timed against somebody else's circuit.
 *
 * A .rdmsession carries the trackId of the PC that made it, and importing one
 * from another PC is a flow the app offers in as many words ("a .rdmsession
 * from another PC running Studio"). Those ids mean nothing here.
 *
 * gpSessionLoad had two branches — an explicit "no track", and a trackId this
 * library HAS — and an unknown one matched neither. It fell out of the if,
 * gp.tracks.active kept whatever was open before, and the recording was cut
 * into laps by a stranger's start/finish line. Nothing on screen said so.
 *
 * The measured cost, on the committed 23 August Mallala golden:
 *   - against its own gate:      4 laps, best 136.091 s
 *   - against a borrowed gate at a DIFFERENT circuit:  no laps at all
 * and against a second local Mallala with its own hand-placed line, 2:20.220
 * where the file means 2:16.091 — which is the dangerous one, because it
 * looks entirely reasonable.
 *
 * What is pinned:
 *   - the unknown-trackId case is handled, and matches by where the car
 *     actually drove
 *   - it uses gpTrackForRows, which cannot mint: opening a recording must
 *     not add a track to the library
 *   - gpMatchTrack still mints when nothing in the library fits, because
 *     filing a recording deliberately is a different question
 *   - and the numbers above, so the harness cannot become a test of nothing
 *
 *   node tools/check_borrowedtrack.js
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
function grab(name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' +
                          name + ' = function)', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}

console.log('gpSessionLoad answers for a track it has never heard of');

const load = grab('gpSessionLoad');
ok('there is a branch for a trackId the library does not have',
   /else if \(meta\.trackId && gp\.tracks\) \{/.test(load),
   'an unknown id used to fall out of the if with gp.tracks.active untouched');
ok('and it decides by where the car drove',
   /gpTrackForRows\(rows\)/.test(load));
ok('never by minting a track',
   !/gpMatchTrack\(/.test(load),
   'gpMatchTrack pushes a new track into the library and saves it — opening ' +
   'a recording must not do that');
ok('nothing here fitting means no track, not the last one',
   /gp\.tracks\.active = lib \? lib\.track\.id : null/.test(load));
ok('and the borrowing is said out loud', /gpImportSaid\(/.test(load));

console.log('\nthe two halves of the match stay apart');
const match = grab('gpMatchTrack');
const forRows = grab('gpTrackForRows');
ok('gpTrackForRows only reads the library',
   !/gpTracksSave|tracks\.push/.test(forRows),
   'it is the half that must have no side effect');
ok('gpMatchTrack still mints when nothing in the library fits',
   /gp\.tracks\.tracks\.push\(t\)/.test(match) && /gpTracksSave\(\)/.test(match),
   'filing a recording on purpose is allowed to invent a track');
ok('and it asks the library first', /gpTrackForRows\(rows\)/.test(match));

console.log('\nmeasured, on the 23 August Mallala golden');

const spec = MAN.fixtures.find(f => f.name === 'mallala-2026-08-23');
const donSpec = MAN.fixtures.find(f => f.name === 'donington-driver1');
const fx = spec ? G.readFixture(spec) : null;
const donFx = donSpec ? G.readFixture(donSpec) : null;
if (!fx || !donFx) {
    console.log('  -- fixture missing, skipping the measured half');
} else {
    const own = JSON.parse(JSON.stringify(fx.track || spec.track));
    const other = donFx.track;

    function lapsAgainst(track) {
        const S = G.sandbox(track), API = S.API, gp = S.gp;
        gp.trace = fx.rows;
        gp.ghostFence = null;
        gp.tracks.active = track ? track.id : null;
        API.gpComputeG(gp.trace);
        const laps = API.gpSplitRows(gp.trace, {});
        const clean = laps.filter(l => !l.ghost && !l.flag)
                          .map(l => API.gpSpanSecs(gp.trace, l));
        return { n: laps.length, best: clean.length ? Math.min(...clean) : null };
    }

    const mine = lapsAgainst(own);
    ok('against its own gate it is four laps, best 136.091',
       mine.n === 4 && Math.abs(mine.best - 136.091) < 0.01,
       mine.n + ' laps, best ' + (mine.best === null ? 'none' : mine.best.toFixed(3)));

    const borrowed = lapsAgainst(other);
    ok('against a gate at a different circuit it is nothing at all',
       borrowed.n === 0,
       'got ' + borrowed.n + ' laps — if a Donington line can cut a Mallala ' +
       'drive into laps, gate hit-testing has a bigger problem than this file');

    /* And the case the branch is really for: another track in the library
       that IS at this circuit. gpTrackForRows must find it. */
    const S = G.sandbox(own);
    S.gp.tracks.tracks = [other, own];
    S.gp.trace = fx.rows;
    const found = S.API.gpTrackForRows(fx.rows);
    ok('gpTrackForRows picks the circuit the car was actually at',
       found && found.track.id === own.id,
       found ? 'picked ' + found.track.name : 'found nothing');
    ok('and reports that it did not invent it', found && found.made === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
