/* The car on the map: how big it is, which way it points, and whether it
 * holds still while it does either.
 *
 * Two complaints, one afternoon: "the icon is glitching during playback" and
 * "the to-scale car looks a bit small". They turned out to be three faults.
 *
 *   1. gpDrawHeadMarker rotated by calling setIcon, which DESTROYS the marker
 *      element and builds a new one. Any corner turns the car more than a
 *      degree between frames, so on the course-only path — every VBO import
 *      and every recording without a usable slip angle — the icon was
 *      re-created twenty-five times a second.
 *
 *   2. gpScaleCarGlyphs remembered the scale for the MAP, not per element. A
 *      rebuilt element carries no transform, the remembered scale still
 *      matches, so the guard returns early and that car draws at nominal size
 *      for ever. Fault 1 made this fire constantly: the car flickered between
 *      scaled and unscaled as it turned.
 *
 *   3. The size clamp was a scale FACTOR floored at 0.42, i.e. 9 px. At the
 *      Esri native zoom of 18 a real 4.6 m car IS about 9 px, so the floor was
 *      the normal case — the "to scale" car was a speck at every zoom anyone
 *      actually looks at a lap from.
 *
 * The DOM here is a stub, not jsdom: these functions touch querySelector,
 * setAttribute and style and nothing else, and a stub makes the assertions
 * about what was SET rather than about what a renderer did with it.
 *
 *   node tools/check_carglyph.js
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

/* `var NAME = ...;` lifted verbatim, so the numbers under test are the
   shipped numbers rather than a copy that can drift. */
function grabVar(src, name) {
    const re = new RegExp('^        var ' + name + ' = ([^;]+);', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    return m[0].trim();
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

const WANT = ['gpHdgAtF', 'gpCarMapScale', 'gpScaleCarGlyphs', 'gpSpinCar'];
const VARS = ['GP_CAR_M', 'GP_CAR_NOMINAL_PX', 'GP_CAR_MIN_PX', 'GP_CAR_MAX_PX'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

const parts = [], missing = [];
for (const n of WANT) { try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); } }
for (const n of VARS) { try { parts.push(grabVar(src, n)); } catch (e) { missing.push('var ' + n); } }

/* ---- the stub DOM ---------------------------------------------------- */
function El(cls) {
    return {
        _cls: cls || '',
        _kids: [],
        attrs: {},
        style: {},
        setAttribute(k, v) { this.attrs[k] = v; },
        getAttribute(k) { return this.attrs[k]; },
        querySelector(sel) {
            const want = sel.replace(/^\./, '');
            for (const k of this._kids) {
                if (k._cls.split(/\s+/).indexOf(want) >= 0) return k;
                const deep = k.querySelector(sel);
                if (deep) return deep;
            }
            return null;
        },
        add(k) { this._kids.push(k); return k; },
    };
}
/* One svg the way the overlay builds it: a body group to rotate and,
   on the playback car only, a degree label. */
function carSvg(withDeg) {
    const svg = El('gpb-car');
    svg.add(El('body'));
    if (withDeg) svg.add(El('deg'));
    return svg;
}

const DOM = { els: [] };
const F = new Function(`
    var gp = { map: null, _carScale: null, _carGen: null, _carBuilt: 0, trace: [] };
    var DOM = arguments[0];
    var document = { querySelectorAll: function () { return DOM.els; } };
    function gpN(v) { return (v === null || v === undefined || !isFinite(v)) ? null : Number(v); }
    ${parts.join('\n')}
    return {
        gp: gp,
        hdg: (typeof gpHdgAtF === 'function') ? gpHdgAtF : null,
        scale: (typeof gpCarMapScale === 'function') ? gpCarMapScale : null,
        apply: (typeof gpScaleCarGlyphs === 'function') ? gpScaleCarGlyphs : null,
        spin: (typeof gpSpinCar === 'function') ? gpSpinCar : null,
        K: { m: GP_CAR_M, nom: GP_CAR_NOMINAL_PX, min: GP_CAR_MIN_PX, max: GP_CAR_MAX_PX },
    };
`)(DOM);

console.log('lifted: ' + WANT.concat(VARS).filter(n => missing.indexOf(n) < 0 &&
            missing.indexOf('var ' + n) < 0).join(', '));
ok('every function and constant under test was found', missing.length === 0,
   'missing: ' + missing.join(', '));

/* ---- heading between samples ----------------------------------------- */
console.log('\nheading, between two fixes');
if (!F.hdg) { ok('gpHdgAtF exists', false); }
else {
    const set = rows => { F.gp.trace = rows; };

    set([{ hdg: 10 }, { hdg: 20 }]);
    ok('no fraction is the sample itself', F.hdg(0, 0) === 10, 'got ' + F.hdg(0, 0));
    ok('a quarter of the way is a quarter of the turn', near(F.hdg(0, 0.25), 12.5),
       'got ' + F.hdg(0, 0.25));
    ok('all the way is the next sample', near(F.hdg(0, 1), 20), 'got ' + F.hdg(0, 1));

    /* The one that matters on any lap that crosses north. Interpolating
       359 -> 1 arithmetically sweeps the car back through south. */
    set([{ hdg: 359 }, { hdg: 1 }]);
    let h = ((F.hdg(0, 0.5) % 360) + 360) % 360;
    ok('359 to 001 goes the SHORT way (through north)', near(h, 0, 1e-9) || near(h, 360, 1e-9),
       'got ' + F.hdg(0, 0.5) + ' (normalised ' + h + ')');

    set([{ hdg: 1 }, { hdg: 359 }]);
    h = ((F.hdg(0, 0.5) % 360) + 360) % 360;
    ok('and the other way round too', near(h, 0, 1e-9) || near(h, 360, 1e-9),
       'got ' + F.hdg(0, 0.5));

    /* A 180 either way is genuinely ambiguous; what must not happen is a
       jump to some third number. */
    set([{ hdg: 0 }, { hdg: 180 }]);
    h = ((F.hdg(0, 0.5) % 360) + 360) % 360;
    ok('a straight reversal lands on one of the two beam ends',
       near(h, 90, 1e-9) || near(h, 270, 1e-9), 'got ' + h);

    set([{ hdg: 200 }]);
    ok('the last sample has nothing to lean on and says so', F.hdg(0, 0.7) === 200,
       'got ' + F.hdg(0, 0.7));

    set([{ hdg: null }, { hdg: 10 }]);
    ok('no heading is null, never zero', F.hdg(0, 0.5) === null, 'got ' + F.hdg(0, 0.5));

    set([{ hdg: 10 }, { hdg: null }]);
    ok('a missing NEXT heading holds the current one', F.hdg(0, 0.5) === 10,
       'got ' + F.hdg(0, 0.5));

    set([{ hdg: 10 }]);
    ok('past the end is null', F.hdg(5, 0) === null, 'got ' + F.hdg(5, 0));

    /* Monotonic through the wrap: the car must never reverse direction
       mid-step, which is what a naive lerp does. */
    set([{ hdg: 350 }, { hdg: 10 }]);
    let prev = null, backwards = 0;
    for (let k = 0; k <= 20; k++) {
        const v = F.hdg(0, k / 20);
        if (prev !== null && v < prev - 1e-9) backwards++;
        prev = v;
    }
    ok('the sweep never doubles back', backwards === 0, backwards + ' reversals');
}

/* ---- how big is a car ------------------------------------------------ */
console.log('\nsize: a car you can see, true to scale where that means something');
if (!F.scale) { ok('gpCarMapScale exists', false); }
else {
    const K = F.K;
    /* Web Mercator, the same expression the app uses — restated rather than
       lifted so a change to one has to be justified against the other. */
    const mPerPx = (zoom, lat) =>
        156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
    const at = (zoom, lat) => {
        F.gp.map = { getZoom: () => zoom, getCenter: () => ({ lat: lat }) };
        return F.scale();
    };
    const px = (zoom, lat) => at(zoom, lat) * K.nom;

    /* Mount Barker / Mallala latitude — his actual tracks. */
    const LAT = -35.3;

    ok('no map at all is scale 1', (F.gp.map = null, F.scale()) === 1);

    ok('a car is 4.6 m and the glyph nominal is 22 px',
       K.m === 4.6 && K.nom === 22, K.m + ' / ' + K.nom);

    /* The heart of the complaint. At zoom 18 — the Esri native level and
       where a lap fills the panel — a real car is about nine pixels. */
    const truePx18 = K.m / mPerPx(18, LAT);
    ok('a TRUE-scale car at zoom 18 really is a speck (under 12 px)', truePx18 < 12,
       truePx18.toFixed(1) + ' px');
    ok('so at zoom 18 the floor takes over', near(px(18, LAT), K.min, 1e-6),
       'drew ' + px(18, LAT).toFixed(1) + ' px, floor is ' + K.min);
    ok('and the floor is big enough to read as a car', K.min >= 26, 'floor ' + K.min);
    ok('which is materially bigger than the old 0.42 clamp',
       K.min > 0.42 * K.nom + 8,
       'was ' + (0.42 * K.nom).toFixed(1) + ' px, now ' + K.min);

    /* Fitted to a whole circuit, where the old code was equally pinned. */
    ok('zoomed out to a circuit it is still visible', near(px(15, LAT), K.min, 1e-6),
       'drew ' + px(15, LAT).toFixed(1) + ' px');

    /* And true scale where true scale is worth having: one corner on screen. */
    const z = 20;
    const true20 = K.m / mPerPx(z, LAT);
    ok('zoom 20 is inside the true-scale band',
       true20 > K.min && true20 < K.max, true20.toFixed(1) + ' px');
    ok('so zoom 20 draws a car exactly its real size', near(px(z, LAT), true20, 1e-6),
       'drew ' + px(z, LAT).toFixed(1) + ', real ' + true20.toFixed(1));

    ok('the ceiling stops one car covering the corner', px(24, LAT) <= K.max + 1e-6,
       'drew ' + px(24, LAT).toFixed(1) + ' px, ceiling ' + K.max);

    /* Never smaller as you zoom IN — the property that makes it feel like an
       object on the ground rather than a marker with a mind of its own. */
    let shrank = 0, last = 0;
    for (let zz = 12; zz <= 22; zz += 0.5) {
        const v = px(zz, LAT);
        if (v < last - 1e-9) shrank++;
        last = v;
    }
    ok('it never shrinks as you zoom in', shrank === 0, shrank + ' reversals');

    /* Latitude matters to metres-per-pixel, so it must matter here too. */
    ok('latitude is not ignored', px(20, 0) !== px(20, 60),
       'equator ' + px(20, 0).toFixed(1) + ', 60N ' + px(20, 60).toFixed(1));

    ok('a broken zoom does not produce a broken car',
       (F.gp.map = { getZoom: () => Infinity, getCenter: () => ({ lat: 0 }) }, F.scale()) > 0,
       'got ' + F.scale());
}

/* ---- rotating without rebuilding ------------------------------------- */
console.log('\nrotation happens in place, not by rebuilding the icon');
if (!F.spin) { ok('gpSpinCar exists', false); }
else {
    const svg = carSvg(false);
    const marker = { getElement: () => svg };
    F.gp._carBuilt = 0;

    ok('pointing it returns true', F.spin(marker, 42.5) === true);
    ok('the body group carries the rotation',
       svg.querySelector('.body').getAttribute('transform') === 'rotate(42.50)',
       'got ' + svg.querySelector('.body').getAttribute('transform'));

    const built = F.gp._carBuilt;
    ok('a new element counts as built once', built === 1, 'got ' + built);
    F.spin(marker, 43.5);
    F.spin(marker, 44.5);
    ok('turning it again does NOT count as a rebuild', F.gp._carBuilt === built,
       'got ' + F.gp._carBuilt);
    ok('and the rotation still followed',
       svg.querySelector('.body').getAttribute('transform') === 'rotate(44.50)');

    ok('a marker with no element yet is not a rotation',
       F.spin({ getElement: () => null }, 10) === false);
    const bare = El('gpb-car');
    ok('an element with no body is not a rotation either',
       F.spin({ getElement: () => bare }, 10) === false);
}

/* ---- the scale reaches elements that appeared since last time --------- */
console.log('\nscale is remembered per element, not once for the map');
if (!F.apply || !F.scale) { ok('gpScaleCarGlyphs exists', false); }
else {
    F.gp.map = { getZoom: () => 20, getCenter: () => ({ lat: -35.3 }) };
    const a = carSvg(true);
    DOM.els = [a];
    F.gp._carScale = null; F.gp._carGen = null; F.gp._carBuilt = 0;
    F.apply();
    const k = F.scale();
    ok('the first car gets the map scale',
       a.style.transform === 'scale(' + k.toFixed(3) + ')', 'got ' + a.style.transform);
    ok('scaled about its own centre', a.style.transformOrigin === '50% 50%');

    /* THE REGRESSION. A second car appears at the same zoom — under the old
       one-value guard it was skipped and drew at nominal size for ever. */
    const b = carSvg(false);
    DOM.els = [a, b];
    F.gp._carBuilt++;                       /* what building a marker does */
    F.apply();
    ok('a car built later, at the SAME zoom, is scaled too',
       b.style.transform === 'scale(' + k.toFixed(3) + ')',
       'got ' + (b.style.transform === undefined ? 'nothing at all' : b.style.transform));

    /* And the cheap path still exists: nothing new, nothing moved, no work. */
    const c = carSvg(false);
    DOM.els = [a, b, c];
    F.apply();
    ok('with nothing new and no zoom change it does not touch the DOM',
       c.style.transform === undefined, 'got ' + c.style.transform);

    /* Zooming re-applies to everything. */
    F.gp.map = { getZoom: () => 21, getCenter: () => ({ lat: -35.3 }) };
    F.apply();
    const k2 = F.scale();
    ok('a zoom change re-scales every car',
       c.style.transform === 'scale(' + k2.toFixed(3) + ')' &&
       a.style.transform === 'scale(' + k2.toFixed(3) + ')', 'got ' + c.style.transform);
    ok('and the two zooms really are different sizes', k2 !== k, k + ' vs ' + k2);

    /* The angle readout is a label: constant size, whatever the car does. */
    const deg = a.querySelector('.deg');
    ok('the degree label is counter-scaled', !!deg && /scale\(/.test(deg.getAttribute('transform')),
       'got ' + (deg && deg.getAttribute('transform')));
    const inv = parseFloat(/scale\(([\d.]+)\)/.exec(deg.getAttribute('transform'))[1]);
    ok('by exactly the inverse, so it renders at one size at every zoom',
       Math.abs(inv * k2 - 1) < 2e-4, 'inverse ' + inv + ' against scale ' + k2);
    const ty = parseFloat(/translate\(0,([\d.-]+)\)/.exec(deg.getAttribute('transform'))[1]);
    ok('and it sits below the car, not on it', ty > 0, 'y ' + ty);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
