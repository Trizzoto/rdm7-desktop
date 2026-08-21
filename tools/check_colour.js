/* Can you actually tell the two laps apart, and does speed read as speed?
 *
 * Both of these were broken in ways that looked fine in the source and failed
 * on screen, so they are asserted here as measurable perceptual properties
 * rather than as hex values somebody eyeballed:
 *
 *   1. Colours used to be handed out by LAP INDEX. Comparing lap 4 with lap 6
 *      gave #40C057 against #20C8C0 -- 43 degrees apart in hue, same lightness,
 *      both green -- and since every lane in the rack takes its colour from the
 *      lap when more than one is shown, the whole workspace came out one shade
 *      of green. The two ROLES (the lap you are on, the one you are chasing)
 *      must now be unmistakable on either surface.
 *
 *   2. The speed ramp used to get DARKER as speed rose, ending at #440C0F --
 *      darker than the tarmac it is drawn on. Flat out, the part of the lap
 *      that matters most, was the least visible thing on the map. Lightness
 *      must now rise monotonically, and the fast end must clear the imagery.
 *
 * Distances are CIE76 dE on L*a*b*. Crude next to dE2000, but this is asking
 * "are these obviously different", not "are these a metameric match", and a
 * crude metric that is easy to read beats a precise one nobody can check.
 *
 *   node tools/check_colour.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: function ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j);
}
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    let i = src.indexOf('=', m.index) + 1, depth = 0, j = i;
    for (; j < src.length; j++) {
        const c = src[j];
        if (c === '[' || c === '{' || c === '(') depth++;
        else if (c === ']' || c === '}' || c === ')') depth--;
        else if (c === ';' && depth === 0) { j++; break; }
    }
    return src.slice(m.index, j);
}

const VARS = ['GP_LAP_COLOURS', 'GP_ROLE_SUBJECT_LIGHT', 'GP_ROLE_SUBJECT_DARK',
              'GP_ROLE_REF_LIGHT', 'GP_ROLE_REF_DARK', 'GP_SPEED_RAMP'];
const FNS = ['gpLapRole', 'gpLapColourOn', 'gpLapColour', 'gpMapLapColour', 'gpSpeedColour'];

let code = 'var gp = { selLap: -1, cmpLap: -1 };\n';
VARS.forEach(v => { code += grabVar(v) + '\n'; });
FNS.forEach(f => { code += grab(f) + '\n'; });
const api = new Function(code + '\n; return {' +
    FNS.concat(VARS).join(',') + ', gp: gp };')();

/* ---- colour maths ------------------------------------------------------ */
function rgbOf(c) {
    if (Array.isArray(c)) return c;
    let m = /^#([0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (m) return [+m[1], +m[2], +m[3]];
    throw new Error('cannot parse colour: ' + c);
}
function lab(c) {
    const [R, G, B] = rgbOf(c).map(v => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    const [fx, fy, fz] = [f(X), f(Y), f(Z)];
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const L = c => lab(c)[0];
function dE(a, b) {
    const A = lab(a), B = lab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -- ' + detail : '')); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* ---- 1. the two roles -------------------------------------------------- */
console.log('the lap you are on vs the one you are chasing');

/* Analysing lap 4, chasing lap 6 -- the exact pair that used to collide. */
api.gp.selLap = 3;
api.gp.cmpLap = 5;

const subL = api.gpLapColour(3), refL = api.gpLapColour(5);
const subD = api.gpMapLapColour(3), refD = api.gpMapLapColour(5);

ok('on the rack, subject and reference are far apart', dE(subL, refL) > 60,
   subL + ' vs ' + refL + ' = dE ' + dE(subL, refL).toFixed(0));
ok('on the map, subject and reference are far apart', dE(subD, refD) > 60,
   subD + ' vs ' + refD + ' = dE ' + dE(subD, refD).toFixed(0));

/* The old failure, stated as the thing that must not come back: whatever the
   two roles resolve to, they must not be the green/teal pair. */
ok('the roles no longer resolve to the old green/teal pair',
   !((subL === '#40C057' && refL === '#20C8C0') || (subD === '#40C057' && refD === '#20C8C0')));

/* The reference must sit the RIGHT side of its surface: near-black on the
   light rack, near-white over the dark map. A neutral that ignores its ground
   is invisible on one of the two. */
ok('the rack reference is dark enough for a light ground', L(refL) < 25,
   'L* ' + L(refL).toFixed(0));
ok('the map reference is light enough for a dark ground', L(refD) > 85,
   'L* ' + L(refD).toFixed(0));

/* ---- 2. third and later laps ------------------------------------------- */
console.log('\nother ticked laps stay out of the way');
let worstSub = 1e9, worstRef = 1e9, nearest = '';
api.GP_LAP_COLOURS.forEach(c => {
    const a = dE(c, subD), b = dE(c, refD);
    if (a < worstSub) { worstSub = a; nearest = c; }
    if (b < worstRef) worstRef = b;
});
ok('no wheel colour can be mistaken for the subject', worstSub > 25,
   'closest is ' + nearest + ' at dE ' + worstSub.toFixed(0));
ok('no wheel colour can be mistaken for the reference', worstRef > 25,
   'closest at dE ' + worstRef.toFixed(0));

/* Consecutive laps are the usual case, so neighbours on the wheel are the
   pair most likely to be on screen together. */
let worstAdj = 1e9, adjPair = '';
for (let i = 0; i + 1 < api.GP_LAP_COLOURS.length; i++) {
    const d = dE(api.GP_LAP_COLOURS[i], api.GP_LAP_COLOURS[i + 1]);
    if (d < worstAdj) { worstAdj = d; adjPair = api.GP_LAP_COLOURS[i] + '/' + api.GP_LAP_COLOURS[i + 1]; }
}
ok('neighbours on the wheel are separable', worstAdj > 30,
   'closest neighbours ' + adjPair + ' at dE ' + worstAdj.toFixed(0));

/* ---- 3. the speed ramp ------------------------------------------------- */
console.log('\nspeed reads as speed');

const stops = api.GP_SPEED_RAMP.map(L);
let rising = true;
for (let i = 1; i < stops.length; i++) if (stops[i] <= stops[i - 1]) rising = false;
ok('lightness rises from slow to flat out', rising,
   'L* ' + stops.map(v => v.toFixed(0)).join(' → '));

/* The two things the line is drawn on. If the fast end cannot clear these it
   disappears exactly where the lap matters most -- the original bug. */
const TARMAC = '#454545', GRASS = '#4E5E40';
const fast = api.gpSpeedColour(1), slow = api.gpSpeedColour(0);
ok('flat out clears tarmac', dE(fast, TARMAC) > 55, 'dE ' + dE(fast, TARMAC).toFixed(0));
ok('flat out clears grass', dE(fast, GRASS) > 55, 'dE ' + dE(fast, GRASS).toFixed(0));
ok('flat out is the lightest end of the ramp', L(fast) > L(slow) + 40,
   'L* ' + L(slow).toFixed(0) + ' → ' + L(fast).toFixed(0));

/* Every step has to be visible, or the ramp has a dead zone where a real
   speed change reads as no change at all. */
let worstStep = 1e9;
for (let i = 1; i < api.GP_SPEED_RAMP.length; i++) {
    const d = dE(api.GP_SPEED_RAMP[i - 1], api.GP_SPEED_RAMP[i]);
    if (d < worstStep) worstStep = d;
}
ok('no dead step in the ramp', worstStep > 12, 'smallest step dE ' + worstStep.toFixed(0));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
