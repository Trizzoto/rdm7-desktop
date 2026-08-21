/* Track up: does the map turn to the angle the car is actually travelling?
 *
 * The heading the map rotates by is eased during playback, where the car turns
 * a degree or two per sample and a snap would jitter. A SCRUB is not playback
 * — it is a jump — and easing a jump leaves the car visibly askew: seeking
 * into a corner pointed it 30 degrees off vertical, because the angle was
 * still most of the way back at the old heading. Past a few degrees this is a
 * seek, so it lands on the new heading instead.
 *
 * Also guards the standstill rule: course over ground is Doppler-derived and
 * trustworthy while moving, but noise at rest, and a map that spins while the
 * car sits on the grid is unusable.
 *
 *   node tools/check_trackup.js
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

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const missing = [];
const parts = [];
for (const n of ['gpTrackUpAngle']) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}

const F = new Function(`
    var gp = { trace: [], _tuAngle: null };
    ${parts.join('\n')}
    return {
        gp: gp,
        angle: (typeof gpTrackUpAngle === 'function') ? gpTrackUpAngle : null,
    };
`)();

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
};

if (missing.length) { console.log('(not in this revision: ' + missing.join(', ') + ')\n'); }
if (!F.angle) { console.log('gpTrackUpAngle missing — nothing to check'); process.exit(1); }

/* rows are (heading, speed) pairs; the function reads .hdg and .kph */
const set = (rows, start) => { F.gp.trace = rows; F.gp._tuAngle = start; };
const row = (hdg, kph) => ({ hdg: hdg, kph: kph === undefined ? 120 : kph });

console.log('the first sample lands on its own heading');
set([row(90)], null);
ok('no previous angle means take the heading as-is', F.angle(0) === 90, 'got ' + F.angle(0));

console.log('\nplayback: small changes are eased, not snapped');
set([row(100)], 90);
const eased = F.angle(0);
ok('a 10 degree change eases part-way', eased > 90 && eased < 100, 'got ' + eased);
ok('and it moves toward the new heading', eased > 90, 'got ' + eased);

console.log('\nseeking: a big jump lands on the heading');
set([row(150)], 90);
ok('a 60 degree jump snaps to the target', F.angle(0) === 150, 'got ' + F.angle(0));
set([row(270)], 90);
ok('a 180 degree jump snaps too', F.angle(0) === 270, 'got ' + F.angle(0));

console.log('\nthe short way round the compass');
set([row(10)], 350);
const wrap = F.angle(0);
ok('350 to 10 does not sweep the long way through 180',
   wrap === 10 || (wrap > 350 || wrap < 20), 'got ' + wrap);

console.log('\nstandstill: hold the last good heading');
set([row(123, 0)], 45);
ok('a stationary car does not turn the map', F.angle(0) === 45, 'got ' + F.angle(0));
set([row(123, 3)], 45);
ok('walking pace does not either', F.angle(0) === 45, 'got ' + F.angle(0));
set([row(123, 40)], 45);
ok('moving properly does turn it', F.angle(0) === 123, 'got ' + F.angle(0));

console.log('\nrubbish in, last good angle out');
set([row(NaN)], 77);
ok('a non-finite heading is ignored', F.angle(0) === 77, 'got ' + F.angle(0));
set([], 55);
ok('a missing sample is ignored', F.angle(0) === 55, 'got ' + F.angle(0));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
