/* A car icon is a body and the parts that move (ADR-0065).
 *
 * A custom icon used to be an <image> and nothing else, so the moment anyone
 * drew their own car they lost the steering, the brake lights and the demo —
 * every part of the marker that carries information, traded for the one part
 * that does not. gpCarDemo said so in as many words: "a PNG of your own has no
 * parts to move".
 *
 * What is checked here is the part that is invisible until it is wrong:
 *
 *   - the app-drawn wheels land where the BUILT-IN cars put theirs, because
 *     the defaults were read off them and a drift means every custom car sits
 *     on wheels in the wrong place
 *   - gpFrontWheels picks the front PAIR out of them, since that is the whole
 *     contract between the geometry and the steering engine
 *   - the geometry survives a round trip through a settings file, and a
 *     settings file saying anything at all is clamped rather than believed
 *   - the artwork key changes when an axle moves, or the sliders do nothing
 *     until the marker happens to be destroyed for some other reason
 *   - the template is printed from the SAME fractions, so a car traced into it
 *     needs no sliders at all
 *
 *   node tools/check_carown.js
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
function grabObj(s, name) {
    const re = new RegExp('^        var ' + name + ' = \\{', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    let i = s.indexOf('{', m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) { j += 2; break; } }
    }
    return s.slice(m.index, j);
}
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
function grabVar(s, name) {
    const re = new RegExp('^        var ' + name + ' = [^\n]*$', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const parts = [], missing = [];
for (const v of ['GP_CAROWN_LS', 'GP_CARTPL_PX', 'GP_CARTPL_RGB', 'GP_CARTPL_FRAME',
                 'GP_CARPNG_BOX', 'GP_CARPNG_FILL', 'GP_CAR_M', 'GP_CAROWN_REAR',
                 '_gpCarOwn']) {
    try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); }
}
for (const o of ['GP_CAROWN_DEF', 'GP_CAROWN_LIM']) {
    try { parts.push(grabObj(src, o)); } catch (e) { missing.push(o); }
}
/* The seven shipped cars, lifted whole, so the defaults are compared with the
   ARTWORK rather than with a second copy of its numbers. */
try { parts.push(grabList(src, 'GP_CARS')); } catch (e) { missing.push('GP_CARS'); }
for (const f of ['gpCarOwn', 'gpCarOwnSave', 'gpCarOwnSet', 'gpCarOwnWheels', 'gpCarOwnLamps',
                 'gpCarOwnLabel', 'gpCarGlyphFor', 'gpCarGlyphKey', 'gpCarById',
                 'gpCarIconId', 'gpCarPng', 'gpFrontWheels']) {
    try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); }
}
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 0.02 : eps);

/* The wheel rects one of the shipped cars carries, off its own artwork. */
function builtinWheels(E, id) {
    const car = E.GP_CARS.filter((c) => c.id === id)[0];
    if (!car) return [];
    const out = [];
    const wre = /class="wheel" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
    let w;
    while ((w = wre.exec(car.svg))) out.push({ x: +w[1], y: +w[2], w: +w[3], h: +w[4] });
    return out;
}
/* The front and rear pair of a set of four, by which is nearer the nose. */
function pairs(ws) {
    const c = ws.map((r) => ({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h }));
    c.sort((a, b) => a.cy - b.cy);
    return { front: c.slice(0, 2), rear: c.slice(2) };
}

function env(stored) {
    const store = {};
    if (stored !== undefined) store['rdm7_gp_carown'] = typeof stored === 'string' ? stored : JSON.stringify(stored);
    const ctx = {
        console, isFinite, Math, JSON, String, Array, Object, Number, parseFloat, parseInt,
        window: null,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; },
            removeItem: (k) => { delete store[k]; }
        },
        gp: { look: null },
        document: { querySelectorAll: () => [] },
        gpCarOwnPreview() { }, gpCarIconRepaint() { }
    };
    ctx.window = ctx;
    ctx.store = store;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    /* After the source runs, not before: the `var _gpCar*` lines lifted out of
       it would otherwise overwrite whatever the stub had seeded. */
    ctx._gpCarIconId = 'custom';
    ctx._gpCarPng = 'data:image/png;base64,AAAA';
    return ctx;
}

/* ══ the defaults are the built-ins' own geometry ═══════════════════════ */
console.log('the wheels land where the built-in cars put theirs');
{
    const E = env();
    const g = E.gpCarOwn();
    const LEN = 22;                    /* the box every glyph is drawn in */
    const svg = E.gpCarOwnWheels(LEN);
    const got = [];
    const re = /x='(-?[\d.]+)' y='(-?[\d.]+)' width='([\d.]+)' height='([\d.]+)'/g;
    let m2;
    while ((m2 = re.exec(svg))) got.push({ x: +m2[1], y: +m2[2], w: +m2[3], h: +m2[4] });
    ok('four of them', got.length === 4, String(got.length));

    /* The Skyline is the reference: a square-shouldered saloon, and the one
       whose numbers GP_CAROWN_DEF was taken from. */
    const sky = builtinWheels(E, 'skyline');
    ok('the built-in artwork is still readable from here', sky.length === 4, String(sky.length));
    if (sky.length === 4 && got.length === 4) {
        const S2 = pairs(sky), G2 = pairs(got);
        const ftS = Math.abs(S2.front[1].cx - S2.front[0].cx);
        const ftG = Math.abs(G2.front[1].cx - G2.front[0].cx);
        const rtS = Math.abs(S2.rear[1].cx - S2.rear[0].cx);
        const rtG = Math.abs(G2.rear[1].cx - G2.rear[0].cx);
        ok('the front axle is where the Skyline has its front axle',
           near(S2.front[0].cy, G2.front[0].cy, 0.1),
           S2.front[0].cy + ' vs ' + G2.front[0].cy);
        ok('…and the rear axle its rear',
           near(S2.rear[0].cy, G2.rear[0].cy, 0.1),
           S2.rear[0].cy + ' vs ' + G2.rear[0].cy);
        ok('the front track matches to a tenth of a unit',
           near(ftS, ftG, 0.1), ftS.toFixed(2) + ' vs ' + ftG.toFixed(2));
        /* Every one of the seven runs its rear track wider than its front —
           the AE86's comment says so out loud. A custom car does the same, by
           ratio rather than by a fifth slider, so this is the assertion that
           the STANCE survived and not just the wheelbase. */
        ok('and the rear track is wider than the front, as it is on every built-in',
           rtG > ftG && near(rtS, rtG, 0.15),
           'built-in ' + rtS.toFixed(2) + ', ours ' + rtG.toFixed(2));
        ok('the tyres are the same size',
           near(S2.front[0].w, G2.front[0].w, 0.05) && near(S2.front[0].h, G2.front[0].h, 0.05));
    }
    ok('the wheelbase reads as a real car in centimetres',
       E.gpCarOwnLabel('wheelbase') === '251 cm', E.gpCarOwnLabel('wheelbase'));
    ok('and the track does too', E.gpCarOwnLabel('track') === '234 cm', E.gpCarOwnLabel('track'));
}

/* ══ the contract with the steering engine ═════════════════════════════ */
console.log('\nthe steering engine finds them');
{
    const E = env();
    const svg = E.gpCarOwnWheels(22);
    /* gpFrontWheels reads the ATTRIBUTES, so the stub answers with the same
       four rects the markup carries. Anything that stops being a <rect> with
       x/y/width/height stops steering, silently. */
    const rects = [];
    const re = /x='(-?[\d.]+)' y='(-?[\d.]+)' width='([\d.]+)' height='([\d.]+)'/g;
    let m3;
    while ((m3 = re.exec(svg))) {
        const a = { x: m3[1], y: m3[2], width: m3[3], height: m3[4] };
        rects.push({ getAttribute: (k) => a[k] });
    }
    const front = E.gpFrontWheels({ querySelectorAll: () => rects });
    ok('it picks a PAIR, not one and not all four', front.length === 2, String(front.length));
    ok('…and it is the pair nearest the nose',
       front[0].cy < 0 && front[1].cy < 0 && near(front[0].cy, front[1].cy, 0.001),
       JSON.stringify(front.map((f) => f.cy)));
    ok('rotating about the wheel centre, not the corner',
       near(Math.abs(front[0].cx), Math.abs(front[1].cx), 0.001) &&
       near(Math.abs(front[0].cx), 5.6, 0.05),
       String(front[0].cx));
}
{
    const E = env();
    E.gpCarOwnSet('wheels', 0);
    ok('wheels turned off draw nothing at all', E.gpCarOwnWheels(22) === '');
    E.gpCarOwnSet('lamps', 0);
    ok('and so do the lamps', E.gpCarOwnLamps(22) === '');
}
{
    const E = env();
    const l = E.gpCarOwnLamps(22);
    ok('two brake lamps, wearing the class gpBrakeLamps looks for',
       (l.match(/class='lamp brake'/g) || []).length === 2, l.slice(0, 60));
}

/* ══ a settings file says whatever it says ═════════════════════════════ */
console.log('\nthe geometry comes off disk, so it is clamped rather than believed');
{
    const E = env({ axleF: -0.31, axleR: 0.30, track: 0.62 });
    const g = E.gpCarOwn();
    ok('a saved geometry is honoured',
       near(g.axleF, -0.31, 1e-9) && near(g.track, 0.62, 1e-9), JSON.stringify(g));
}
{
    /* The failure this stops: a track of 40 puts the wheels off the MAP, not
       off the car, and there is no control on screen that can bring them
       back. */
    const E = env({ track: 40, axleF: 12, axleR: -12, wheelW: 0 });
    const g = E.gpCarOwn(), L = E.GP_CAROWN_LIM;
    ok('nonsense out of the file is clamped into the box',
       g.track === L.track[1] && g.axleF === L.axleF[1] && g.axleR === L.axleR[0] &&
       g.wheelW === L.wheelW[0], JSON.stringify(g));
    const svg = E.gpCarOwnWheels(22);
    ok('…so the wheels are still inside the icon',
       !/x='-?\d\d\d/.test(svg), (svg.match(/x='[^']+'/) || [''])[0]);
}
{
    const E = env('{{{ not json');
    ok('and a settings key that is not JSON falls back to the defaults',
       near(E.gpCarOwn().track, E.GP_CAROWN_DEF.track, 1e-9));
}
{
    const E = env({ axleF: 'banana', track: null });
    const g = E.gpCarOwn();
    ok('a value that is not a number is not a value',
       near(g.axleF, E.GP_CAROWN_DEF.axleF, 1e-9) && near(g.track, E.GP_CAROWN_DEF.track, 1e-9));
}
{
    const E = env();
    E.gpCarOwnSet('track', 0.7);
    E.gpCarOwnSave();
    const back = JSON.parse(E.store['rdm7_gp_carown']);
    ok('what is set is what is stored', near(back.track, 0.7, 1e-9), JSON.stringify(back));
}

/* ══ the artwork key ═══════════════════════════════════════════════════ */
console.log('\nmoving an axle counts as changing the artwork');
{
    const E = env();
    const before = E.gpCarGlyphKey();
    E.gpCarOwnSet('axleF', -0.33);
    const after = E.gpCarGlyphKey();
    ok('the key moves with the geometry', before !== after, before + ' vs ' + after);
    ok('…and it still names the picture it belongs to',
       after.indexOf('custom:') === 0, after);
}
{
    /* A built-in has its wheels drawn into its own artwork, so its key must
       NOT churn when the custom sliders move — that would rebuild the
       playback car on every drag for nothing. */
    const E = env();
    E._gpCarIconId = 'wedge';
    const k1 = E.gpCarGlyphKey();
    E.gpCarOwnSet('axleF', -0.4);
    ok('a built-in car ignores them entirely', E.gpCarGlyphKey() === k1, k1);
}

/* ══ the body, and the parts, in that order ════════════════════════════ */
console.log('\nwhat a custom glyph is made of');
{
    const E = env();
    const g = E.gpCarGlyphFor('custom', 22);
    ok('the body is in there once', (g.match(/<image/g) || []).length === 1);
    ok('with four wheels and two lamps',
       (g.match(/class='wheel'/g) || []).length === 4 &&
       (g.match(/class='lamp brake'/g) || []).length === 2);
    /* Under the body and over it, in that order: only the part of a wheel
       that protrudes should show on a solid silhouette, and a lamp hidden
       under the bodywork is the one part that lights up, unlit. */
    ok('wheels UNDER the body', g.indexOf("class='wheel'") < g.indexOf('<image'));
    ok('lamps OVER it', g.lastIndexOf("class='lamp brake'") > g.indexOf('<image'));
}
{
    const E = env();
    E._gpCarPng = '';
    const g = E.gpCarGlyphFor('custom', 22);
    ok('"custom" with nothing stored falls back rather than drawing an empty marker',
       g.indexOf('<image') < 0 && g.length > 0);
}

/* ══ the template is printed from the same numbers ═════════════════════ */
console.log('\nthe template and the glyph cannot disagree');
{
    const E = env();
    const g = E.gpCarOwn();
    const N = E.GP_CARTPL_PX, m = N / 2;
    /* The one line of arithmetic the template does: the frame is the CAR, and
       the car is GP_CARPNG_FILL of the square the wheels sit in. */
    const box = (N * E.GP_CARTPL_FRAME) / E.GP_CARPNG_FILL;
    const wellY = m + g.axleF * box;
    const wellX = m - (g.track * box) / 2;
    /* …and where that same wheel lands once the icon is drawn: the glyph's
       square is `len`, the imported car fills GP_CARPNG_FILL of it. Both
       reduce to the same fraction of the car's own length, which is the only
       thing that has to hold. */
    const LEN = 22;
    const glyphY = g.axleF * LEN, glyphHalfTrack = (g.track * LEN) / 2;
    const carPxOnTemplate = N * E.GP_CARTPL_FRAME;
    const carUnitsInGlyph = LEN * E.GP_CARPNG_FILL;
    ok('the front axle is the same fraction of the car in both',
       near((wellY - m) / carPxOnTemplate, glyphY / carUnitsInGlyph, 1e-9),
       ((wellY - m) / carPxOnTemplate).toFixed(6) + ' vs ' + (glyphY / carUnitsInGlyph).toFixed(6));
    ok('and so is the track',
       near((m - wellX) / carPxOnTemplate, glyphHalfTrack / carUnitsInGlyph, 1e-9));
    ok('the frame leaves a margin for the words, so none of them land on the car',
       E.GP_CARTPL_FRAME < 0.88 && E.GP_CARTPL_FRAME > 0.5, String(E.GP_CARTPL_FRAME));
    ok('every wheel well is inside the frame',
       Math.abs(g.axleF * box) + (g.wheelL * box) / 2 < carPxOnTemplate / 2 &&
       Math.abs(g.axleR * box) + (g.wheelL * box) / 2 < carPxOnTemplate / 2);
}
{
    const E = env();
    ok('the guide colour is one colour, and the importer is told which',
       Array.isArray(E.GP_CARTPL_RGB) && E.GP_CARTPL_RGB.length === 3,
       JSON.stringify(E.GP_CARTPL_RGB));
    ok('…and it is nowhere near a colour a car is painted',
       E.GP_CARTPL_RGB[2] > 200 && E.GP_CARTPL_RGB[2] - E.GP_CARTPL_RGB[0] > 80,
       JSON.stringify(E.GP_CARTPL_RGB));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
