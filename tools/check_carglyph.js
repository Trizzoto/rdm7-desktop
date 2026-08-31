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

const WANT = ['gpHdgAtF', 'gpCarMapScale', 'gpScaleCarGlyphs', 'gpSpinCar',
              'gpMapTextUp', 'gpDegPlace',
              'gpSteerChan', 'gpSteerAt', 'gpSteerTrust', 'gpFrontWheels', 'gpSteerWheels',
              'gpBrakeAt', 'gpBrakeLamps', 'gpCarDemoAt', 'gpCarDemo', 'gpCarDemoStop',
              'gpCarIcon'];
const VARS = ['GP_CAR_M', 'GP_CAR_NOMINAL_PX', 'GP_CAR_MIN_PX', 'GP_CAR_MAX_PX',
              'GP_STEER_WHEELBASE', 'GP_STEER_LOCK', 'GP_STEER_TRUST_CONF',
              'GP_DRIFT_ROUGH',
              'GP_BRAKE_G', 'GP_BRAKE_FULL_G', 'GP_CARDEMO_MS', '_gpCarDemo'];

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

const DOM = { els: [], map: null };
const F = new Function(`
    var gp = { map: null, _carScale: null, _carGen: null, _carBuilt: 0, trace: [] };
    var DOM = arguments[0];
    var document = { querySelectorAll: function () { return DOM.els; },
                     getElementById: function (id) { return DOM.map || null; } };
    function gpN(v) { return (v === null || v === undefined || !isFinite(v)) ? null : Number(v); }
    /* The steering model reads the path's turn rate and, when the recording
       has one, a steering channel. Both come from the app's own helpers, so
       the shim supplies the same two the overlay would. */
    function gpChannels() { return gp.chan || null; }
    function gpChanValue(raw, def) {
        if (raw === null || raw === undefined || raw === 0xFFFF) return null;
        if (def.signed && raw > 32767) raw -= 65536;
        return raw * def.scale + def.offset;
    }
    /* The brake pedal comes from the HUD's channel matcher, which has its own
       223 checks next door. What is under test here is which SOURCE wins and
       what happens when there is none, so the shim supplies the answer rather
       than re-testing the matching. */
    function gpHudChans() { return gp._hud || null; }
    function gpHudChan(ch, role, i) {
        if (!ch || !ch[role]) return null;
        var can = gp.trace[i] && gp.trace[i].can;
        if (!can) return null;
        return gpChanValue(can[ch[role].col], ch[role].def);
    }
    /* Leaflet, and the glyph, reduced to what gpCarIcon touches. */
    var L = { divIcon: function (o) { return o; } };
    function gpCarGlyph() { return '<path class="shell" d="M 0 0"/>'; }
    /* A frame clock we drive by hand, so the demo loop can be stepped and,
       more to the point, PROVED to stop. */
    var window = {
        _q: [], _id: 0, _cancelled: [],
        requestAnimationFrame: function (fn) { this._q.push({ id: ++this._id, fn: fn }); return this._id; },
        cancelAnimationFrame: function (id) { this._cancelled.push(id);
            this._q = this._q.filter(function (e) { return e.id !== id; }); }
    };
    ${parts.join('\n')}
    return {
        gp: gp,
        hdg: (typeof gpHdgAtF === 'function') ? gpHdgAtF : null,
        scale: (typeof gpCarMapScale === 'function') ? gpCarMapScale : null,
        apply: (typeof gpScaleCarGlyphs === 'function') ? gpScaleCarGlyphs : null,
        place: (typeof gpDegPlace === 'function') ? gpDegPlace : null,
        steerAt: (typeof gpSteerAt === 'function') ? gpSteerAt : null,
        steerTrust: (typeof gpSteerTrust === 'function') ? gpSteerTrust : null,
        TRUST_CONF: (typeof GP_STEER_TRUST_CONF !== 'undefined') ? GP_STEER_TRUST_CONF : null,
        ROUGH: (typeof GP_DRIFT_ROUGH !== 'undefined') ? GP_DRIFT_ROUGH : null,
        frontOf: (typeof gpFrontWheels === 'function') ? gpFrontWheels : null,
        steerTo: (typeof gpSteerWheels === 'function') ? gpSteerWheels : null,
        brakeAt: (typeof gpBrakeAt === 'function') ? gpBrakeAt : null,
        lamps: (typeof gpBrakeLamps === 'function') ? gpBrakeLamps : null,
        demoAt: (typeof gpCarDemoAt === 'function') ? gpCarDemoAt : null,
        demo: (typeof gpCarDemo === 'function') ? gpCarDemo : null,
        demoStop: (typeof gpCarDemoStop === 'function') ? gpCarDemoStop : null,
        win: window,
        icon: (typeof gpCarIcon === 'function') ? gpCarIcon : null,
        BRAKE_G: (typeof GP_BRAKE_G !== 'undefined') ? GP_BRAKE_G : null,
        BRAKE_FULL: (typeof GP_BRAKE_FULL_G !== 'undefined') ? GP_BRAKE_FULL_G : null,
        LOCK: (typeof GP_STEER_LOCK !== 'undefined') ? GP_STEER_LOCK : null,
        textUp: (typeof gpMapTextUp === 'function') ? gpMapTextUp : null,
        gp: gp,
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

console.log('\nthe front wheels point where the driver pointed them');
{
    /* A marker with dead-straight wheels through a hairpin reads as a
       sticker. What is drawn is MEASURED when the recording carries a steering
       channel, and otherwise derived from two numbers that were measured:
       how hard the car is turning, less how sideways it is. */
    const rows = (opt) => {
        const r = [];
        for (let i = 0; i < 40; i++)
            r.push(Object.assign({ kph: 90, hdg: 0, lat: -34.4, lon: 138.5 }, opt || {}));
        return r;
    };

    F.gp.traceChanIds = null; F.gp.traceChanDefs = null;
    F.gp._steerKey = null; F.gp._steerCol = null;

    {
        /* Standing still there is no geometry to work from and no lock to
           show — a steer angle from a divide by zero is not a steer angle. */
        F.gp.trace = rows({ kph: 2 });
        /* A turn rate IS present — heading noise at a standstill is exactly
           where it comes from. Without the speed guard the geometry divides
           by a walking pace and slams the wheels to full lock while the car
           is parked, so the guard has to be the thing that stops it. */
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(20), glat: new Float32Array(40) };
        ok('stopped, the wheels point straight ahead', F.steerAt(5, 0) === 0,
           String(F.steerAt(5, 0)));
    }
    {
        /* Gripping through a right-hander: a little lock INTO the corner. */
        F.gp.trace = rows({ kph: 90 });
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(20), glat: new Float32Array(40) };
        const st = F.steerAt(5, 0);
        ok('turning right with no slip winds lock to the RIGHT', st > 0, st.toFixed(2));
        ok('…and it is a believable amount, not full lock',
           st > 0.5 && st < 15, st.toFixed(2));
    }
    {
        /* The same corner, now sideways: opposite lock. This is the whole
           reason to draw them. */
        F.gp.trace = rows({ kph: 90 });
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(20), glat: new Float32Array(40) };
        const grip = F.steerAt(5, 0, true);
        const slide = F.steerAt(5, 30, true);    /* 30 deg of MEASURED slip */
        ok('sliding hands back opposite lock', slide < 0, slide.toFixed(2));
        ok('…which is the other way from the gripping car', (slide < 0) !== (grip < 0));
        /* And only when it was measured. An integrated angle carries its own
           errors into the picture, and on a real recording that put the wheels
           at full lock through corners the car took on the racing line. */
        const untrusted = F.steerAt(5, 30, false);
        ok('an angle nothing measured does NOT reach the wheels',
           Math.abs(untrusted - grip) < 1e-9, untrusted.toFixed(2));
        ok('…the wheels still show the geometric lock', untrusted > 0);
    }
    {
        F.gp.trace = rows({ kph: 60 });
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(120), glat: new Float32Array(40) };
        ok('a wild number is held at full lock',
           Math.abs(F.steerAt(5, -200, true)) <= F.LOCK + 1e-9, F.steerAt(5, -200, true).toFixed(1));
    }
    {
        /* A real channel beats the model, every time. */
        F.gp.trace = rows({ kph: 90 });
        F.gp.trace.forEach(r => { r.can = [0, 0, 250]; });
        F.gp.traceChanIds = ['a', 'b', 'ecu:steer'];
        F.gp.traceChanDefs = [
            { id: 'a', name: 'RPM', unit: 'rpm', scale: 1, offset: 0, decimals: 0 },
            { id: 'b', name: 'Throttle', unit: '%', scale: 1, offset: 0, decimals: 0 },
            { id: 'ecu:steer', name: 'Steering Angle', unit: 'deg', scale: 0.1, offset: 0, decimals: 1 }
        ];
        F.gp._steerKey = null; F.gp._steerCol = null;
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(20), glat: new Float32Array(40) };
        ok('a measured steering channel is used instead of the model',
           Math.abs(F.steerAt(5, 0) - 25) < 1e-6, String(F.steerAt(5, 0)));
        ok('…and it is still held to full lock', Math.abs(F.steerAt(5, 0)) <= F.LOCK);
        F.gp.traceChanIds = null; F.gp.traceChanDefs = null;
        F.gp._steerKey = null; F.gp._steerCol = null;
    }
    {
        /* THE 43°±2 REPORT. The drift car drawn 43 degrees sideways, wedge
           and label asserting it, fronts pointed dead ahead — because the
           angle was worked out rather than measured and all-or-nothing trust
           threw it away. The wheels now believe the slip angle exactly as far
           as the confidence the label prints: outright at ±GP_STEER_TRUST_CONF
           or tighter, not at all by the ± that stops the car being drawn
           sideways in the first place, and proportionally between so they
           never pop from opposite lock to straight as the ± drifts. */
        F.gp.trace = rows({ kph: 90 });
        F.gp.chanKey = 'x'; F.gp.chan = { yaw: new Float32Array(40).fill(20), glat: new Float32Array(40) };
        const d = (conf, direct) => ({ ok: new Uint8Array(40).fill(1),
                                       conf: new Float32Array(40).fill(conf),
                                       direct: !!direct });
        ok('measured slip is believed outright, whatever its ±',
           F.steerTrust(d(9, true), 5) === 1, String(F.steerTrust(d(9, true), 5)));
        ok('a worked-out ±2 is believed outright too', F.steerTrust(d(2), 5) === 1,
           String(F.steerTrust(d(2), 5)));
        ok('by the rough line it is not believed at all',
           F.steerTrust(d(F.ROUGH), 5) === 0, String(F.steerTrust(d(F.ROUGH), 5)));
        const mid = F.steerTrust(d((F.TRUST_CONF + F.ROUGH) / 2), 5);
        ok('and belief fades between rather than switching',
           mid > 0.4 && mid < 0.6, String(mid));
        ok('no confidence at all is no belief', F.steerTrust(d(NaN), 5) === 0);
        {
            const dd = d(2); dd.ok[5] = 0;
            ok('a sample the engine marked bad is no belief', F.steerTrust(dd, 5) === 0);
        }
        ok('no drift engine at all is no belief', F.steerTrust(null, 5) === 0);
        {
            const st = F.steerAt(5, 43, F.steerTrust(d(2), 5));
            ok('so 43°±2 puts the wheels at FULL opposite lock', near(st, -F.LOCK),
               st.toFixed(1));
        }
        {
            const full = F.steerAt(5, 30, 1);
            const none = F.steerAt(5, 30, 0);
            const half = F.steerAt(5, 30, 0.5);
            ok('half belief is half the correction', near(half, (full + none) / 2, 1e-6),
               half.toFixed(2) + ' vs ' + ((full + none) / 2).toFixed(2));
        }
        /* The call site, because the bug was never in the maths: the drift
           car must hand the wheels the weighted trust, not the old
           direct-or-nothing flag. */
        ok('the drift car steers by confidence, not direct-or-nothing',
           /gpSteerWheels\(E\.front, gpSteerAt\(i, beta, gpSteerTrust\(d, i\)\)\)/.test(src));
    }
    {
        /* The front pair is FOUND, not named, so a car added later steers
           without anyone remembering to mark it up. */
        const mk = (wheels) => ({
            querySelectorAll: () => wheels.map(w => ({
                _t: null,
                getAttribute: (k) => String(w[k]),
                setAttribute: (k, v) => { if (k === 'transform') w.t = v; }
            }))
        });
        const ws = [{ x: -6.5, y: -8, width: 1.85, height: 3.3 },
                    { x: 4.7, y: -8, width: 1.85, height: 3.3 },
                    { x: -6.7, y: 4, width: 1.85, height: 3.3 },
                    { x: 4.8, y: 4, width: 1.85, height: 3.3 }];
        const front = F.frontOf(mk(ws));
        ok('the two wheels nearest the nose are the steered pair',
           front.length === 2 && front.every(f => f.y === -8),
           front.map(f => f.y).join());
        ok('…and each turns about its OWN centre, not the car\'s',
           Math.abs(front[0].cy - (-8 + 1.65)) < 1e-9, String(front[0].cy));
        F.steerTo(front, 12);
        ok('steering writes a rotation on both', ws[0].t && ws[1].t && !ws[2].t);
        ok('…about the wheel\'s own centre', /rotate\(12\.0 -5\.58 -6\.35\)/.test(ws[0].t), ws[0].t);
    }
    {
        const empty = F.frontOf({ querySelectorAll: () => [] });
        ok('a glyph with no wheels simply does not steer', empty.length === 0);
        ok('and no svg at all is ignored', F.frontOf(null).length === 0);
    }
    F.gp.trace = null; F.gp.chan = null; F.gp.chanKey = null;
}

console.log('\nthe tail lights say when he was on the brakes');
{
    /* Two sources, in a fixed order, and a third state that is NOT zero.
       Confusing "nothing here knows" with "he was off the brakes" is how a
       marker ends up quietly asserting something about a recording that
       never measured it. */
    const rows = (g, can) => {
        const r = [];
        for (let i = 0; i < 20; i++) r.push({ kph: 90, hdg: 0, g: g, can: can || null });
        return r;
    };
    const PEDAL = { brk: { col: 0, full: 100,
                           def: { name: 'Brake', unit: '%', scale: 1, offset: 0 } } };

    F.gp._hud = null;

    {
        F.gp.trace = rows(0.1);
        ok('coasting is not braking', F.brakeAt(3) === 0, String(F.brakeAt(3)));
    }
    {
        /* A lift decelerates the car. It is not a brake application, and the
           threshold that decides is the SAME one the corner analysis uses. */
        F.gp.trace = rows(-(F.BRAKE_G * 0.6));
        ok('a lift does not light the brakes', F.brakeAt(3) === 0, String(F.brakeAt(3)));
        F.gp.trace = rows(-(F.BRAKE_G + 0.0001));
        ok('and just past the threshold they come on', F.brakeAt(3) > 0, String(F.brakeAt(3)));
    }
    {
        F.gp.trace = rows(-F.BRAKE_FULL);
        ok('the hardest stop is full brightness', near(F.brakeAt(3), 1), String(F.brakeAt(3)));
        F.gp.trace = rows(-2.5);
        ok('and harder than that does not overflow', F.brakeAt(3) === 1, String(F.brakeAt(3)));
    }
    {
        /* No longitudinal g at all: null, not zero. */
        const r = rows(0.1); r.forEach(x => { delete x.g; });
        F.gp.trace = r;
        ok('a recording with no g says it does not know', F.brakeAt(3) === null,
           String(F.brakeAt(3)));
        r.forEach(x => { x.g = NaN; });
        ok('and so does a broken one', F.brakeAt(3) === null, String(F.brakeAt(3)));
    }
    {
        /* The foot beats the physics. Decelerating hard with the pedal
           reading zero is a downshift or a hill, and the pedal is right. */
        F.gp.trace = rows(-0.9, [0]);
        F.gp._hud = PEDAL;
        ok('a measured pedal wins over deceleration', F.brakeAt(3) === 0,
           String(F.brakeAt(3)));
        F.gp.trace = rows(0.2, [50]);
        ok('...in both directions', near(F.brakeAt(3), 0.5), String(F.brakeAt(3)));
        F.gp.trace = rows(0.2, [180]);
        ok('...and a pedal over its full scale is still held at one',
           F.brakeAt(3) === 1, String(F.brakeAt(3)));
        F.gp._hud = null;
    }
    {
        F.gp.trace = rows(-0.5);
        ok('past the end of the recording it knows nothing', F.brakeAt(99) === null,
           String(F.brakeAt(99)));
    }
}

console.log('\nlighting them, and putting them back');
{
    const lamp = () => ({ style: {} });

    {
        const a = lamp(), b = lamp();
        F.lamps([a, b], 0.9);
        ok('braking paints both lamps', !!a.style.fill && !!b.style.fill, a.style.fill);
        ok('and it is red, not just any colour',
           /^rgb\((2[0-9][0-9]),/.test(a.style.fill), a.style.fill);

        /* Unlit must CLEAR rather than paint an off colour: what an unlit lamp
           looks like is a different thing on the playback car, on a ghost and
           in the picker, and only the stylesheet knows which. */
        F.lamps([a, b], 0);
        ok('coming off the brakes hands the lamp back to the stylesheet',
           a.style.fill === '' && a.style.stroke === '' && a.style.strokeWidth === '',
           JSON.stringify(a.style));
    }
    {
        /* null and 0 are different ANSWERS and the same PICTURE. */
        const a = lamp(); F.lamps([a], 0.8); F.lamps([a], null);
        ok('"it does not know" draws exactly like "he was not braking"',
           a.style.fill === '' && a.style.opacity === '', JSON.stringify(a.style));
    }
    {
        const soft = lamp(), hard = lamp();
        F.lamps([soft], 0.15); F.lamps([hard], 1);
        const n = (c) => c.split(',').map(x => parseInt(x.replace(/\D+/g, ''), 10));
        ok('a hard stop is brighter than a brush of brake',
           n(hard.style.fill)[0] > n(soft.style.fill)[0],
           soft.style.fill + ' vs ' + hard.style.fill);
        /* The halo is the whole reason it reads at a zoom that fits a
           circuit: a tail lamp is about one unit in a 22-unit car. */
        ok('and it grows, because one unit is one pixel out there',
           parseFloat(hard.style.strokeWidth) > parseFloat(soft.style.strokeWidth),
           soft.style.strokeWidth + ' vs ' + hard.style.strokeWidth);
    }
    {
        /* The halo exists ONLY because a tail lamp can be one pixel. Left on
           at every size it welds the Skyline's four separate lamps into one
           red smear and throws away the reason there are four of them. */
        const small = lamp(), big = lamp();
        F.lamps([small], 1, 1.36);      /* GP_CAR_MIN_PX / GP_CAR_NOMINAL_PX */
        F.lamps([big], 1, 4.0);         /* GP_CAR_MAX_PX / GP_CAR_NOMINAL_PX */
        ok('a car drawn tiny gets the halo that makes it visible',
           parseFloat(small.style.strokeWidth) > 0, small.style.strokeWidth);
        ok('a car drawn big does not — the lamps speak for themselves',
           big.style.strokeWidth === '' && big.style.stroke === '',
           JSON.stringify(big.style));

        const mid = lamp();
        F.lamps([mid], 1, 2.2);
        ok('and it fades between the two rather than switching',
           parseFloat(mid.style.strokeWidth) > 0 &&
           parseFloat(mid.style.strokeWidth) < parseFloat(small.style.strokeWidth),
           small.style.strokeWidth + ' / ' + mid.style.strokeWidth);

        /* Four Skyline lamps, centres 1.75 apart, radius 0.58. At the big end
           the halo must not close a 0.59 gap between neighbours. */
        const gap = 1.75 - 2 * 0.58;
        ok('at full zoom the four Skyline lamps stay four lamps',
           (parseFloat(big.style.strokeWidth) || 0) < gap,
           'halo ' + (big.style.strokeWidth || 0) + ' vs gap ' + gap.toFixed(2));

        const noK = lamp();
        F.lamps([noK], 1);
        ok('no size given falls back to a halo rather than to none',
           parseFloat(noK.style.strokeWidth) > 0, noK.style.strokeWidth);
    }
    {
        F.lamps(null, 1);
        F.lamps([], 1);
        ok('a car with no tail lights is simply not lit', true);
    }
}

console.log('\nevery car is a car: the parts are all there');
{
    /* The one check that catches the next car somebody adds. Steering and
       brake lights are found by CLASS, so a glyph whose parts are unnamed
       draws perfectly and reacts to nothing — and it would never be noticed,
       because it looks right. */
    const CARS = /var GP_CARS = \[([\s\S]*?)\n        \];/.exec(src);
    ok('the car list was found', !!CARS);
    if (CARS) {
        const F2 = new Function('return [' + CARS[1] + '];');
        const cars = F2();
        ok('there are cars in it', cars.length >= 6, String(cars.length));
        for (const c of cars) {
            const wheels = (c.svg.match(/class="wheel"/g) || []).length;
            const brakes = (c.svg.match(/class="[^"]*\bbrake\b/g) || []).length;
            ok(c.id + ' has tail lights', brakes > 0, String(brakes));
            ok(c.id + ' has four wheels or none at all',
               wheels === 4 || wheels === 0, String(wheels));
            /* Parts carry no colour of their own — that is what lets one
               fragment be a white car, a red live car and a lap-coloured
               ghost. A fill on the glyph would beat all three. */
            ok(c.id + ' leaves its colours to the stylesheet',
               !/\sfill=/.test(c.svg) && !/\sstyle=/.test(c.svg));
        }
        /* And the wheel finder agrees with the markup, on the real cars
           rather than on a fixture built to suit it. */
        const withWheels = cars.filter(c => /class="wheel"/.test(c.svg));
        ok('most of them have wheels', withWheels.length >= 5, String(withWheels.length));
        for (const c of withWheels) {
            const ys = [];
            const re = /class="wheel"[^>]*?\sy="(-?[\d.]+)"[^>]*?\sheight="([\d.]+)"/g;
            let m;
            while ((m = re.exec(c.svg))) ys.push({ y: parseFloat(m[1]), h: parseFloat(m[2]) });
            ok(c.id + ': the wheel finder reads all four', ys.length === 4, String(ys.length));
            const sorted = ys.slice().sort((a, b) => a.y - b.y);
            ok(c.id + ': the front pair is unambiguous — no tie in the middle',
               sorted.length === 4 && sorted[1].y < sorted[2].y,
               sorted.map(v => v.y).join(', '));
            /* Front is towards the NOSE, and the nose is -y. A car whose
               wheels were laid out the other way round would steer with its
               back axle and nobody would spot it in a screenshot. */
            ok(c.id + ': the steered pair is at the front, not the back',
               sorted[0].y < 0 && sorted[3].y > 0,
               sorted[0].y + ' / ' + sorted[3].y);
        }
    }
}

console.log('\nthe picker demonstrates, and then stops');
{
    /* The demo is not a measurement and does not pretend to be. What it must
       get right is the ORDER — brake in a straight line, then turn — because
       a picker that shows a car braking mid-corner is teaching the wrong
       thing to the one audience guaranteed to be watching it. */
    ok('braking starts before the wheel goes on',
       F.demoAt(0.10).brake > 0 && F.demoAt(0.10).steer === 0,
       JSON.stringify(F.demoAt(0.10)));
    ok('the brake trails off as the lock winds on',
       F.demoAt(0.30).brake < F.demoAt(0.22).brake &&
       F.demoAt(0.30).steer > F.demoAt(0.22).steer,
       JSON.stringify(F.demoAt(0.30)));
    ok('at full lock he is off the brakes', F.demoAt(0.55).brake === 0 &&
       F.demoAt(0.55).steer > 20, JSON.stringify(F.demoAt(0.55)));
    ok('and it unwinds to straight', near(F.demoAt(0.999).steer, 0, 0.6) &&
       F.demoAt(0.999).brake === 0, JSON.stringify(F.demoAt(0.999)));
    ok('so the loop does not jump when it comes round again',
       Math.abs(F.demoAt(0.999).steer - F.demoAt(0).steer) < 0.6);
    ok('the lock is a believable amount for a corner, not full lock',
       F.demoAt(0.55).steer < F.LOCK, String(F.demoAt(0.55).steer));

    /* And the loop itself: it must stop, and it must put the car back. */
    const wheels = [{ x: -6.5, y: -8, width: 1.85, height: 3.3 },
                    { x: 4.7, y: -8, width: 1.85, height: 3.3 },
                    { x: -6.7, y: 4, width: 1.85, height: 3.3 },
                    { x: 4.8, y: 4, width: 1.85, height: 3.3 }];
    const mkWheel = (w) => ({ style: {},
        getAttribute: (k) => String(w[k]),
        setAttribute: (k, v) => { if (k === 'transform') w.t = v; } });
    const lamps = [{ style: {} }, { style: {} }];
    /* The swatch tells the lamp painter how big it is drawn, so a picker at
       a different size still gets the right halo. */
    const svg = { querySelectorAll: (sel) => sel === '.brake' ? lamps : wheels.map(mkWheel),
                  getAttribute: (k) => ({ viewBox: '-13 -13 26 26', width: '36' })[k] };
    const btn = { querySelector: () => svg };

    const W = F.win;
    W._q = []; W._cancelled = [];
    F.demo(btn, 0);
    ok('hovering asks for a frame', W._q.length === 1, String(W._q.length));
    let f = W._q.shift(); f.fn(1000);
    ok('...and keeps asking', W._q.length === 1);
    f = W._q.shift(); f.fn(1000 + 1500);
    ok('the lamps light somewhere in the corner',
       lamps[0].style.fill !== undefined);

    const pending = W._q[0].id;
    F.demoStop();
    ok('leaving cancels the frame it was waiting on',
       W._cancelled.indexOf(pending) >= 0, W._cancelled.join());
    ok('...and puts the wheels straight', /rotate\(0\.0 /.test(wheels[0].t), wheels[0].t);
    ok('...and puts the lamps back to the stylesheet', lamps[0].style.fill === '',
       JSON.stringify(lamps[0].style));

    /* A frame already in flight when the demo was replaced must give up
       rather than draw over the new one. */
    W._q = []; W._cancelled = [];
    F.demo(btn, 0);
    const stale = W._q.shift();
    F.demo(btn, 0);              /* a second car hovered before that frame ran */
    const fresh = W._q.length;
    stale.fn(2000);
    ok('a frame from the car you already left does not queue another',
       W._q.length === fresh, W._q.length + ' vs ' + fresh);
    F.demoStop();

    /* One lap on click, then nothing. An animation that never stops in a
       settings panel is a distraction, not a demonstration. */
    W._q = []; W._cancelled = [];
    F.demo(btn, 1);
    let t = 5000, guard = 0;
    while (W._q.length && guard++ < 400) { const g2 = W._q.shift(); t += 40; g2.fn(t); }
    ok('picking one runs a single lap and stops', W._q.length === 0 && guard < 400,
       'frames: ' + guard);
    ok('...and leaves the car straight', /rotate\(0\.0 /.test(wheels[0].t), wheels[0].t);

    /* A PNG of your own has no parts. It must not throw. */
    W._q = [];
    F.demo({ querySelector: () => null }, 0);
    ok('your own PNG simply does not animate', W._q.length === 0);
    F.demoStop();
}

console.log('\nthe stand-in car does not pretend to be the live car');
{
    /* `live` is a CLAIM, not a size: the red shell means "this is where the
       car is right now". gpDrawHeadMarker borrowed this builder for the
       PLAYBACK stand-in and inherited the claim with it, so on every
       recording without a trustworthy slip angle — most of them — the
       playhead was drawn in the live car's red on a map where nothing was
       live. The stylesheet already stated the rule it broke.

       This is a class on a string, so a screenshot of a white-ish car at
       30 px would never have caught it, and neither did anyone looking. */
    ok('asked for the live car, it says so', /class='gpb-car live'/.test(F.icon(90, true).html),
       F.icon(90, true).html.slice(0, 60));
    ok('not asked, it does NOT', /class='gpb-car'/.test(F.icon(90).html) &&
       !/\blive\b/.test(F.icon(90).html), F.icon(90).html.slice(0, 60));
    ok('...and false is not the same as forgetting to say',
       !/\blive\b/.test(F.icon(90, false).html), F.icon(90, false).html.slice(0, 60));
    ok('the heading still gets in either way',
       /rotate\(90\.0\)/.test(F.icon(90).html) && /rotate\(90\.0\)/.test(F.icon(90, true).html));

    /* And the two call sites, because the bug was never in the builder. */
    const head = /gp\.headMarker = L\.marker\(ll, \{ icon: gpCarIcon\(([^)]*)\)/.exec(src);
    const live = /gp\.carMarker = L\.marker\(ll, \{ icon: gpCarIcon\(([^)]*)\)/.exec(src);
    ok('the playback stand-in asks for a plain car', !!head && !/true/.test(head[1]),
       head ? head[1] : 'not found');
    ok('the live car asks for the live one', !!live && /true/.test(live[1]),
       live ? live[1] : 'not found');
}

console.log('\nwriting on the map stays the right way up');
{
    /* Track up turns the whole map element, and every word on it turns too:
       at the bottom of a lap the angle readout was upside down and halfway
       round it was on its side. The label cancels the map's rotation about
       its own anchor.

       The transform has to COMPOSE with what was already there — the label is
       pushed below the tail and scaled back so it keeps its size at any zoom.
       Written on its own, the rotation threw it back to the car's centre at
       map scale, which is the bug this pins. */
    const node = () => {
        let t = null;
        return { setAttribute: (k, v) => { if (k === 'transform') t = v; },
                 removeAttribute: () => { t = null; },
                 getAttribute: () => t, get t() { return t; } };
    };
    const order = (t) => (t.match(/[a-z]+(?=\()/g) || []).join('>');

    F.gp._tuOn = false; F.gp._tuAngle = null;
    DOM.map = null;
    {
        const n = node();
        F.place(n, 2);
        ok('north up: the label is placed and scaled, not turned',
           order(n.t) === 'translate>scale', n.t);
    }
    {
        /* The rotation is taken from the map ELEMENT, because the stored
           angle drifts from it. Measured live: the map wore rotate(-94.94deg)
           while gp._tuAngle had moved on to 270.64, and a label cancelling
           the stored number came out 176 degrees wrong — upside down, which
           is the bug the counter-rotation exists to fix. */
        DOM.map = { style: { transform: 'translate(-50%, -50%) rotate(-94.94deg)' } };
        F.gp._tuOn = true; F.gp._tuAngle = 270.64;      /* stale, and ignored */
        ok('the angle comes from what the map is WEARING',
           Math.abs(F.textUp() - 94.94) < 1e-6, String(F.textUp()));
        const n = node();
        F.place(n, 1);
        ok('…so the label cancels the real rotation', /rotate\(94\.94\)/.test(n.t), n.t);
        DOM.map = null;
    }
    F.gp._tuOn = true; F.gp._tuAngle = 137;
    {
        const n = node();
        F.place(n, 2);
        ok('track up: it turns as well', /rotate\(137/.test(n.t), n.t);
        ok('…in the right order — placed, turned, then scaled',
           order(n.t) === 'translate>rotate>scale', n.t);
        ok('…and it still carries the map scale',
           /scale\(0\.5/.test(n.t), n.t);
        ok('…and the same offset below the tail as north up',
           /translate\(0,26\.00\)/.test(n.t), n.t);
    }
    {
        /* The cancellation is what makes it upright: the map is turned by
           MINUS the angle, so the label must be turned by PLUS it. */
        F.gp._tuAngle = -42;
        const n = node();
        F.place(n, 1);
        ok('a negative heading turns the label the other way',
           /rotate\(-42/.test(n.t), n.t);
    }
    {
        F.gp._tuOn = false;
        const n = node();
        F.place(n, 1);
        ok('leaving track up takes the rotation off again',
           !/rotate/.test(n.t), n.t);
    }
    {
        /* A missing or silly scale must not produce a broken transform. */
        const n = node();
        F.place(n, 0);
        ok('a zero scale does not produce NaN', !/NaN/.test(n.t), n.t);
        F.place(n, undefined);
        ok('…nor does a missing one', !/NaN/.test(n.t), n.t);
        F.place(null, 1);
        ok('and no node at all is simply ignored', true);
    }
    F.gp._tuOn = false; F.gp._tuAngle = null;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
