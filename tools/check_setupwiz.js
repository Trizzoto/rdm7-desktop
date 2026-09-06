/* Set it up for me — the puck (ADR-0067), and the two other bits of ADR-0067
 * arithmetic that can be wrong without anybody noticing.
 *
 * The wizard's whole claim is that it MEASURES the mounting rather than asking
 * about it. That claim is only worth something if the measurement is right, and
 * it is the one thing here that cannot be tried without a car: it reads raw
 * accelerometer axes off a device that is not on this desk.
 *
 * So the axes are synthesised. A puck bolted in at a known orientation produces
 * known readings — gravity on one axis, deceleration on another — and the
 * wizard has to name the orientation it was given back. If it cannot do that
 * from perfect data it certainly cannot do it from a real car, and if it names
 * one confidently from noise it will write a mounting that is wrong in a way
 * nothing downstream can detect.
 *
 *   node tools/check_setupwiz.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

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
function grabVar(s, name) {
    const re = new RegExp('^        var ' + name + ' = [^\n]*$', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

/* A multi-line `var NAME = [ … ];` — GP_DIRS is the vehicle-direction table
   and pulling it a line at a time produces half an array. */
function grabList(s, name) {
    const re = new RegExp('^        var ' + name + ' = \\[', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    let i = s.indexOf('[', m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') { depth--; if (depth === 0) { j += 2; break; } }
    }
    return s.slice(m.index, j);
}

const VARS = ['GPW_STILL_MS', 'GPW_ROLL_MS', 'GPW_LEVEL_MG', 'GPW_MIN_SWING', 'GPW_MIN_R',
              'GPW_AXIS', 'GP_CNAME_M', 'GP_CNAME_MAX', 'GP_RING_LOW_MIN'];
const LISTS = ['GP_DIRS'];
const FNS = ['gpwCorr', 'gpwMounting', 'gpw', 'gpDirVec', 'gpDirName', 'gpDeriveY',
             'gpCornerNames', 'gpCornerNameAt', 'gpCornerLabel', 'gpCornerNameSet',
             'gpMetres'];

const parts = [], missing = [];
for (const v of VARS) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
for (const v of LISTS) { try { parts.push(grabList(src, v)); } catch (e) { missing.push(v); } }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

function env() {
    const ctx = {
        console, isFinite, Math, JSON, Array, Object, Number, parseFloat, parseInt, String,
        gp: { gpw: null, tracks: null, trace: null },
        gpN: (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? null : +v),
        gpTracksSave() { ctx.saved = (ctx.saved || 0) + 1; },
        gpRenderGridSoft() { },
        gpActiveTrack: () => ctx.track,
        gpEsc: (s) => String(s)
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    return ctx;
}

/* ══ which way is up, which way is forward ═══════════════════════════════ */
console.log('the mounting it names is the one it was given');
{
    /* Every orientation the wizard can reach: gravity on one axis, the car's
       acceleration on another, in both signs. Sixteen of them, and it has to
       come back with a legal right-handed set every time. */
    const E = env();
    const AX = ['X', 'Y', 'Z'];
    let bad = [], n = 0;
    for (let d = 0; d < 3; d++) {
        for (let f = 0; f < 3; f++) {
            if (d === f) continue;
            for (const up of [true, false]) {
                for (const plus of [true, false]) {
                    n++;
                    E.gp.gpw = { down: { axis: d, up: up }, fwd: { axis: f, plus: plus } };
                    const m = E.gpwMounting();
                    if (!m) { bad.push('down ' + AX[d] + (up ? '+' : '-') + ' fwd ' + AX[f] + (plus ? '+' : '-') + ': null'); continue; }
                    const dirs = [m.x, m.y, m.z];
                    /* The two it measured must come back as it measured them. */
                    const wantD = up ? 'up' : 'down', wantF = plus ? 'forward' : 'back';
                    if (dirs[d] !== wantD || dirs[f] !== wantF)
                        bad.push('down ' + AX[d] + ' wanted ' + wantD + ' got ' + dirs[d] +
                                 ', fwd ' + AX[f] + ' wanted ' + wantF + ' got ' + dirs[f]);
                    /* …and the third must be the one the firmware would derive,
                       or node.config.set refuses the whole thing. */
                    else if (E.gpDeriveY(m.z, m.x) !== m.y)
                        bad.push(JSON.stringify(m) + ' is not right-handed');
                }
            }
        }
    }
    ok('all ' + n + ' orientations produce a legal, right-handed mounting',
       bad.length === 0, bad.slice(0, 3).join(' | '));
}
{
    const E = env();
    E.gp.gpw = { down: { axis: 1, up: true }, fwd: null };
    ok('one measurement alone writes nothing', E.gpwMounting() === null);
    E.gp.gpw = { down: null, fwd: { axis: 0, plus: true } };
    ok('and neither does the other', E.gpwMounting() === null);
}
{
    /* The impossible case: gravity and acceleration on the SAME axis. It
       cannot happen physically — the wizard excludes the vertical axis before
       correlating — but the function must not invent a mounting from it. */
    const E = env();
    E.gp.gpw = { down: { axis: 2, up: true }, fwd: { axis: 2, plus: true } };
    ok('one axis cannot be both up and forward', E.gpwMounting() === null);
}

/* ══ finding the axis in the first place ═════════════════════════════════ */
console.log('\nfinding the axis that followed the speed');
{
    const E = env();
    /* A brake: speed falling, one axis reading it, the others reading noise. */
    const dv = [], ax = [[], [], []];
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
    for (let i = 0; i < 30; i++) {
        const a = i < 10 ? 2.5 : (i < 20 ? -6.0 : 0);       /* accelerate, brake, coast */
        dv.push(a + rnd() * 0.3);
        ax[0].push(rnd() * 40);                              /* lateral noise */
        ax[1].push(a * 102 + rnd() * 40);                    /* this one is forward */
        ax[2].push(1000 + rnd() * 40);                       /* holding the car up */
    }
    const r0 = E.gpwCorr(ax[0], dv), r1 = E.gpwCorr(ax[1], dv), r2 = E.gpwCorr(ax[2], dv);
    ok('the axis that felt the braking correlates strongly', r1 > 0.9, String(r1));
    ok('…and the other two do not',
       Math.abs(r0) < E.GPW_MIN_R && Math.abs(r2) < E.GPW_MIN_R,
       'lateral ' + r0.toFixed(2) + ', vertical ' + r2.toFixed(2));
    ok('a backwards-mounted puck correlates negatively',
       E.gpwCorr(ax[1].map((v) => -v), dv) < -0.9);
}
{
    const E = env();
    ok('a flat signal has no correlation to report',
       E.gpwCorr([1, 1, 1, 1, 1, 1], [1, 2, 3, 4, 5, 6]) === null);
    ok('and neither does too short a run', E.gpwCorr([1, 2], [1, 2]) === null);
}
{
    /* The threshold has to be low enough to pass a real brake and high enough
       to reject noise, or the wizard writes a mounting from nothing. */
    const E = env();
    ok('the bar for "this axis is clearly the one" sits between the two',
       E.GPW_MIN_R > 0.4 && E.GPW_MIN_R < 0.85, String(E.GPW_MIN_R));
    ok('and a run has to have a real change of speed in it',
       E.GPW_MIN_SWING >= 15, String(E.GPW_MIN_SWING) + ' km/h');
}

/* ══ a corner that has a name ════════════════════════════════════════════ */
console.log('\na corner keeps its name across laps and days');
{
    const E = env();
    /* Two apexes 400 m apart, named. A later lap's apex lands a few metres
       from each — which is what a different lap through the same corner
       actually looks like — and must still find the right name. */
    E.track = { name: 'Test', cornerNames: [
        { lat: -34.4330, lon: 138.5090, name: 'The Loop' },
        { lat: -34.4366, lon: 138.5090, name: 'Bus Stop' }
    ] };
    E.gp.trace = [
        { lat: -34.43302, lon: 138.50903 },   /* 4 m from The Loop */
        { lat: -34.43655, lon: 138.50895 },   /* 6 m from Bus Stop */
        { lat: -34.4400, lon: 138.5090 }      /* 380 m from either */
    ];
    ok('a lap that clipped a different line still finds the name',
       E.gpCornerNameAt(0) === 'The Loop', String(E.gpCornerNameAt(0)));
    ok('…and the next corner is the next name', E.gpCornerNameAt(1) === 'Bus Stop');
    ok('a corner nowhere near a named one has no name', E.gpCornerNameAt(2) === null);
    ok('the label falls back to the number', E.gpCornerLabel(4, 2) === 'T4');
    ok('…in the long form too', E.gpCornerLabel(4, 2, true) === 'Turn 4');
    ok('and uses the name where there is one', E.gpCornerLabel(1, 0, true) === 'The Loop');
}
{
    const E = env();
    E.track = { name: 'Test' };
    E.gp.trace = [{ lat: -34.4330, lon: 138.5090 }];
    E.gpCornerNameSet(0, 'Turn One');
    ok('naming a corner on a track with none starts the list',
       E.track.cornerNames && E.track.cornerNames.length === 1, JSON.stringify(E.track.cornerNames));
    E.gp.trace.push({ lat: -34.43303, lon: 138.50902 });   /* 4 m away */
    E.gpCornerNameSet(1, 'Turn 1');
    ok('naming it again from a different lap replaces rather than duplicates',
       E.track.cornerNames.length === 1 && E.track.cornerNames[0].name === 'Turn 1',
       JSON.stringify(E.track.cornerNames));
    E.gpCornerNameSet(1, '   ');
    ok('an empty name removes it, and the empty list goes with it',
       !E.track.cornerNames, JSON.stringify(E.track.cornerNames));
}
{
    const E = env();
    E.track = { name: 'Test' };
    E.gp.trace = [{ lat: -34.4330, lon: 138.5090 }];
    E.gpCornerNameSet(0, 'x'.repeat(200));
    ok('a name is a name, not a paragraph',
       E.track.cornerNames[0].name.length === E.GP_CNAME_MAX, String(E.track.cornerNames[0].name.length));
    ok('no track, nothing stored', (function () {
        const F = env(); F.track = null; F.gp.trace = [{ lat: 0, lon: 0 }];
        F.gpCornerNameSet(0, 'nope');
        return F.saved === undefined;
    })());
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
