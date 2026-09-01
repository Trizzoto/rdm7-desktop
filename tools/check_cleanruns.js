/* A flagged run never sets a headline number, and never hides that it is one.
 *
 * gpSplitRows grades every run it finds and hangs a `flag` on the ones it
 * will not stand behind — a lost fix ("gap"), a position that teleports
 * ("jump"), or a lap so far off the pace it was plainly not a lap ("slow").
 * gpCleanRuns is the filter, and its own comment says the rule: "everything
 * that reports a best, picks a reference, takes the track's shape or writes a
 * number onto the session card reads THIS, not gp.traceLaps."
 *
 * Three things did not. The page head, the share card, and the corner
 * analysis's two lap pickers all read gp.traceLaps with only the ghosts taken
 * out. On the committed 23 August Mallala session that put "Spread 613.59 s"
 * across the top of the screen — 613 s being the size of an eight-minute
 * hole in the receiver's fix, not the size of anybody's driving — and offered
 * "Lap 3 · 12:33.810" in a dropdown that decides what every corner in the
 * table is measured against.
 *
 * A gap cuts the other way too, which is the reason this matters beyond
 * tidiness: time that was never measured makes a lap read FAST, so a flagged
 * run can win a "best" outright.
 *
 * What is pinned here:
 *   - the three sites read gpCleanRuns
 *   - on the real recording, doing it the old way still produces 613.59 s,
 *     so the harness is measuring the thing that was actually wrong
 *   - a flagged run is named in the pickers, in the words the lap list uses
 *   - those words have one definition, not one per screen
 *
 *   node tools/check_cleanruns.js
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

/* ---- lifting, verbatim, the same rule as every harness here ------------- */
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

/* ---- the source rule ---------------------------------------------------- */
/* The body of one function, so "does the head read gpCleanRuns" is a question
   about the head and not about the file. */
function bodyOf(name) { return grab(name); }

console.log('the three sites that were reading every run');

const head = bodyOf('gpRenderCtx');
ok('the page head takes its Best, Ideal and Spread from gpCleanRuns',
   /var laps = gpCleanRuns\(\)/.test(head),
   'gpRenderCtx builds the three tags above the mosaic; reading gp.traceLaps ' +
   'there is what printed "Spread 613.59 s"');
ok('and it no longer filters the runs itself',
   !/traceLaps \|\| \[\]\)\.filter\(function \(l\) \{ return !l\.ghost; \}\);\s*\n\s*var times/.test(head),
   'a local !ghost filter beside gpCleanRuns is the old code coming back');

const share = bodyOf('gpShareStats');
ok('the share card takes its best from gpCleanRuns',
   /gpCleanRuns\(\)\.forEach/.test(share),
   'this is the card that leaves the building');
/* But not its lap COUNT. How many laps you drove is a fact about the driving,
   and a lap with a dropout in it was still driven. Only the time has to come
   off a run the app will vouch for. */
ok('and its lap count from every real run',
   /var laps = \(gp\.traceLaps \|\| \[\]\)\.filter\(function \(l\) \{ return !l\.ghost; \}\)/.test(share),
   'counting only the clean ones told a driver who did four laps that they did one');

/* The two dropdowns live inside gpRenderCorners' lapOpts. */
const corners = bodyOf('gpRenderCorners');
ok('the corner analysis builds its lap pickers', /var lapOpts = function/.test(corners));
ok('and a flagged run is named in the option itself',
   /gpRunFlagWord\(l\)/.test(corners) && /gpRunFlagWhy\(l\)/.test(corners),
   'both pickers feed every number in the corner table — an unmarked ' +
   '"Lap 3 · 12:33.810" is 12 minutes of nothing being used as a reference');

console.log('\none definition of the words, not one per screen');
ok('gpRunFlagWord exists', /function gpRunFlagWord\s*\(/.test(SRC));
/* The Lap times panel used to spell the mapping out inline. If it comes back
   the two will drift, and the drift will be invisible: both say something
   plausible. */
const inline = SRC.match(/flag === "gap" \? "no fix"/g) || [];
ok('and it is the only place the three words are chosen',
   inline.length === 1,
   'found ' + inline.length + ' — the panel and the picker must not each own a copy');

console.log('\nmeasured, on the 23 August Mallala session');

/* golden_lib's own sandbox, and its own order of operations. Rolling a
   second chain here would measure a different set of runs from the one the
   answer sheet was blessed against — gpComputeG has to mark the breaks
   before gpGradeRuns can flag a run for having one. */
const spec = MAN.fixtures.find(f => f.name === 'mallala-2026-08-23');
const fx = spec ? G.readFixture(spec) : null;
if (!fx) {
    console.log('  -- fixture missing, skipping the measured half');
} else {
    const track = JSON.parse(JSON.stringify(fx.track || spec.track));
    const S = G.sandbox(track), API = S.API, gp = S.gp;
    gp.trace = fx.rows;
    gp.traceChanIds = fx.chanIds || null;
    gp.traceChanDefs = fx.chanDefs || null;
    gp.ghostFence = null;
    gp.tracks.active = track.id;
    API.gpComputeG(gp.trace);
    gp.traceLaps = API.gpSplitRows(gp.trace, {});
    gp.lapsFrom = 'gate';

    const all = gp.traceLaps.filter(l => !l.ghost);
    const clean = API.gpCleanRuns();
    /* The blessed sheet for this recording: four laps, one of them clean. */
    ok('the session splits into four laps', all.length === 4, 'found ' + all.length);
    ok('and three of them are flagged for a lost fix',
       all.filter(l => l.flag === 'gap').length === 3,
       all.map(l => l.flag || 'clean').join(', '));
    ok('so exactly one is clean', clean.length === 1, clean.length + ' clean');

    const secs = l => API.gpSpanSecs(gp.trace, l);
    const allT = all.map(secs), cleanT = clean.map(secs);

    /* The negative half: what the head used to print. Pinned as a number so
       that if the run splitting ever changes, this fails loudly instead of
       quietly becoming a test of nothing. */
    const wrongSpread = Math.max(...allT) - Math.min(...allT);
    ok('doing it the old way still puts a ten-minute spread on the screen',
       wrongSpread > 600 && wrongSpread < 700,
       'got ' + wrongSpread.toFixed(2) + ' s — the longest lap is 87 % lost fix');

    /* And the fix: one clean run, so there is no spread to report at all and
       the best is the lap that was measured end to end. */
    ok('there is no spread to offer from one clean lap', cleanT.length === 1);
    ok('and the best is the lap with no hole in it',
       Math.abs(Math.min(...cleanT) - 136.091) < 0.01,
       'got ' + Math.min(...cleanT).toFixed(3) + ', sheet says 136.091');

    /* Naming the worst one is the whole point of the picker change. */
    const worst = all[allT.indexOf(Math.max(...allT))];
    ok('the longest lap is the one that says "no fix"',
       API.gpRunFlagWord(worst) === 'no fix',
       'got "' + API.gpRunFlagWord(worst) + '"');
    ok('and its reason names the seconds that went missing',
       /lost its fix for \d+\.\d s/.test(API.gpRunFlagWhy(worst)),
       API.gpRunFlagWhy(worst).slice(0, 90));
    ok('a clean lap has no word and no reason',
       API.gpRunFlagWord(clean[0]) === '' && API.gpRunFlagWhy(clean[0]) === '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
