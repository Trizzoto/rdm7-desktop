/* The HUD burned over the footage: what it draws, what it refuses to draw,
 * and whether it is the same picture at every size.
 *
 * The point of this harness is the last one. There is ONE renderer, and it is
 * used at two very different sizes — a 600 px tile on screen and a 2 704 px
 * camera frame in the export — so every number in it is expressed in units of
 * S = min(shortSide / 720, W / 700) — the short side carries the scale, the
 * width term only guards the fit on portrait and square frames. If that ever stops holding, the export and the preview drift
 * apart and nobody notices until a file has been made and watched.
 *
 * The rest is about not lying. A tacho drawn off a column that never carried
 * a frame pins at zero for the whole video; an empty brake tube beside a
 * working throttle reads as a driver who never touched the brakes. Both are
 * worse than leaving the widget out, and both are checked here.
 *
 * The canvas is a recording stub, not a renderer: the assertions are about
 * WHERE things were drawn and WHAT was asked for, which is what can actually
 * be wrong here.
 *
 *   node tools/check_hud.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

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
    const re = new RegExp('^        var ' + name + ' = ([\\[{]?)', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: var ' + name);
    if (!m[1]) {
        /* Up to the semicolon, not to the end of the line: these declarations
           carry a trailing comment, and anchoring on $ silently matched the
           NEXT var instead. */
        const one = new RegExp('^        var ' + name + ' = ([^;]+);', 'm').exec(s);
        return 'var ' + name + ' = ' + one[1] + ';';
    }
    const open = m[1], close = open === '[' ? ']' : '}';
    let i = s.indexOf(open, m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === open) depth++;
        else if (s[j] === close) { depth--; if (depth === 0) { j++; break; } }
    }
    return s.slice(m.index, j) + ';';
}

const VARS = ['GP_HUD_WIDGETS', 'GP_HUD_ROLES', 'GP_HUD_INK', 'GP_HUD_RED', 'GP_HUD_GRN',
              'GP_HUD_WARN', 'GP_HUD_MONO', 'GP_HUD_SANS', 'GP_EXPORT_MIMES', 'GP_EXPORT_BPP',
              'GP_HUD_MAP_STYLES', 'GP_HUD_TILE_CACHE', 'GP_HUD_TILE_MAX', 'GP_WORLD_IMAGERY',
              'GP_TRACE_WHOLE', 'GP_LAP_CASE', 'GP_HUD_LOGO_AR',
              '_gpHudLogoRec', 'GP_HUD_MADE', 'GP_HUD_STYLES', 'GP_STEER_LOCK',
              'GP_HUD_PRESETS', 'GP_HUD_SUG_SLIDE_S'];
const FNS = ['gpChanValue', 'gpChanQuiet', 'gpMetresPerDeg', 'gpHeadingAt', 'gpHudOn', 'gpHudChans',
             'gpHudChan', 'gpHudData', 'gpHudRR', 'gpHudPanel', 'gpHudGlow', 'gpHudMiniWindow',
             'gpHudMinimap', 'gpHudTacho', 'gpHudGrip', 'gpHudPedal', 'gpHudRender', 'gpHudClock',
             'gpVideoPictureRect', 'gpExportMime', 'gpExportPlan', 'gpHudMapStyle',
             'gpHudNightColour', 'gpHudTile', 'gpHudTiles', 'gpExportName',
             'gpAngleColour', 'gpAngleScale',
             'gpHudStyle', 'gpHudAngleMax', 'gpHudAngleSay', 'gpHudAngleDial',
             'gpHudSlideSecs', 'gpHudSuggest', 'gpHudUntouched', 'gpHudSuggested', 'gpHz',
             'gpHudAngleBar', 'gpHudSteerWheel', 'gpHudGripRadar', 'gpHudRunCard',
             'gpHudLogoLoad', 'gpHudLogoReady',
             'gpExportRunNow', 'gpHudLayout', 'gpHudPlaceOf', 'gpHudPlace',
             'gpHudOrder', 'gpHudChanList', 'gpHudChanById', 'gpHudChanAt',
             'gpHudAdds', 'gpHudAddById', 'gpHudWidgetList', 'gpHudMadeBox',
             'gpHudTrackShape', 'gpHudMadeType', 'gpHudMadeDef', 'gpHudMadeNeeds', 'gpHudDrawMade', 'gpHudMadeVal', 'gpHudMadeLo', 'gpHudMadeHi', 'gpHudMadeLit', 'gpHudMadeText', 'gpHudMadeUnit', 'gpHudMadeCap'];
const parts = [], missing = [];
for (const v of VARS) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

/* ---- the canvas stub ------------------------------------------------------
   Records every call with its coordinates. measureText is the one thing that
   has to be plausible rather than merely recorded: the layout advances by
   text width, so returning 0 would stack the speed, the unit and the gear on
   top of each other and every geometry assertion below would pass. */
function makeCtx() {
    const calls = [], pts = [], clipped = [];
    let inClip = 0;
    /* Marks made inside a clip are recorded separately. The minimap draws a
       road that runs well past its own panel and relies on the clip to cut it
       — counting those as "outside the picture" would be wrong, and hiding
       them from the check entirely would be worse. */
    const at = (x, y) => {
        if (!isFinite(x) || !isFinite(y)) return;
        (inClip ? clipped : pts).push([x, y]);
    };
    const ctx = {
        calls, pts, clipped, canvas: { width: 0, height: 0 },
        font: '10px x', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
        lineCap: '', lineJoin: '', textAlign: 'left', textBaseline: 'alphabetic',
        shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, globalAlpha: 1,
        _tx: [0, 0], _stack: [],
        /* The PIXEL size out of the font shorthand, not the first number in it
           — "700 82px mono" starts with the WEIGHT, and measuring three
           characters as 700 px each puts the speed's unit half a screen off
           the right edge. Which is exactly what this stub did, and it read as
           a layout bug in the HUD for a good ten minutes. */
        measureText(t) {
            const m = /([\d.]+)px/.exec(this.font);
            return { width: String(t).length * (m ? parseFloat(m[1]) : 10) * 0.6 };
        },
        fillText(t, x, y) {
            calls.push(['text', t, x, y, this.font, this.fillStyle, this.textAlign,
                        this.measureText(t).width]);
            at(x, y);
        },
        strokeText(t, x, y) { calls.push(['stroketext', t, x, y, this.font, this.strokeStyle]); at(x, y); },
        fillRect(x, y, w, h) { calls.push(['rect', x, y, w, h, this.fillStyle]); at(x, y); at(x + w, y + h); },
        strokeRect(x, y, w, h) { at(x, y); at(x + w, y + h); },
        clearRect() { },
        beginPath() { calls.push(['begin']); }, closePath() { },
        fill() { calls.push(['fill', this.fillStyle, this.globalAlpha]); },
        /* The ALPHA rides with the stroke, because a line's weight on screen
           is its width and its opacity together — the minimap route is a
           2.4-wide #f2f2f3 at 0.85, and a check that could only see the
           colour could not tell that from an opaque one. */
        stroke() { calls.push(['stroke', this.strokeStyle, this.lineWidth, this.globalAlpha]); },
        /* Path points are logged as CALLS as well as coordinates: "does the
           line run past the car" is a question about how many points went
           into the path, and the coordinate list cannot answer it because
           every mark in the minimap lands in the same clipped bucket. */
        moveTo(x, y) { calls.push(['moveTo', x, y]); at(x + this._tx[0], y + this._tx[1]); },
        lineTo(x, y) { calls.push(['lineTo', x, y]); at(x + this._tx[0], y + this._tx[1]); },
        quadraticCurveTo(a, b, x, y) { at(x + this._tx[0], y + this._tx[1]); },
        arc(x, y, r) { at(x + this._tx[0] - r, y + this._tx[1] - r); at(x + this._tx[0] + r, y + this._tx[1] + r); },
        rect(x, y, w, h) { at(x, y); at(x + w, y + h); },
        clip() { inClip++; calls.push(['clip']); },
        /* The radar flavour of the grip circle dashes its axes. A stub
           without this throws, and the throw reads as "the HUD is broken"
           rather than "the stub has not kept up". */
        setLineDash(d) { calls.push(['dash', (d || []).length]); },
        save() { calls.push(['save']); this._stack.push(this._tx.slice()); },
        restore() {
            calls.push(['restore']);
            this._tx = this._stack.pop() || [0, 0];
            if (inClip) inClip--;
        },
        /* Accumulating, and save/restore is a real stack. gpHudPlace nests
           translate/scale/translate around every widget; a stub that kept
           only the last translate would report coordinates no canvas would
           ever draw, and would do it silently. */
        translate(x, y) { this._tx = [this._tx[0] + x, this._tx[1] + y]; },
        rotate(a) { calls.push(['rotate', a]); },
        scale(a, b) { calls.push(['scale', a, b]); }, setTransform() { },
        drawImage(img, x, y, w, h) { calls.push(['image', img && img._src, x, y, w, h]); },
        createLinearGradient() { return { addColorStop() { } }; },
        createRadialGradient() { return { addColorStop() { } }; }
    };
    return ctx;
}

/* ---- a recording -----------------------------------------------------------
   A circle driven at a steady speed, so heading sweeps the full 360 and the
   minimap has something to rotate. Two CAN columns named the way an imported
   logger names them, because that is the path most of his data takes. */
const STALE = 0xFFFF;
function makeTrace(n, opt) {
    opt = opt || {};
    const rows = [], R = 200, mLat = 111320, mLon = 111320 * Math.cos(-34.4 * Math.PI / 180);
    for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        rows.push({
            lat: -34.4 + (R * Math.cos(th)) / mLat,
            lon: 138.5 + (R * Math.sin(th)) / mLon,
            kph: 90 + 30 * Math.sin(th * 3),
            hdg: ((th * 180 / Math.PI) + 90) % 360,
            t: 1000 + i * (opt.dtMs || 40),
            g: 0.3 * Math.sin(th * 2),
            can: opt.can === false ? null
                : [i === 7 ? STALE : Math.round(2000 + 3000 * (0.5 + 0.5 * Math.sin(th * 3))),
                   Math.round((opt.quietThr ? 0 : 100 * Math.abs(Math.sin(th * 3))) * 10),
                   opt.quietThr ? STALE : 550]
        });
    }
    return rows;
}
const CHAN_DEFS = [
    { id: 'my:fx_rpm', name: 'Engine RPM', unit: 'rpm', decimals: 0, scale: 1, offset: 0, signed: false },
    { id: 'my:fx_thr', name: 'Throttle', unit: '%', decimals: 1, scale: 0.1, offset: 0, signed: false },
    { id: 'my:fx_brk', name: 'Brake pressure', unit: 'kPa', decimals: 0, scale: 1, offset: 0, signed: false }
];

function env(opt) {
    opt = opt || {};
    const rows = makeTrace(opt.n || 200, opt);
    const gp = {
        trace: rows, playIdx: 20, selLap: opt.selLap === undefined ? 0 : opt.selLap,
        traceLaps: [{ from: 0, to: rows.length - 1 }],
        traceChanIds: opt.can === false ? null : CHAN_DEFS.map(d => d.id),
        traceChanDefs: opt.can === false ? null : CHAN_DEFS,
        cam: opt.cam || { overlay: true }, ghostFence: null, video: opt.video || null,
        lapsFrom: opt.lapsFrom === undefined ? null : opt.lapsFrom,
        exp: opt.exp || { range: 'lap', quality: 'high', maxH: 0 },
        mapMode: opt.mapMode || 'pace'
    };
    const shim = `
        var gp = ARGgp;
        var GP_CHAN_STALE = 0xFFFF;
        var GP_DRIFT_ON = 10;   /* the same gate the map's car marker uses */
        var GP_DRIFT_ROUGH = 8; /* past this the engine will not stand behind it */
        var GP_DT = 0.04;       /* gpHz's fallback when rows carry no clock */
        function gpN(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
        function gpSpdN(k) { return k === null || k === undefined ? null : k; }
        function gpSpdU() { return 'km/h'; }
        function gpSigned(v, dp) { return (v >= 0 ? '+' : '') + v.toFixed(dp); }
        function gpSpeedColour(x) { return 'rgb(' + Math.round(255 * x) + ',0,0)'; }
        function gpLapRange() { return ARGlap; }
        function gpDeltaSeries() { return ARGdelta; }
        function gpChannels() { return { glat: gp.trace.map(function (r, i) { return 0.6 * Math.sin(i); }) }; }
        function gpCurSessionMeta() { return ARGmeta; }
        function gpTrackById(id) { return ARGtrack; }
        function gpDriftAngle() { return ARGdrift; }
        /* The steering model has its own harness — check_carglyph.js, 156
           checks, including both the failures the trust weighting was added
           for. What matters HERE is that the HUD asks for it and draws what it
           is handed, so these return whatever the test set. Null is the
           default, which is also "this recording cannot feed it": the
           counter-steer and the run card are then absent, and every check
           written before they existed goes on describing the same picture. */
        function gpSteerAt(i, beta, trusted) { return ARGsteer; }
        function gpSteerTrust() { return 1; }
        function gpHudRunAt(i) { return ARGrun; }
        function gpImageryFor(lat, lon) { return ARGsrc; }
        function gpEsc(t) { return String(t); }
        var IMAGES = [];
        function Image() {
            /* naturalWidth/Height matter now: the mark sizes the logo off the
               file's own ratio rather than a baked-in number, so a stub with
               no dimensions would silently exercise the fallback instead.
               The shipped master is 600x275. */
            var o = { crossOrigin: null, _src: null, onload: null, onerror: null,
                      naturalWidth: 600, naturalHeight: 275 };
            Object.defineProperty(o, 'src', { get: function () { return o._src; },
                set: function (v) { o._src = v; IMAGES.push(o);
                    /* 'defer' is the case the whole mechanism exists for: the
                       export button pressed while the logo is still in
                       flight. Landing it synchronously makes the wait an
                       early return and never exercises the queue. */
                    if (ARGimgLoad === 'defer') setTimeout(function () {
                        if (o.onload) o.onload();
                    }, 25);
                    else if (ARGimgLoad && o.onload) o.onload(); } });
            return o;
        }
        /* Real timers. gpHudLogoReady's cap is the interesting half of
           it, and a no-op setTimeout cannot express giving up. The
           repaint nudges these schedule are all behind a
           "typeof gpVideoDrawOverlay === function" guard, which is
           false in here, so nothing else wakes up. */
        var setTimeout = ARGtimer.set, clearTimeout = ARGtimer.clear;
        /* gpExportRunNow's world, reduced to a log. What is being checked is
           an ORDER — did any export work begin before the mark was ready —
           and that cannot be seen from the outside of a real export. */
        var EXPLOG = [];
        function gpFastAvailable() { return true; }
        function gpExportProgress() { EXPLOG.push('progress'); return { close: function () {} }; }
        function gpExportFast() { EXPLOG.push('fast'); return { then: function () {} }; }
        function gpExportSlowPrepared() { EXPLOG.push('slow'); }
        function gpExportName() { return 'x.mp4'; }
        function gpSaveVideoBlob() { return { then: function () {} }; }
        var document = ARGdoc;
        var MediaRecorder = ARGrec;
        var window = { devicePixelRatio: 1 };
        ${parts.join('\n')}
        return { gp: gp, data: gpHudData, render: gpHudRender, chans: gpHudChans,
                 clock: gpHudClock, win: gpHudMiniWindow, rect: gpVideoPictureRect,
                 plan: gpExportPlan, mime: gpExportMime, widgets: GP_HUD_WIDGETS,
                 bpp: GP_EXPORT_BPP, styles: GP_HUD_MAP_STYLES, night: gpHudNightColour,
                 images: IMAGES, tiles: GP_HUD_TILE_CACHE, name: gpExportName,
                 angleColour: gpAngleColour, angleScale: gpAngleScale, ink: GP_HUD_INK,
                 red: GP_HUD_RED,
                 chanList: gpHudChanList, chanAt: gpHudChanAt,
                 widgetList: gpHudWidgetList, madeBox: gpHudMadeBox,
                 traceWhite: GP_TRACE_WHOLE, lapCase: GP_LAP_CASE,
                 logo: gpHudLogoLoad, logoReady: gpHudLogoReady,
                 exportRun: gpExportRunNow, explog: EXPLOG,
                 logoAR: GP_HUD_LOGO_AR, placeOf: gpHudPlaceOf,
                 styleOf: gpHudStyle, hudStyles: GP_HUD_STYLES,
                 angleMax: gpHudAngleMax, steerLock: GP_STEER_LOCK,
                 suggest: gpHudSuggest, slideSecs: gpHudSlideSecs,
                 untouched: gpHudUntouched, suggested: gpHudSuggested,
                 presets: GP_HUD_PRESETS, sugSecs: GP_HUD_SUG_SLIDE_S };
    `;
    const lap = opt.lap || { from: 0, to: rows.length - 1 };
    const delta = opt.delta === undefined ? rows.map((r, i) => (i % 7) / 10 - 0.3) : opt.delta;
    const doc = opt.doc || { getElementById: () => null };
    const rec = opt.rec || function () { };
    rec.isTypeSupported = opt.supports || (m => /webm/.test(m));
    const meta = opt.meta === undefined ? { track: 'Winton', trackId: 't1' } : opt.meta;
    const track = opt.track === undefined ? null : opt.track;
    const drift = opt.drift === undefined ? null : opt.drift;
    const imgSrc = opt.imgSrc || { id: 'sa', maxNativeZoom: 21,
        url: 'https://location.sa.gov.au/mapproxy/wmts/PublicMosaic/webmercator_22/{z}/{x}/{y}.png' };
    /* Images land synchronously by default — every check in this file was
       written against a HUD whose mark was text, and the mark is a picture
       now; those assertions have to keep describing the shipping product.
       opt.imgLoad:false exercises the fallback. */
    const imgLoad = opt.imgLoad === undefined ? true : opt.imgLoad;
    const timer = { set: setTimeout, clear: clearTimeout };
    const steer = opt.steer === undefined ? null : opt.steer;
    const run = opt.run === undefined ? null : opt.run;
    return new Function('ARGgp', 'ARGlap', 'ARGdelta', 'ARGdoc', 'ARGrec',
        'ARGmeta', 'ARGtrack', 'ARGdrift', 'ARGsrc', 'ARGimgLoad', 'ARGtimer',
        'ARGsteer', 'ARGrun',
        shim)(gp, lap, delta, doc, rec, meta, track, drift, imgSrc, imgLoad, timer,
              steer, run);
}

const GP_HUD_MADE_TYPES = (function () {
    const m = /var GP_HUD_MADE = \[([\s\S]*?)\];/.exec(src);
    return m ? (m[1].match(/\["(\w+)"/g) || []).map(t => t.slice(2, -1)) : [];
})();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-6 : tol); }

/* ══ what the recording feeds it ══════════════════════════════════════════ */
console.log('the HUD takes its numbers from the recording, and only what is there');
{
    const E = env();
    const ch = E.chans();
    ok('a channel called "Engine RPM" is found without a canonical id', !!ch.rpm);
    ok('…and so is Throttle', !!ch.thr);
    ok('…and Brake pressure', !!ch.brk);
    ok('the tacho ceiling is the measured maximum, rounded up to 500',
       ch.rpm.max % 500 === 0 && ch.rpm.max >= 5000 && ch.rpm.max <= 5500, 'got ' + ch.rpm.max);
    ok('a per-cent pedal is full scale at 100, whatever this driver used',
       ch.thr.full === 100, 'got ' + ch.thr.full);
    ok('a pedal in kPa has no natural ceiling, so the hardest of the session is it',
       near(ch.brk.full, 550), 'got ' + ch.brk.full);

    const d = E.data(7);
    ok('a stale sample reads as nothing, not as 65535', d.rpm === null, 'got ' + d.rpm);
    const d2 = E.data(20);
    ok('a live sample decodes through the channel scale',
       d2.rpm > 2000 && d2.rpm < 5500, 'got ' + d2.rpm);
    ok('throttle comes back as a fraction the renderer can use',
       d2.thrF >= 0 && d2.thrF <= 1, 'got ' + d2.thrF);
}
{
    const E = env({ quietThr: true });
    const ch = E.chans();
    ok('a column that never said anything is not offered as a channel', !ch.brk);
    ok('…and the pedal it would have drawn is left out', E.data(20).brkF === null);
}
{
    const E = env({ can: false });
    ok('a recording with no CAN at all still produces data', !!E.data(20));
    ok('…with no tacho', E.data(20).rpm === null);
    ok('…and no gear', E.data(20).gear === null);
}

/* ══ the same picture at every size ═══════════════════════════════════════ */
console.log('\none renderer, two sizes — the whole reason it takes W and H');
function draw(E, W, H, i) {
    const g = makeCtx();
    const drew = E.render(g, W, H, i === undefined ? 20 : i);
    return { g, drew };
}
{
    const E = env();
    const a = draw(E, 1280, 720), b = draw(E, 2560, 1440);
    ok('it draws at 720p', a.drew);
    ok('it draws at 1440p', b.drew);
    const texts = c => c.g.calls.filter(k => k[0] === 'text');
    ok('the same widgets appear at both sizes',
       texts(a).length === texts(b).length, texts(a).length + ' vs ' + texts(b).length);
    /* Every text position and every font size doubles, exactly. That is the
       invariant the export depends on. */
    const px = f => parseFloat(/([\d.]+)px/.exec(f)[1]);   /* NOT parseFloat(f) — that is the weight */
    let worst = 0;
    texts(a).forEach((t, k) => {
        const u = texts(b)[k];
        if (!u) return;
        worst = Math.max(worst, Math.abs(u[2] - t[2] * 2), Math.abs(u[3] - t[3] * 2),
                         Math.abs(px(u[4]) - px(t[4]) * 2));
    });
    ok('every position and font size scales exactly with H', worst < 0.02, 'worst drift ' + worst);
}

console.log('\nnothing is drawn outside the picture');
/* Portrait is in here because it was NOT, and the first phone-shaped export
   put the minimap over the edge of the frame: the HUD was scaled off height
   alone, and a 1080×1920 video is 2.7 times 720 tall while being narrower
   than a 720p frame is wide. The scale now comes from the SHORT side with a
   width guard, so portrait is big AND stays inside — which is exactly the
   pair of failures these two suites pin. */
[[1280, 720], [1920, 1080], [2704, 1520], [640, 360], [960, 540],
 [1080, 1920], [720, 1280], [1080, 1080]].forEach(function (sz) {
    const E = env();
    const { g } = draw(E, sz[0], sz[1]);
    let bad = null;
    g.pts.forEach(p => {
        if (p[0] < -1 || p[1] < -1 || p[0] > sz[0] + 1 || p[1] > sz[1] + 1)
            bad = bad || p;
    });
    ok(sz[0] + '×' + sz[1] + ' keeps every mark inside the frame', !bad,
       bad ? 'at ' + bad.map(Math.round) : '');
});

console.log('\nthe widgets do not sit on top of each other');
/* The left cluster grows with the speed's own text width; the minimap is
   pinned to the right. On a narrow frame they meet, and "inside the picture"
   does not notice — both ARE inside it, one on top of the other. */
[[1280, 720], [1920, 1080], [1080, 1920], [720, 1280], [640, 360]].forEach(function (sz) {
    const E = env();
    const g = makeCtx();
    E.render(g, sz[0], sz[1], 20);
    const S = Math.min(Math.min(sz[0], sz[1]) / 720, sz[0] / 700);
    const mapLeft = sz[0] - 26 * S - 240 * S;
    /* Text right edges, worked out from where each string was placed and how
       it was aligned — the left cluster is text, and text is what runs into
       the map when the scale is wrong. */
    const rightEdge = k => k[6] === 'right' ? k[2] : k[6] === 'center' ? k[2] + k[7] / 2 : k[2] + k[7];
    const cluster = g.calls.filter(k => k[0] === 'text' && k[3] > sz[1] * 0.55 && k[2] < mapLeft);
    const reach = cluster.reduce((m, k) => Math.max(m, rightEdge(k)), 0);
    ok(sz[0] + '×' + sz[1] + ': the left cluster stops short of the minimap',
       reach <= mapLeft + 1, 'cluster reaches ' + Math.round(reach) +
       ', map starts ' + Math.round(mapLeft));
});

console.log('\nthe minimap has four grounds and draws on all of them');
{
    env().styles.forEach(function (m) {
        const E = env({ cam: { overlay: true, hudMapStyle: m[0] } });
        const g = makeCtx();
        const drew = E.render(g, 1280, 720, 20);
        ok(m[1] + ' draws', drew && g.calls.some(k => k[0] === 'stroke'));
        ok(m[1] + ' still labels how far the map reaches',
           g.calls.some(k => k[0] === 'text' && /^\d+ m$/.test(String(k[1]))));
    });
    ok('an unknown ground falls back to Night rather than drawing nothing',
       env({ cam: { overlay: true, hudMapStyle: 'nonsense' } }).render(makeCtx(), 1280, 720, 20));
}

console.log('\nsatellite tiles are fetched in a way the EXPORT can use');
{
    const E = env({ cam: { overlay: true, hudMapStyle: 'sat' } });
    E.render(makeCtx(), 1280, 720, 20);
    /* The mark's logo is an image on this canvas too, and it is a DIFFERENT
       kind: same-origin, shipped beside index.html, so it neither needs nor
       asks for CORS. Only the tiles are cross-origin, and only they carry
       the attribute the export depends on. */
    const logoImg = E.logo().img;
    const tiles = E.images.filter(i => i !== logoImg);
    ok('tiles were requested', tiles.length > 0, tiles.length + ' tiles');
    ok('the logo is fetched same-origin, no CORS needed',
       logoImg.crossOrigin === null && logoImg.src === 'rdm_logo.png',
       logoImg.crossOrigin + ' / ' + logoImg.src);
    /* A cross-origin image without this taints the canvas, and a tainted
       canvas hands out no frames at all — the export produces an empty file
       and no error. This one line is the difference. */
    ok('every tile is requested with crossOrigin anonymous',
       tiles.every(i => i.crossOrigin === 'anonymous'));
    ok('tiles come from a real tile URL with the placeholders filled in',
       tiles.every(i => /^https:\/\//.test(i.src) && !/\{[zxy]\}/.test(i.src)),
       tiles[0] && tiles[0].src);
    const zs = tiles.map(i => +(/\/(\d+)\//.exec(i.src.replace(/^https:\/\/[^/]+/, '')) || [0, 0])[1]);
    ok('the zoom asked for is one a source actually has', zs.every(z => z >= 2 && z <= 21));
    const before = E.images.length;
    E.render(makeCtx(), 1280, 720, 20);
    ok('the same frame twice does not re-request the same tiles',
       E.images.length === before, before + ' -> ' + E.images.length);
}

console.log('\nthe circuit and the start/finish line, when the session knows them');
{
    const track = {
        outline: { pts: [[-34.3982, 138.5], [-34.4, 138.5024], [-34.4018, 138.5], [-34.4, 138.4976]] },
        start_finish: { lat: -34.3982, lon: 138.5, heading: 90, half_width_m: 12 }
    };
    const plain = env({ cam: { overlay: true, hudMapStyle: 'plain' } });
    const withTrack = env({ cam: { overlay: true, hudMapStyle: 'plain' }, track: track });
    const strokes = E => { const g = makeCtx(); E.render(g, 1280, 720, 20); return g.calls.filter(k => k[0] === 'stroke').length; };
    ok('a session with a track outline draws more than one without',
       strokes(withTrack) > strokes(plain), strokes(withTrack) + ' vs ' + strokes(plain));
    const g = makeCtx();
    withTrack.render(g, 1280, 720, 20);
    ok('the start/finish line is drawn in white on the plain ground',
       g.calls.some(k => k[0] === 'stroke' && k[1] === '#ffffff'));
    const gn = makeCtx();
    env({ cam: { overlay: true, hudMapStyle: 'night' }, track: track }).render(gn, 1280, 720, 20);
    ok('…and in amber on the night ground',
       gn.calls.some(k => k[0] === 'stroke' && k[1] === '#ffd34d'));
}

console.log('\nthe car points where the car pointed, and only when something measured it');
{
    const noAngle = env();
    ok('with nothing measuring angle, the HUD claims none', noAngle.data(20).beta === null);
    const beta = new Float32Array(200), okArr = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { beta[i] = 24; okArr[i] = 1; }
    const drifting = env({ drift: { beta: beta, ok: okArr, direct: true, src: { name: 'gyro' }, worst: 3 } });
    ok('with a measured angle, it is carried into the HUD', drifting.data(20).beta === 24);
    const g = makeCtx();
    drifting.render(g, 1280, 720, 20);
    ok('a big angle is written on the minimap', g.calls.some(k => k[0] === 'text' && String(k[1]) === '24°'));
    const g2 = makeCtx();
    noAngle.render(g2, 1280, 720, 20);
    ok('and nothing is written when nothing measured it',
       !g2.calls.some(k => k[0] === 'text' && /°$/.test(String(k[1]))));
    /* A measured SMALL angle is still an answer. Gating the readout at 3°
       made a whole export read as "no drift angle on the minimap" when the
       instrument was live the entire time — 0° measured and °-less missing
       must not look the same. */
    const calm = new Float32Array(200), calmOk = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { calm[i] = 1.2; calmOk[i] = 1; }
    const g3 = makeCtx();
    env({ drift: { beta: calm, ok: calmOk, direct: true, src: { name: 'gyro' }, worst: 3 } })
        .render(g3, 1280, 720, 20);
    ok('a small measured angle is written too, not hidden below a threshold',
       g3.calls.some(k => k[0] === 'text' && String(k[1]) === '1°'));
}

console.log('\nthe minimap route is the analysis map\'s own line');
{
    /* "The smaller constant line like what's on the analyse GPS page — that's
       a perfect line." So the minimap draws that recipe and no other: the
       same GP_TRACE_WHOLE over a casing GP_LAP_CASE wide each side, ONE
       colour for the whole window, ahead of the car as well as behind.

       The three things that must never come back are the three that were
       each asked off in turn: a fat ribbon, a speed ramp, an angle ramp. The
       angle belongs to the CAR — the wedge fill carries gpAngleColour and no
       stroke ever does. */
    const beta = new Float32Array(200), okA = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { beta[i] = (i % 2) ? 24 : -24; okA[i] = 1; }
    const drift = { beta, ok: okA, direct: true, src: { name: 'gyro' }, worst: 3 };

    const routeOf = (g) => g.calls.filter(k => k[0] === 'stroke' && k[1] === '#f2f2f3');

    {
        const E = env();
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
        const ms = 240 * S;               /* the minimap's own S is size/240 */
        const mS = ms / 240;
        const route = routeOf(g);
        ok('the route is drawn in the map\'s own neutral, not a ramp',
           route.length === 1, route.length + ' strokes');
        ok('…2.4 wide, the analysed lap\'s own width',
           route.length === 1 && near(route[0][2], 2.4 * mS, 1e-9),
           route.length ? route[0][2] : '-');
        ok('…at 0.85, so the ground still reads through it',
           route.length === 1 && near(route[0][3], 0.85, 1e-9),
           route.length ? route[0][3] : '-');
        ok('the constants are the analysis map\'s, not a second set',
           E.traceWhite === '#f2f2f3' && E.lapCase === 1.8,
           E.traceWhite + ' / ' + E.lapCase);

        /* The casing: GP_LAP_CASE each side of the core, so 2.4 + 3.6. Dark,
           and only dark — this is what makes a white line legible over aerial
           imagery, and it is the analysis map's trick verbatim. */
        const cas = g.calls.filter(k => k[0] === 'stroke' &&
                                        near(k[2], (2.4 + E.lapCase * 2) * mS, 1e-9));
        ok('it rides on a dark casing GP_LAP_CASE wide each side', cas.length === 1,
           cas.length + ' found');
        ok('…and the casing is dark, not a colour',
           cas.length === 1 && /^rgba\(\d+,\d+,\d+,/.test(String(cas[0][1])) &&
           parseInt(String(cas[0][1]).slice(5), 10) < 40, cas.length ? cas[0][1] : '-');

        /* The whole window, not half of it. gpHudMiniWindow puts the car at
           index nBack, so a path that stops there is the old behind-only
           trail; the analyse map runs its line through the playhead and out
           the other side, and that is the shape asked for. */
        /* The window the RENDER used, not one invented here: aheadM is
           4.8 seconds of road at the speed the car was actually doing, so a
           fixture window of some other length compares two different roads. */
        const d20 = E.data(20);
        const win = E.win(20, Math.max(160, Math.min(700, (d20.kph || 0) / 3.6 * 4.8)));
        const begins = [];
        g.calls.forEach((k, idx) => { if (k[0] === 'begin') begins.push(idx); });
        const coreAt = g.calls.indexOf(route[0]);
        const bStart = begins.filter(b => b < coreAt).pop();
        const pts = g.calls.slice(bStart, coreAt).filter(k => k[0] === 'moveTo' || k[0] === 'lineTo');
        ok('the line runs through the whole window, ahead as well as behind',
           pts.length > win.nBack + 1,
           pts.length + ' points, car at ' + win.nBack);
        ok('…which is every point the window holds',
           pts.length === win.pts.length, pts.length + ' of ' + win.pts.length);
    }
    {
        const E = env({ drift, mapMode: 'angle' });
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const sc = Math.max(12, E.angleScale());
        const strokes = new Set(g.calls.filter(k => k[0] === 'stroke').map(k => k[1]));
        const wedge = [E.angleColour(24 / sc), E.angleColour(-24 / sc)];
        ok('no stroke carries the angle ramp — the wedge fill does',
           !strokes.has(wedge[0]) && !strokes.has(wedge[1]) &&
           g.calls.some(k => k[0] === 'fill' && wedge.indexOf(k[1]) >= 0));
        ok('…and the route stays neutral even in Angle mode',
           routeOf(g).length === 1);
    }
    {
        const E = env();
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const strokes = g.calls.filter(k => k[0] === 'stroke').map(k => String(k[1]));
        ok('no stroke carries a speed colour — the route is not a rainbow',
           !strokes.some(c => /^rgb\(\d+,0,0\)$/.test(c)));
    }
    {
        /* With the circuit outline present — the one wide stroke on this map
           that is allowed to exist, because it is GROUND, drawn once under
           everything. Nothing else may be fatter than the route's casing:
           that is the whole of "make it look cleaner", stated as a rule a
           future edit has to break on purpose. */
        const outline = { outline: { pts: [] } };
        for (let a = 0; a < 40; a++) {
            const th = (a / 40) * Math.PI * 2;
            outline.outline.pts.push([-34.4 + 0.0025 * Math.cos(th),
                                      138.5 + 0.003 * Math.sin(th)]);
        }
        const E = env({ track: outline });
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
        const casing = (2.4 + E.lapCase * 2) * S;
        const fat = g.calls.filter(k => k[0] === 'stroke' && k[2] > casing + 1e-9);
        ok('the only stroke wider than the casing is the outline halo',
           fat.length === 1 && near(fat[0][2], 20 * S, 1e-9),
           fat.map(k => k[1] + '@' + k[2]).join(', ') || 'none');
        ok('…and the outline is a ground wash, not a line', fat.length === 1 &&
           /^rgba\(/.test(String(fat[0][1])) &&
           parseFloat(String(fat[0][1]).split(',')[3]) <= 0.3, fat.length ? fat[0][1] : '-');
    }
    {
        /* Night keeps the same line. The ground changes; the route does not,
           because "constant" has to mean constant across the four grounds
           too — that was the other half of "looks nothing like the map on
           Analyse". */
        const E = env({ cam: { overlay: true, hudMapStyle: 'night' } });
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        ok('the night ground gets the same neutral route', routeOf(g).length === 1);
    }
}

console.log('\nthe minimap car wears the analysis map\'s own language');
{
    /* White arrow, the angle wedge in gpAngleColour, and the degrees at the
       car — the same three things the big map's car marker shows, with the
       same 10-degree gate on the wedge and the label. */
    const beta = new Float32Array(200), okA = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { beta[i] = 24; okA[i] = 1; }
    const E = env({ drift: { beta, ok: okA, direct: true, src: { name: 'gyro' }, worst: 3 } });
    const g = makeCtx();
    E.render(g, 1280, 720, 20);
    ok('the arrow is white over a dark keyline',
       g.calls.some(k => k[0] === 'fill' && k[1] === '#f7f8f9') &&
       g.calls.some(k => k[0] === 'stroke' && k[1] === '#0a0c0e'));
    const sc = Math.max(12, E.angleScale());
    const want = E.angleColour(Math.max(-1, Math.min(1, 24 / sc)));
    ok('the wedge between travel and body carries gpAngleColour',
       g.calls.some(k => k[0] === 'fill' && k[1] === want), want);
    ok('the degrees ride at the car, bold over a keyline',
       g.calls.some(k => k[0] === 'text' && String(k[1]) === '24°' && /^700 /.test(k[4])) &&
       g.calls.some(k => k[0] === 'stroketext' && String(k[1]) === '24°'));
    /* and the same gate as the map: a gripping car wears no wedge */
    const calm = new Float32Array(200), calmOk = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { calm[i] = 4; calmOk[i] = 1; }
    const E2 = env({ drift: { beta: calm, ok: calmOk, direct: true, src: { name: 'gyro' }, worst: 3 } });
    const g2 = makeCtx();
    E2.render(g2, 1280, 720, 20);
    const sc2 = Math.max(12, E2.angleScale());
    ok('under ten degrees the wedge stays off, exactly as it does on the map',
       !g2.calls.some(k => k[0] === 'fill' && k[1] === E2.angleColour(4 / sc2)));
}

console.log('\nan untouched layout draws exactly what it always drew');
{
    /* The placer went in UNDER a HUD that was already right. Every widget is
       wrapped in a transform now, and the entire value of that refactor
       depends on it changing nothing at all when nobody has moved anything.
       Absent config and an empty config must both be the factory picture,
       call for call. */
    const shot = (cam) => {
        const g = makeCtx();
        env({ cam }).render(g, 1280, 720, 20);
        return JSON.stringify(g.calls);
    };
    const factory = shot({ overlay: true });
    ok('an empty layout is the factory picture, call for call',
       shot({ overlay: true, hud: { v: 1, w: {} } }) === factory);
    ok('a layout naming a widget with no overrides is too',
       shot({ overlay: true, hud: { v: 1, w: { hudSpeed: {} } } }) === factory);
    ok('…and so are zeroes written out in full',
       shot({ overlay: true, hud: { v: 1, w: { hudSpeed: { dx: 0, dy: 0, k: 1 } } } }) === factory);
    ok('nothing is saved or restored for a widget nobody moved',
       JSON.parse(factory).filter(k => k[0] === 'scale').length === 0);
    ok('rubbish in the store cannot move anything',
       shot({ overlay: true, hud: { v: 1, w: { hudSpeed: { dx: 'x', dy: null, k: 0 } } } }) === factory);
}

console.log('\nwidgets can be moved and resized, in units that survive the size');
{
    const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
    const rectsOf = (cam) => {
        const g = makeCtx(), rects = [];
        env({ cam }).render(g, 1280, 720, 20, { rects });
        return { g, rects, by: k => rects.filter(r => r.key === k)[0] };
    };
    {
        const a = rectsOf({ overlay: true });
        ok('every visible widget reports a rectangle',
           ['hudSpeed', 'hudTacho', 'hudPedals', 'hudG', 'hudDelta', 'hudMap', 'hudMark']
               .every(k => !!a.by(k)),
           a.rects.map(r => r.key).join(','));
        ok('…and the map\'s rectangle is where the map is drawn',
           near(a.by('hudMap').w, 240 * S, 1e-9) && near(a.by('hudMap').h, 240 * S, 1e-9),
           a.by('hudMap').w + 'x' + a.by('hudMap').h);
        ok('a switched-off widget reports nothing to hit',
           !rectsOf({ overlay: true, hudMap: false }).by('hudMap'));
    }
    {
        const base = rectsOf({ overlay: true }).by('hudSpeed');
        const moved = rectsOf({ overlay: true,
            hud: { v: 1, w: { hudSpeed: { dx: 40, dy: -12 } } } }).by('hudSpeed');
        ok('a nudge moves the rectangle by that many S',
           near(moved.x - base.x, 40 * S, 1e-9) && near(moved.y - base.y, -12 * S, 1e-9),
           (moved.x - base.x) + ',' + (moved.y - base.y));
    }
    {
        /* The whole reason offsets are stored in S and not pixels: a layout
           laid out on a 720p tile has to land in the same PROPORTIONAL place
           in a 3840-wide export. */
        const cam = { overlay: true, hud: { v: 1, w: { hudSpeed: { dx: 40, dy: -12 } } } };
        const small = (() => { const g = makeCtx(), r = [];
            env({ cam }).render(g, 1280, 720, 20, { rects: r }); return r; })();
        const big = (() => { const g = makeCtx(), r = [];
            env({ cam }).render(g, 3840, 2160, 20, { rects: r }); return r; })();
        const s0 = (() => { const g = makeCtx(), r = [];
            env({ cam: { overlay: true } }).render(g, 1280, 720, 20, { rects: r }); return r; })();
        const b0 = (() => { const g = makeCtx(), r = [];
            env({ cam: { overlay: true } }).render(g, 3840, 2160, 20, { rects: r }); return r; })();
        const pick = (r, k) => r.filter(x => x.key === k)[0];
        const S4 = Math.min(Math.min(3840, 2160) / 720, 3840 / 700);
        ok('the same nudge is the same nudge at 4K, proportionally',
           near((pick(big, 'hudSpeed').x - pick(b0, 'hudSpeed').x) / S4,
                (pick(small, 'hudSpeed').x - pick(s0, 'hudSpeed').x) / S, 1e-9));
    }
    {
        const base = rectsOf({ overlay: true }).by('hudMap');
        const big = rectsOf({ overlay: true,
            hud: { v: 1, w: { hudMap: { k: 1.5 } } } });
        const r = big.by('hudMap');
        ok('a resize scales the rectangle', near(r.w, base.w * 1.5, 1e-9), r.w);
        ok('…about its own centre, so it does not walk across the frame',
           near(r.x + r.w / 2, base.x + base.w / 2, 1e-9) &&
           near(r.y + r.h / 2, base.y + base.h / 2, 1e-9),
           (r.x + r.w / 2) + ' vs ' + (base.x + base.w / 2));
        ok('…and the canvas is really scaled, not just the bookkeeping',
           big.g.calls.some(k => k[0] === 'scale' && k[1] === 1.5));
    }
    {
        /* Predictability over cleverness: moving one widget must not re-flow
           the ones that were laid out from it. */
        const a = rectsOf({ overlay: true });
        const b = rectsOf({ overlay: true, hud: { v: 1, w: { hudSpeed: { dx: 200 } } } });
        ok('moving the speed does not drag the tacho with it',
           near(a.by('hudTacho').x, b.by('hudTacho').x, 1e-9) &&
           near(a.by('hudTacho').w, b.by('hudTacho').w, 1e-9));
        ok('…nor the map, on the other side of the picture',
           near(a.by('hudMap').x, b.by('hudMap').x, 1e-9));
    }
}

console.log('\nwidgets made from the recording\'s own channels');
{
    const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
    {
        const E = env();
        const list = E.chanList();
        ok('every live channel is offered', list.length === 3, list.length + ' offered');
        ok('…by the name the logger wrote',
           list.map(c => c.name).join() === 'Engine RPM,Throttle,Brake pressure',
           list.map(c => c.name).join());
        ok('…each with the range it actually covered',
           list.every(c => isFinite(c.lo) && isFinite(c.hi) && c.hi > c.lo),
           JSON.stringify(list.map(c => [c.lo, c.hi])));
        ok('a channel that never moved still gets two different ends',
           list.every(c => c.hi - c.lo > 0));
    }
    {
        /* A column nothing ever answered is not a channel. Offering it means
           offering a widget that can only ever read blank. */
        /* quietThr pins the BRAKE column stale for every sample — that is
           the one that must not be offered. */
        const E = env({ quietThr: true });
        ok('a quiet column is not offered',
           !E.chanList().some(c => /Brake/.test(c.name)),
           E.chanList().map(c => c.name).join());
        ok('…while the columns that did speak still are',
           E.chanList().length === 2, E.chanList().map(c => c.name).join());
    }
    {
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            { id: 'w1', type: 'panel', chan: 'my:fx_rpm', label: 'Revs', unit: 'rpm', dp: 0 }
        ] } };
        const g = makeCtx();
        env({ cam }).render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a made readout draws its caption, in capitals',
           txt.indexOf('REVS') >= 0, txt.join('|'));
        ok('…the value at that sample', txt.some(t => /^\d+$/.test(t) && +t > 2000), txt.join('|'));
        ok('…and the unit beside it', txt.indexOf('rpm') >= 0);
    }
    {
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            { id: 'w1', type: 'bar', chan: 'my:fx_thr', label: 'Throttle', unit: '%', dp: 0,
              lo: 0, hi: 100 }
        ] } };
        const g = makeCtx();
        env({ cam }).render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a made bar draws its caption', txt.indexOf('THROTTLE') >= 0, txt.join('|'));
        ok('…and a filled track', g.calls.filter(k => k[0] === 'fill').length > 2);
    }
    {
        /* Bound to nothing, or to a channel this recording has not got: say
           so with a dash. A confident 0 reads as a measurement. */
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            { id: 'w1', type: 'panel', chan: 'nope:not_here', label: 'Ghost' }
        ] } };
        const g = makeCtx();
        env({ cam }).render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a widget bound to a missing channel reads as a dash, not a zero',
           txt.indexOf('GHOST') >= 0 && txt.indexOf('—') >= 0, txt.join('|'));
    }
    {
        const cam = { overlay: true, hud: { v: 1, seq: 2, add: [
            { id: 'w1', type: 'panel', chan: 'my:fx_rpm', label: 'One' },
            { id: 'w2', type: 'panel', chan: 'my:fx_rpm', label: 'Two' }
        ] } };
        const E = env({ cam });
        const g = makeCtx(), rects = [];
        E.render(g, 1280, 720, 20, { rects });
        const a1 = rects.filter(r => r.key === 'w1')[0];
        const b1 = rects.filter(r => r.key === 'w2')[0];
        ok('two made widgets both get a rectangle', !!a1 && !!b1);
        ok('…and are staggered, not stacked on each other',
           a1 && b1 && (a1.x !== b1.x || a1.y !== b1.y),
           JSON.stringify([a1, b1]));
        ok('they are in the widget list beside the built-ins',
           E.widgetList().length === E.widgets.length + 2,
           E.widgetList().length + ' vs ' + E.widgets.length);
    }
    {
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            { id: 'w1', type: 'panel', chan: 'my:fx_rpm', label: 'Revs' }
        ] }, w1: false };
        const g = makeCtx();
        env({ cam }).render(g, 1280, 720, 20);
        ok('a made widget switches off like any other',
           !g.calls.some(k => k[0] === 'text' && String(k[1]) === 'REVS'));
    }
    {
        /* The S rule holds for made widgets too, or a layout built on the
           tile lands somewhere else in the export. */
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            { id: 'w1', type: 'panel', chan: 'my:fx_rpm', label: 'Revs' }
        ] } };
        const small = (() => { const g = makeCtx(), r = [];
            env({ cam }).render(g, 1280, 720, 20, { rects: r }); return r.filter(x => x.key === 'w1')[0]; })();
        const big = (() => { const g = makeCtx(), r = [];
            env({ cam }).render(g, 3840, 2160, 20, { rects: r }); return r.filter(x => x.key === 'w1')[0]; })();
        const S4 = Math.min(Math.min(3840, 2160) / 720, 3840 / 700);
        ok('a made widget scales with everything else',
           near(big.w / S4, small.w / S, 1e-9), (big.w / S4) + ' vs ' + (small.w / S));
    }
}

console.log('\nthe dash\'s widget set, drawn over footage');
{
    /* "I want the widgets to match that of the dash." So every type the dash
       offers that means something burned into a video is here, by the same
       name. These are not the dash's RENDERER — that draws onto 800x480 of
       known hardware; these draw onto whatever the camera shot, in S units,
       through the one gpHudRender. What carries across is the vocabulary. */
    const mk = (type, extra) => Object.assign(
        { id: 'w1', type: type, chan: 'my:fx_rpm', label: 'Test' }, extra || {});
    const shot = (type, extra) => {
        const g = makeCtx();
        env({ cam: { overlay: true, hud: { v: 1, seq: 1, add: [mk(type, extra)] } } })
            .render(g, 1280, 720, 20);
        return g;
    };
    /* Marks made by the widget = everything after the built-ins is hard to
       separate, so each type is checked for the shape it is supposed to make:
       a fill, a stroke, a piece of text, an arc. */
    const has = (g, kind) => g.calls.some(k => k[0] === kind);

    GP_HUD_MADE_TYPES.forEach(t => {
        const g = shot(t, { level: -1e9 });     /* alerts tripped, so all draw */
        ok('a ' + t + ' puts marks on the canvas',
           g.calls.length > 0 && (has(g, 'fill') || has(g, 'stroke') || has(g, 'text')),
           t);
    });

    {
        const g = shot('panel');
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a Panel shows its caption and a number',
           txt.indexOf('TEST') >= 0 && txt.some(x => /^\d/.test(x)), txt.join('|'));
    }
    {
        const g = shot('text');
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a Text / Value shows the number without a panel behind it',
           txt.some(x => /^\d/.test(x)) && txt.indexOf('TEST') < 0, txt.join('|'));
    }
    {
        /* A rev bar reads by HOW MANY segments are lit. Two different values
           must light a different number of them, or it is a picture of a bar. */
        const lit = (v) => {
            const g = makeCtx();
            env({ cam: { overlay: true, hud: { v: 1, seq: 1, add: [
                { id: 'w1', type: 'rpm_bar', chan: 'my:fx_rpm', lo: 0, hi: v * 2 }
            ] } } }).render(g, 1280, 720, 20);
            return g.calls.filter(k => k[0] === 'fill' &&
                     String(k[1]) !== 'rgba(245,247,250,0.13)').length;
        };
        ok('a rev bar lights a different number of segments at different scales',
           lit(3000) !== lit(12000), lit(3000) + ' vs ' + lit(12000));
    }
    {
        const g = shot('meter');
        ok('a Meter draws an arc and a needle',
           g.calls.some(k => k[0] === 'stroke'), 'no stroke');
    }
    {
        /* An alert that is not tripped must draw NOTHING. A banner always on
           the picture is a label, not a warning. */
        const quiet = shot('banner', { level: 1e9 });
        const loud = shot('banner', { level: -1e9 });
        ok('a banner that is not tripped stays off the picture',
           quiet.calls.filter(k => k[0] === 'text').length <
           loud.calls.filter(k => k[0] === 'text').length,
           quiet.calls.length + ' vs ' + loud.calls.length);
    }
    {
        const off = shot('warning', { level: 1e9 });
        const on = shot('warning', { level: -1e9 });
        const cols = (g) => g.calls.filter(k => k[0] === 'fill').map(k => String(k[1]));
        ok('an alert light is a different colour lit than unlit',
           cols(on).join() !== cols(off).join());
        ok('…and is drawn either way, so it can be seen to be off',
           off.calls.some(k => k[0] === 'fill'));
    }
    {
        /* "under 150" is as much an alarm as "over 105", and only one of them
           is a maximum. */
        const below = shot('warning', { level: 100000, below: true });
        const above = shot('warning', { level: 100000 });
        ok('an alert can fire BELOW a level as well as above',
           below.calls.filter(k => k[0] === 'fill').map(k => String(k[1])).join() !==
           above.calls.filter(k => k[0] === 'fill').map(k => String(k[1])).join());
    }
    {
        /* The chrome types need no channel at all. */
        ['shape_panel', 'line', 'arc'].forEach(t => {
            const g = makeCtx();
            env({ cam: { overlay: true, hud: { v: 1, seq: 1, add: [{ id: 'w1', type: t }] } } })
                .render(g, 1280, 720, 20);
            ok('a ' + t + ' draws with no channel bound',
               g.calls.some(k => k[0] === 'fill' || k[0] === 'stroke'));
        });
    }
    {
        /* The first cut called a label-and-number box "value". A layout saved
           by that build must still open, and an unknown type must still DRAW
           — a widget in the list, holding a place in the layer order, and
           invisible is the hardest kind of missing to explain. */
        const g = shot('value');
        ok('a layout from the first cut still draws its boxes',
           g.calls.some(k => k[0] === 'text' && String(k[1]) === 'TEST'));
        {
            /* Bound to NOTHING at all — not to a channel that is missing, but
               with no channel chosen. Still a dash, never a zero: a zero on a
               video reads as a measurement somebody took. */
            const g3 = makeCtx();
            env({ cam: { overlay: true, hud: { v: 1, seq: 1,
                add: [{ id: 'w1', type: 'panel', label: 'Unbound' }] } } })
                .render(g3, 1280, 720, 20);
            const t3 = g3.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
            ok('a widget with no channel chosen reads as a dash',
               t3.indexOf('UNBOUND') >= 0 && t3.indexOf('—') >= 0, t3.join('|'));
        }
        const g2 = shot('no_such_type_at_all');
        ok('a type this build has never heard of falls back to a Panel',
           g2.calls.some(k => k[0] === 'text' && String(k[1]) === 'TEST'));
    }
}

console.log('\nthe Track Map: where on the lap, not what is next');
{
    const E_RED = env().red;
    /* The minimap answers "what is the next corner"; the Track Map answers
       "where on the lap is he", which is the question anybody watching the
       video has. Different job, different widget. */
    const outline = { outline: { pts: [] }, name: 'Winton',
                      start_finish: { lat: -34.4, lon: 138.5, heading: 90, half_width_m: 12 } };
    for (let a2 = 0; a2 < 60; a2++) {
        const th = (a2 / 60) * Math.PI * 2;
        outline.outline.pts.push([-34.4 + 0.004 * Math.cos(th), 138.5 + 0.006 * Math.sin(th)]);
    }
    /* hudName OFF throughout: the Track and date caption prints the same
       circuit name, so leaving it on makes "the map's name can be switched
       off" impossible to tell from "something else printed Winton". */
    const mk = (extra) => {
        /* EVERY built-in off, so the only thing on the canvas is the Track
           Map. The caption prints the same circuit name and the grip circle
           fills the same red, and with either of them on there is no way to
           tell the map's own marks from theirs. */
        const cam = { overlay: true, hud: { v: 1, seq: 1, add: [
            Object.assign({ id: 'w1', type: 'track_map' }, extra || {}) ] } };
        env().widgets.forEach(w => { cam[w[0]] = false; });
        return cam;
    };
    const shot = (cam, opt) => {
        const g = makeCtx();
        env(Object.assign({ cam, track: outline }, opt || {})).render(g, 1280, 720, 20);
        return g;
    };
    {
        const g = shot(mk());
        ok('the circuit is drawn', g.calls.some(k => k[0] === 'stroke'));
        ok('…with the track name under it',
           g.calls.some(k => k[0] === 'text' && String(k[1]) === 'Winton'));
        ok('…and the car on it',
           g.calls.some(k => k[0] === 'fill' && String(k[1]) === E_RED), 'no car dot');
    }
    {
        /* Every switch the dash's own Track Map has, and absent means on. */
        const on = shot(mk());
        const noName = shot(mk({ name: 0 }));
        ok('the name can be switched off',
           !noName.calls.some(k => k[0] === 'text' && String(k[1]) === 'Winton') &&
           on.calls.some(k => k[0] === 'text' && String(k[1]) === 'Winton'));
        const noDot = shot(mk({ dot: 0 }));
        ok('the car can be switched off',
           !noDot.calls.some(k => k[0] === 'fill' && String(k[1]) === E_RED));
        const noSf = shot(mk({ sf: 0 }));
        ok('the start/finish tick can be switched off',
           noSf.calls.filter(k => k[0] === 'stroke').length <
           on.calls.filter(k => k[0] === 'stroke').length);
    }
    {
        /* Turning it must MOVE the drawing, or the control is a decoration. */
        const flat = (g) => g.clipped.concat(g.pts).map(q => q.join()).join('|');
        ok('rotation turns the circuit', flat(shot(mk())) !== flat(shot(mk({ rot: 90 }))));
        /* And it must FIT. Scaling by the width alone keeps the aspect but
           runs the circuit out of its own box, which on a video means a track
           map lying across the footage. */
        [0, 45, 90].forEach(deg => {
            const g = shot(mk({ rot: deg }));
            const S1 = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
            const bx = 26 * S1, by = 26 * S1 + 62 * S1, bw = 200 * S1, bh = 150 * S1;
            /* The PATH points, out of the call log — g.pts also holds the
               corners of the background wash, which spans the whole frame and
               would make any box test pass or fail for the wrong reason. */
            const path = g.calls.filter(k => k[0] === 'moveTo' || k[0] === 'lineTo');
            const xs = path.map(k => k[1]), ys = path.map(k => k[2]);
            const inside = path.length > 10 &&
                Math.min.apply(null, xs) >= bx - 1 && Math.max.apply(null, xs) <= bx + bw + 1 &&
                Math.min.apply(null, ys) >= by - 1 && Math.max.apply(null, ys) <= by + bh + 1;
            ok('the circuit fits inside its own box at ' + deg + ' degrees', inside,
               path.length ? [Math.min.apply(null, xs).toFixed(0), Math.max.apply(null, xs).toFixed(0),
                              Math.min.apply(null, ys).toFixed(0), Math.max.apply(null, ys).toFixed(0),
                              'box', bx.toFixed(0), (bx + bw).toFixed(0),
                              by.toFixed(0), (by + bh).toFixed(0)].join(' ') : 'no path');
        });
    }
    {
        /* No track in the library is the common case on a road drive. The
           line that was actually DRIVEN is the better answer anyway. */
        const g = shot(mk(), { track: null, meta: { trackName: 'Somewhere', trackId: null } });
        ok('with no track it draws the line that was driven',
           g.calls.some(k => k[0] === 'stroke'), 'nothing drawn');
        ok('…and still says where it was',
           g.calls.some(k => k[0] === 'text' && String(k[1]) === 'Somewhere'));
    }
    {
        /* Nothing at all to draw says so rather than drawing a blank box. */
        const g = makeCtx();
        env({ cam: mk(), track: null, meta: null, n: 4 }).render(g, 1280, 720, 2);
        ok('with no track and no drive it says so',
           g.calls.some(k => k[0] === 'text' && String(k[1]) === 'no track'));
    }
}

console.log('\nan angle the engine cannot stand behind is not stated');
{
    /* The HUD used to print a confident number for an angle the analysis view
       would have greyed out. Measured on his 23 Aug Mallala lap: 45 degrees
       with a +/-2 bar, on footage showing the car tracking the racing line.
       A video is the one surface where being wrong is permanent, so the HUD
       now reads the same GP_DRIFT_ROUGH gate the Drift readout always had. */
    const beta = new Float32Array(200), okA = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { beta[i] = 24; okA[i] = 1; }
    const conf = (v) => { const c = new Float32Array(200); for (let i = 0; i < 200; i++) c[i] = v; return c; };
    const mk = (c) => ({ beta, ok: okA, conf: c, direct: false, src: { name: 'gyro' }, worst: 3 });

    {
        const E = env({ drift: mk(conf(2)) });
        const d = E.data(20);
        ok('the error bar travels with the angle', d.betaConf === 2, String(d.betaConf));
        ok('a tight bar is not rough', d.betaRough === false);
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a trustworthy angle is printed', txt.indexOf('24°') >= 0, txt.join('|'));
        ok('…with its bar beside it', txt.indexOf('±2') >= 0, txt.join('|'));
        ok('…and it says which way', txt.indexOf('RIGHT') >= 0);
    }
    {
        /* Past the rough gate the number is refused, not dimmed: a dim 45
           degrees is still 45 degrees to anybody watching. */
        const E = env({ drift: mk(conf(23)) });
        ok('a wide bar is rough', E.data(20).betaRough === true);
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('a rough angle is not given as a number', txt.indexOf('24°') < 0, txt.join('|'));
        ok('…it says rough instead', txt.indexOf('rough') >= 0, txt.join('|'));
        ok('…and claims no direction', txt.indexOf('RIGHT') < 0 && txt.indexOf('LEFT') < 0);
    }
    {
        /* The wedge is a stronger claim than the number, not a weaker one. */
        const fine = makeCtx(), rough = makeCtx();
        env({ drift: mk(conf(2)) }).render(fine, 1280, 720, 20);
        env({ drift: mk(conf(23)) }).render(rough, 1280, 720, 20);
        const wedges = (g) => g.calls.filter(k => k[0] === 'fill' &&
            /^rgb\(/.test(String(k[1])) && String(k[1]) !== 'rgb(150,150,150)').length;
        ok('a rough angle gets no wedge on the minimap either',
           wedges(rough) < wedges(fine), wedges(rough) + ' vs ' + wedges(fine));
    }
    {
        const E = env();
        ok('no measured angle means no bar to carry', E.data(20).betaConf === null);
    }
}

console.log('\nthe two widgets the overlay grew');
{
    const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
    const beta = new Float32Array(200), okA = new Uint8Array(200);
    for (let i = 0; i < 200; i++) { beta[i] = (i % 2) ? 24 : -6; okA[i] = 1; }
    const drift = { beta, ok: okA, direct: true, src: { name: 'gyro' }, worst: 3 };
    {
        const E = env({ drift });
        const g = makeCtx();
        E.render(g, 1280, 720, 21);            /* an odd index: beta = +24 */
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('the slip angle is drawn as its own number', txt.indexOf('SLIP') >= 0, txt.join('|'));
        ok('…in whole degrees', txt.some(t => /^\d+°$/.test(t)), txt.join('|'));
        ok('…and says which way', txt.indexOf('RIGHT') >= 0 || txt.indexOf('LEFT') >= 0);
        const sc = Math.max(12, E.angleScale());
        ok('past the map\'s own gate it takes the map\'s colour',
           g.calls.some(k => k[0] === 'text' && /°$/.test(String(k[1])) &&
                             k[5] === E.angleColour(24 / sc)),
           'no ramped angle text');
    }
    {
        /* Under the gate it is a plain reading, not an alarm. */
        const E = env({ drift });
        const g = makeCtx();
        E.render(g, 1280, 720, 20);            /* even index: beta = -6 */
        ok('under the gate it stays neutral ink',
           g.calls.some(k => k[0] === 'text' && /°$/.test(String(k[1])) && k[5] === E.ink),
           'no neutral angle text');
    }
    {
        /* ADR-0011 all the way down: nothing measured it, nothing is drawn. */
        const g = makeCtx();
        env().render(g, 1280, 720, 20);
        ok('with no measured angle there is no slip widget',
           !g.calls.some(k => k[0] === 'text' && String(k[1]) === 'SLIP'));
    }
    {
        const g = makeCtx();
        env({ meta: { trackName: 'Mallala', trackId: 't1', recordedAt: Date.UTC(2026, 7, 23, 1, 30) } })
            .render(g, 1280, 720, 20);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('the track is captioned', txt.indexOf('Mallala') >= 0, txt.join('|'));
        ok('…with the date under it', txt.some(t => /2026/.test(t)), txt.join('|'));
        const nm = g.calls.filter(k => k[0] === 'text' && k[1] === 'Mallala')[0];
        ok('…at the top left, opposite the mark',
           nm && near(nm[2], 26 * S, 1e-9), nm ? nm[2] : '-');
    }
    {
        const g = makeCtx();
        env({ meta: null }).render(g, 1280, 720, 20);
        ok('a recording with no track and no date gets no caption',
           !g.calls.some(k => k[0] === 'text' && /^\d{1,2} \w{3} \d{4}$/.test(String(k[1]))));
    }
    {
        const g = makeCtx();
        env({ drift, cam: { overlay: true, hudAngle: false, hudName: false } })
            .render(g, 1280, 720, 21);
        const txt = g.calls.filter(k => k[0] === 'text').map(k => String(k[1]));
        ok('both switch off like every other widget',
           txt.indexOf('SLIP') < 0 && txt.indexOf('Winton') < 0, txt.join('|'));
    }
}

console.log('\nthe mark is the logo, with Studio after it');
{
    /* "Use our actual RDM logo at the top and write Studio after" — not the
       typed words RDM STUDIO, which is what was there. */
    const S = Math.min(Math.min(1280, 720) / 720, 1280 / 700);
    const M = 26 * S;
    {
        const E = env();
        const g = makeCtx();
        E.render(g, 1280, 720, 20);
        const img = g.calls.filter(k => k[0] === 'image' && k[1] === 'rdm_logo.png');
        ok('the real logo file is drawn', img.length === 1, img.length + ' found');
        ok('…the PNG, never the RDMIMG device blob',
           E.logo().img._src === 'rdm_logo.png', E.logo().img._src);
        const word = g.calls.filter(k => k[0] === 'text' && k[1] === 'Studio');
        ok('"Studio" is written after it', word.length === 1, word.length + ' found');
        ok('…to the RIGHT of the logo, not over it',
           img.length === 1 && word.length === 1 &&
           word[0][2] >= img[0][2] + img[0][4], 'text x ' + (word.length ? word[0][2] : '-'));
        ok('the typed-out mark is gone',
           !g.calls.some(k => k[0] === 'text' && /RDM STUDIO/.test(String(k[1]))));

        /* Measured, then placed: the cluster is anchored by its RIGHT edge,
           so a re-mastered logo of some other ratio still cannot run off the
           frame. The HUD has hung off the side of a picture once already. */
        const right = word.length === 1 ? word[0][2] + word[0][7] : Infinity;
        ok('the cluster ends at the margin, inside the frame',
           right <= 1280 - M + 0.5, 'right edge ' + right.toFixed(1));
        ok('…and starts inside it too', img.length === 1 && img[0][2] > 0,
           img.length ? img[0][2] : '-');
        ok('the logo keeps the file\'s own aspect, not a baked-in box',
           img.length === 1 && near(img[0][4] / img[0][5], 600 / 275, 1e-9),
           img.length ? (img[0][4] / img[0][5]).toFixed(4) : '-');
        ok('it sits at the top margin, where the mark always was',
           img.length === 1 && near(img[0][3], M, 1e-9), img.length ? img[0][3] : '-');
        ok('the mark scales with everything else',
           img.length === 1 && near(img[0][5], 22 * S, 1e-9), img.length ? img[0][5] : '-');
    }
    {
        /* 4K: the same picture, proportionally. The one rule of this file. */
        const g = makeCtx();
        env().render(g, 3840, 2160, 20);
        const S4 = Math.min(Math.min(3840, 2160) / 720, 3840 / 700);
        const img = g.calls.filter(k => k[0] === 'image' && k[1] === 'rdm_logo.png');
        ok('at 4K the mark is the same mark, three times the size',
           img.length === 1 && near(img[0][5], 22 * S4, 1e-9), img.length ? img[0][5] : '-');
    }
    {
        /* The file missing, or slow. A blank corner is not an option. */
        const g = makeCtx();
        env({ imgLoad: false }).render(g, 1280, 720, 20);
        ok('a logo that never loads falls back to the words',
           g.calls.some(k => k[0] === 'text' && String(k[1]) === 'RDM STUDIO'));
        ok('…and nothing broken is drawn in its place',
           !g.calls.some(k => k[0] === 'image' && k[1] === 'rdm_logo.png'));
    }
    {
        const g = makeCtx();
        env({ cam: { overlay: true, hudMark: false } }).render(g, 1280, 720, 20);
        ok('switching the mark off still switches it off',
           !g.calls.some(k => k[0] === 'image' && k[1] === 'rdm_logo.png') &&
           !g.calls.some(k => k[0] === 'text' && /Studio/.test(String(k[1]))));
    }
}

console.log('\nthe night ramp');
{
    const E = env();
    ok('slow is violet, quick is amber', /^rgb\(1?0?8,/.test(E.night(0)) && /2\d\d,2\d\d,\d+\)$/.test(E.night(1)),
       E.night(0) + ' -> ' + E.night(1));
    ok('it never returns a colour with a NaN in it',
       [0, 0.2, 0.45, 0.7, 0.9, 1].every(v => !/NaN/.test(E.night(v))));
}

console.log('\nthe file it saves is named after the session');
{
    ok('a lap export names the lap', /lap1\.mp4$/.test(env({ exp: { range: 'lap' } }).name('mp4')),
       env({ exp: { range: 'lap' } }).name('mp4'));
    ok('the track is in the name', /winton/.test(env().name('mp4')), env().name('mp4'));
}

console.log('\nthe minimap road runs past its panel and is cut by a clip, not by luck');
{
    const E = env();
    const g = makeCtx();
    E.render(g, 1280, 720, 20);
    ok('there IS road drawn beyond the panel', g.clipped.length > 0);
    ok('and a clip was set before it', g.calls.some(k => k[0] === 'clip'));
}

console.log('\nwidgets that have no data are left out, not drawn empty');
{
    const full = draw(env(), 1280, 720).g;
    const bare = draw(env({ can: false }), 1280, 720).g;
    const has = (c, t) => c.calls.some(k => k[0] === 'text' && String(k[1]) === t);
    ok('with CAN, the tacho is labelled', has(full, 'RPM'));
    ok('without CAN, there is no tacho', !has(bare, 'RPM'));
    ok('with CAN, the pedals are labelled', has(full, 'T'));
    ok('without CAN, there are no pedals', !has(bare, 'T') && !has(bare, 'B'));
    ok('the speed is drawn either way',
       full.calls.some(k => k[0] === 'text' && /^\d+$/.test(String(k[1]))) &&
       bare.calls.some(k => k[0] === 'text' && /^\d+$/.test(String(k[1]))));
}
{
    /* One pedal present, one absent: the present one must still be drawn, and
       the absent one must leave no tube behind. */
    const E = env({ quietThr: true });
    const g = draw(E, 1280, 720).g;
    const tags = g.calls.filter(k => k[0] === 'text' && (k[1] === 'T' || k[1] === 'B')).map(k => k[1]);
    ok('only the pedal that exists is drawn', tags.length === 1 && tags[0] === 'T',
       'got ' + JSON.stringify(tags));
}

console.log('\nwidgets can be switched off');
{
    const off = { overlay: true };
    env().widgets.forEach(w => { off[w[0]] = false; });
    const g = draw(env({ cam: off }), 1280, 720).g;
    ok('every widget off leaves only the background wash',
       g.calls.filter(k => k[0] === 'text').length === 0,
       g.calls.filter(k => k[0] === 'text').length + ' texts remained');
}

/* ══ the minimap ══════════════════════════════════════════════════════════ */
console.log('\nthe minimap window is measured in metres along the road');
{
    const E = env();
    const w1 = E.win(60, 200), w2 = E.win(60, 400);
    ok('asking for more road returns more points', w2.pts.length > w1.pts.length,
       w1.pts.length + ' vs ' + w2.pts.length);
    ok('the car is inside the window, not at its edge',
       w1.nBack > 0 && w1.nBack < w1.pts.length - 1, 'nBack ' + w1.nBack + ' of ' + w1.pts.length);
    /* The window walks real distance. On a 200 m-radius circle at 25 Hz the
       200 m ahead is a known number of samples, so a Manhattan walk (which
       over-counts by up to 41%) shows up here as a short window. */
    const spanM = w1.pts.slice(w1.nBack).reduce((acc, p, k, arr) => {
        if (!k) return 0;
        const q = arr[k - 1];
        return acc + Math.hypot(p.e - q.e, p.n - q.n);
    }, 0);
    ok('200 m of road ahead really is about 200 m', spanM > 180 && spanM < 215,
       'got ' + spanM.toFixed(0) + ' m');
    ok('the car sits at the origin of its own window',
       near(w1.pts[w1.nBack].e, 0, 1e-6) && near(w1.pts[w1.nBack].n, 0, 1e-6));
}
{
    /* Heading-up: the point directly ahead must land ABOVE the car on screen,
       whichever way the car is pointing. Checked by rendering and finding the
       minimap's own marks. */
    const E = env();
    const g = makeCtx();
    E.render(g, 1280, 720, 20);
    const S = 1;
    ok('the map draws its scale in metres',
       g.calls.some(k => k[0] === 'text' && /^\d+ m$/.test(String(k[1]))));
}

/* ══ small pure things ═══════════════════════════════════════════════════ */
console.log('\nclock and picture rectangle');
{
    const E = env();
    ok('a lap time reads m:ss.hh', E.clock(86.4) === '1:26.40', 'got ' + E.clock(86.4));
    ok('under ten seconds keeps the leading zero', E.clock(5.25) === '0:05.25', 'got ' + E.clock(5.25));
    ok('no time is a dash', E.clock(null) === '—');

    const el = (bw, bh, vw, vh) => ({ clientWidth: bw, clientHeight: bh, videoWidth: vw, videoHeight: vh });
    /* A 16:9 picture in a WIDER box leaves bars at the sides; in a TALLER box
       it leaves them above and below. The overlay has to land on the picture
       in both — which is the bug the old 46-pixel strip had, spanning the
       element and floating over the bars. */
    const r1 = E.rect(el(800, 400, 1920, 1080));
    ok('bars at the sides: the picture is centred horizontally',
       near(r1.h, 400) && r1.x > 1 && near(r1.x, (800 - r1.w) / 2, 0.01), JSON.stringify(r1));
    const r2 = E.rect(el(800, 600, 1920, 1080));
    ok('bars above and below: the picture is centred vertically',
       near(r2.w, 800) && near(r2.x, 0) && near(r2.y, (600 - 450) / 2, 0.01), JSON.stringify(r2));
    ok('a video with no dimensions yet fills the box',
       E.rect(el(800, 600, 0, 0)).w === 800);
    ok('an unlaid-out element has no rectangle at all', E.rect(el(0, 0, 1920, 1080)) === null);
}

/* ══ the export plan ═════════════════════════════════════════════════════ */
console.log('\nthe export plan');
{
    /* Muted, like the real tile always is — footage opens beside a
       recording to be looked at. The first sound bug was `!el.muted`,
       and a fixture without it lets that bug back in unnoticed. */
    const vid = { videoWidth: 2703, videoHeight: 1521, duration: 300, muted: true };
    const doc = { getElementById: id => (id === 'gpVideo' ? vid : null) };
    const E = env({ doc: doc, video: { t0: 1000, offsetMs: 0 }, exp: { range: 'all', quality: 'high', maxH: 0 } });
    const p = E.plan({ range: 'all', quality: 'high', maxH: 0 });
    ok('an odd frame size is rounded to even, both ways',
       p.W % 2 === 0 && p.H % 2 === 0, p.W + '×' + p.H);
    ok('the camera\'s own size is kept', p.W === 2704 && p.H === 1522, p.W + '×' + p.H);
    const q = E.plan({ range: 'all', quality: 'max', maxH: 1080 });
    ok('1080p asks for 1080 lines', q.H === 1080, 'got ' + q.H);
    ok('maximum quality is a higher bitrate than high', q.bps > E.plan({ range: 'all', quality: 'high', maxH: 1080 }).bps);
    ok('the bitrate is capped so a 4K max export cannot ask for a gigabit',
       E.plan({ range: 'all', quality: 'max', maxH: 0 }).bps <= 80e6);
    ok('a webview that can only do WebM gets WebM', /webm/.test(p.mime), p.mime);

    /* Sound is not a setting any more. It has been got wrong twice in two
       different ways — first tied to the tile's mute (a viewing preference
       silencing every export), then a dialog row that could be left on the
       wrong answer — so there is nothing left to get wrong: the plan always
       asks for it, whatever it is handed. */
    ok('the plan always asks for sound', p.audio === true, String(p.audio));
    ok('…even when something explicitly asks for none',
       E.plan({ range: 'all', quality: 'high', maxH: 0, audio: 'off' }).audio === true);
    ok('…and when nothing mentions sound at all',
       E.plan({ range: 'all', quality: 'high', maxH: 0 }).audio === true);
}
{
    const vid = { videoWidth: 1920, videoHeight: 1080, duration: 300, muted: true };
    const doc = { getElementById: id => (id === 'gpVideo' ? vid : null) };
    const E = env({ doc: doc, video: { t0: 1000, offsetMs: 0 },
                    supports: m => /mp4/.test(m) || /webm/.test(m) });
    ok('MP4 wins when the webview can record it', /mp4/.test(E.plan({ range: 'all', quality: 'high', maxH: 0 }).mime));
}
{
    const vid = { videoWidth: 1920, videoHeight: 1080, duration: 300, muted: true };
    const doc = { getElementById: id => (id === 'gpVideo' ? vid : null) };
    const E = env({ doc: doc, video: null });
    ok('no video, no plan', E.plan({ range: 'all', quality: 'high', maxH: 0 }) === null);
}

/* ---- style variants, and the two drift instruments -------------------------
   One measurement, more than one drawing. The rule these all have to keep is
   the one the whole file is about: a variant is a different PICTURE of the
   same number, never a different number, and it scales with H exactly like
   everything else or the export and the preview drift apart. */
console.log('\nstyle variants say the same thing in a different shape');

const N_ROWS = 200;
function driftOf(beta, conf) {
    return { ok: new Array(N_ROWS).fill(1),
             beta: new Array(N_ROWS).fill(beta),
             conf: new Array(N_ROWS).fill(conf === undefined ? 1.5 : conf) };
}
function camSty(st) { return { overlay: true, hud: { v: 1, w: {}, st: st } }; }
function drawRects(E, W, H, i) {
    const g = makeCtx(), rects = [];
    const drew = E.render(g, W, H, i === undefined ? 20 : i, { rects: rects });
    return { g, rects, drew, texts: g.calls.filter(k => k[0] === 'text').map(k => String(k[1])) };
}
function rectOf(r, key) { return r.filter(q => q.key === key)[0] || null; }

{
    const E = env({ drift: driftOf(24) });
    ok('with nothing stored every widget is on its factory style',
       Object.keys(E.hudStyles).every(k => E.styleOf(k) === E.hudStyles[k][0][0]),
       Object.keys(E.hudStyles).map(k => k + '=' + E.styleOf(k)).join(' '));
    ok('every widget with variants offers at least two',
       Object.keys(E.hudStyles).every(k => E.hudStyles[k].length >= 2));
    ok('…and no widget lists the same style twice',
       Object.keys(E.hudStyles).every(k => {
           const ids = E.hudStyles[k].map(s => s[0]);
           return new Set(ids).size === ids.length;
       }));
    ok('a widget with no variants has no style at all', E.styleOf('hudMap') === null);

    /* A layout written by a later version, or by a finger slip. Falling back
       is the only safe answer: refusing to draw would lose the instrument. */
    const F = env({ drift: driftOf(24), cam: camSty({ hudAngle: 'spiral' }) });
    ok('an unknown stored style falls back to factory', F.styleOf('hudAngle') === 'panel');
    const G = env({ drift: driftOf(24), cam: camSty({ hudAngle: 'dial' }) });
    ok('a stored style is honoured', G.styleOf('hudAngle') === 'dial');
}

{
    /* The dial. Same gate, same number, different picture. */
    const D = env({ drift: driftOf(24), cam: camSty({ hudAngle: 'dial' }) });
    const d = drawRects(D, 1280, 720);
    ok('the dial prints the angle it was handed',
       d.texts.some(t => t === '24.0°'), d.texts.join('|'));
    ok('…and says which way', d.texts.includes('RIGHT'));
    ok('…and labels itself', d.texts.includes('SLIP ANGLE'));
    ok('the dial is numbered, so a position has a value',
       d.texts.includes('0') && d.texts.includes('30'), d.texts.join('|'));

    /* The refusal is the important half. The panel has always said "rough"
       rather than a number past GP_DRIFT_ROUGH, and a bigger drawing of the
       same reading must not become a more confident one. */
    const R = env({ drift: driftOf(24, 12), cam: camSty({ hudAngle: 'dial' }) });
    const r = drawRects(R, 1280, 720);
    ok('a rough reading is still refused on the dial',
       r.texts.includes('rough') && !r.texts.some(t => /^\d+\.\d°$/.test(t)),
       r.texts.join('|'));

    const B = env({ drift: driftOf(24), cam: camSty({ hudAngle: 'bar' }) });
    const b = drawRects(B, 1280, 720);
    ok('the bar prints the angle', b.texts.includes('24°'), b.texts.join('|'));
    ok('…and says which way', b.texts.includes('RIGHT'));
    const RB = env({ drift: driftOf(24, 12), cam: camSty({ hudAngle: 'bar' }) });
    ok('a rough reading is refused on the bar too',
       drawRects(RB, 1280, 720).texts.includes('rough'));

    /* The refusal has to reach the PICTURE, not just the text. Three quarters
       of a lit ring beside the word "rough" is the tool contradicting itself,
       and gpAngleColour is the only thing here that emits an rgb() — the
       ticks, the needle and the unlit segments are all rgba or a hex. Every
       other widget is off so the minimap's own angle-coloured car cannot
       answer for the dial. */
    const ONLY = ['hudSpeed', 'hudTacho', 'hudPedals', 'hudG', 'hudDelta',
                  'hudMap', 'hudName', 'hudMark', 'hudSteer', 'hudRun'];
    const lonely = st => { const c = camSty(st); ONLY.forEach(k => { c[k] = false; }); return c; };
    const litOf = E => drawRects(E, 1280, 720).g.calls
        .filter(k => k[0] === 'stroke' && /^rgb\(/.test(String(k[1]))).length;
    ok('a rough dial lights no segment of the ring',
       litOf(env({ drift: driftOf(24, 12), cam: lonely({ hudAngle: 'dial' }) })) === 0);
    ok('…and a trusted one lights some',
       litOf(env({ drift: driftOf(24), cam: lonely({ hudAngle: 'dial' }) })) > 0);
    const filled = E => drawRects(E, 1280, 720).g.calls
        .filter(k => k[0] === 'rect' && /^rgb\(/.test(String(k[5]))).length;
    ok('a rough bar fills nothing either',
       filled(env({ drift: driftOf(24, 12), cam: lonely({ hudAngle: 'bar' }) })) === 0);
    ok('…and a trusted one fills some',
       filled(env({ drift: driftOf(24), cam: lonely({ hudAngle: 'bar' }) })) > 0);
}

{
    /* S-invariance, per style. This is the invariant the export depends on,
       and a new drawing is exactly where it gets broken. */
    const px = f => parseFloat(/([\d.]+)px/.exec(f)[1]);
    [['dial', { hudAngle: 'dial' }], ['bar', { hudAngle: 'bar' }],
     ['radar', { hudG: 'radar' }], ['boxed speed', { hudSpeed: 'boxed' }],
     ['badge', { hudMark: 'badge' }]].forEach(([name, st]) => {
        const E = env({ drift: driftOf(24), cam: camSty(st), steer: 12,
                        run: { name: 'Turn 3', secs: 4.2, held: 22, peak: 31,
                               rough: false, spun: null, stars: 3.5 } });
        const ga = makeCtx(), gb = makeCtx();
        E.render(ga, 1280, 720, 20); E.render(gb, 2560, 1440, 20);
        const ta = ga.calls.filter(k => k[0] === 'text'), tb = gb.calls.filter(k => k[0] === 'text');
        let worst = 0;
        ta.forEach((t, k) => {
            const u = tb[k];
            if (!u) return;
            worst = Math.max(worst, Math.abs(u[2] - t[2] * 2), Math.abs(u[3] - t[3] * 2),
                             Math.abs(px(u[4]) - px(t[4]) * 2));
        });
        ok('the ' + name + ' style scales exactly with H',
           ta.length === tb.length && worst < 0.02,
           ta.length + ' vs ' + tb.length + ', worst drift ' + worst);
    });
}

{
    /* Counter-steer. It rides on the slip angle, so it appears and disappears
       with it — a wheel drawn off a bicycle-model guess with no measured
       angle behind it is the thing the trust weighting exists to prevent. */
    const none = drawRects(env({ drift: driftOf(24) }), 1280, 720);
    ok('no counter-steer when nothing measured the steering',
       !rectOf(none.rects, 'hudSteer'));
    const noAngle = drawRects(env({ steer: 15, drift: null }), 1280, 720);
    ok('no counter-steer when there is no angle for it to answer',
       !rectOf(noAngle.rects, 'hudSteer'));
    const S = drawRects(env({ steer: -15, drift: driftOf(24) }), 1280, 720);
    ok('counter-steer draws when both are there', !!rectOf(S.rects, 'hudSteer'));
    ok('…printing the magnitude, unsigned — the wheel says which way',
       S.texts.includes('15°'), S.texts.join('|'));
    ok('…and labelling itself', S.texts.includes('COUNTER-STEER'));
}

{
    /* The run card reads gpDriftBoard's own rating. Unrated and nought out of
       five are different answers, and the card must never turn one into the
       other. */
    const none = drawRects(env({ drift: driftOf(24) }), 1280, 720);
    ok('no run card outside a rated corner', !rectOf(none.rects, 'hudRun'));

    const rated = drawRects(env({ drift: driftOf(24),
        run: { name: 'Turn 3', secs: 4.2, held: 22, peak: 31, rough: false,
               spun: null, stars: 3.5 } }), 1280, 720);
    ok('the run card draws inside one', !!rectOf(rated.rects, 'hudRun'));
    ok('…naming the corner', rated.texts.includes('TURN 3'), rated.texts.join('|'));
    ok('…and quoting the rating out of five', rated.texts.includes('3.5/5'));
    ok('…the duration', rated.texts.includes('4.2s'));
    ok('…the held angle and the peak',
       rated.texts.includes('22°') && rated.texts.includes('31°'));

    const unrated = drawRects(env({ drift: driftOf(24),
        run: { name: 'Turn 3', secs: 0.3, held: 4, peak: 6, rough: false,
               spun: null, stars: null } }), 1280, 720);
    ok('an unrated corner is a dash, never nought out of five',
       unrated.texts.includes('—') && !unrated.texts.some(t => /^0\.0\/5$/.test(t)),
       unrated.texts.join('|'));

    const spun = drawRects(env({ drift: driftOf(24),
        run: { name: 'Turn 3', secs: 3, held: 40, peak: 120, rough: false,
               spun: { why: 'over', deg: 120 }, stars: null } }), 1280, 720);
    ok('a spin says so rather than going unrated',
       spun.texts.includes('spun'), spun.texts.join('|'));

    const rough = drawRects(env({ drift: driftOf(24, 12),
        run: { name: 'Turn 3', secs: 4.2, held: 22, peak: 31, rough: true,
               spun: null, stars: null } }), 1280, 720);
    ok('a rough run prints no angles on the card',
       !rough.texts.includes('22°') && !rough.texts.includes('31°'),
       rough.texts.join('|'));
}

{
    /* The radar is the grip circle with its axes named — same two numbers,
       same 2 g full scale. */
    const R = drawRects(env({ cam: camSty({ hudG: 'radar' }) }), 1280, 720);
    ok('the radar prints the pair of readings',
       R.texts.some(t => /^LAT -?\d/.test(t)), R.texts.join('|'));
    ok('…and names its axes', R.texts.includes('ACC') && R.texts.includes('BRK'));
    ok('the radar stays inside the frame',
       (function () { const q = rectOf(R.rects, 'hudG');
                      return q && q.x >= 0 && q.x + q.w <= 1280 + 0.01; })(),
       JSON.stringify(rectOf(R.rects, 'hudG')));
}

{
    /* The left column is a flow, so a taller slip angle has to push the
       counter-steer up rather than sit under it. This is the check that fails
       if someone re-anchors one of them to a fixed offset. */
    ['panel', 'dial', 'bar'].forEach(sty => {
        const E = drawRects(env({ drift: driftOf(24), steer: 15,
                                  cam: camSty({ hudAngle: sty }) }), 1280, 720);
        const a = rectOf(E.rects, 'hudAngle'), s = rectOf(E.rects, 'hudSteer');
        ok('with the ' + sty + ' angle the counter-steer clears it',
           a && s && s.y + s.h <= a.y + 0.01,
           a && s ? ('steer ends ' + (s.y + s.h).toFixed(1) + ', angle starts ' + a.y.toFixed(1))
                  : 'one of them is missing');
    });
}

/* ---- the preset finds you ---------------------------------------------------
   A preset you have to go looking for is still setup. What is checked here is
   that the recording's own answer is read off measurements and not guessed,
   and that it is only ever OFFERED — nothing below applies anything. */
console.log('\nthe recording says which layout it wants');

function driftN(beta, conf, n) {
    n = n || N_ROWS;
    return { ok: new Array(n).fill(1), beta: new Array(n).fill(beta),
             conf: new Array(n).fill(conf === undefined ? 1.5 : conf) };
}
{
    const E = env();
    ok('the threshold is stated in seconds, not samples', E.sugSecs > 0);

    /* 200 samples at 40 ms is exactly 8 s — the line itself. */
    const drifty = env({ drift: driftN(28) });
    ok('a session held past the gate suggests Drift',
       drifty.suggest().n === 0, JSON.stringify(drifty.suggest()));
    ok('…and says how much, so the claim can be checked',
       /\d+ s/.test(drifty.suggest().why), drifty.suggest().why);
    ok('…measured to the second', Math.round(drifty.slideSecs()) === 8,
       String(drifty.slideSecs()));

    const brief = env({ n: 120, drift: driftN(28, 1.5, 120) });
    ok('a few slides is not a drift session',
       brief.suggest().n !== 0, JSON.stringify(brief.suggest()));

    /* Under the angle gate entirely — a tidy circuit lap. */
    const gripLaps = env({ drift: driftN(4), lapsFrom: 'gate' });
    ok('timed laps and no angle suggests Circuit', gripLaps.suggest().n === 1);
    const gripNone = env({ drift: driftN(4) });
    ok('no laps and no angle suggests Clean', gripNone.suggest().n === 2);
    const noDrift = env({ drift: null, lapsFrom: 'gate' });
    ok('a recording with no angle series at all still suggests Circuit',
       noDrift.suggest().n === 1);

    /* The specific signal wins. A drift day at a circuit has gate-cut laps
       too, and Circuit would be the wrong answer for it. */
    const both = env({ drift: driftN(28), lapsFrom: 'gate' });
    ok('drift beats circuit when a session is both', both.suggest().n === 0);

    /* A session full of readings the engine will not stand behind is a
       session with a bad instrument chain, not a drift session. */
    const rough = env({ drift: driftN(28, 12), lapsFrom: 'gate' });
    ok('rough angles do not count toward the slide time',
       rough.slideSecs() === 0, String(rough.slideSecs()));
    ok('…so a rough session is not called a drift session', rough.suggest().n === 1);

    /* Seconds, not sample counts: the same drive logged at 10 Hz has to give
       the same answer as one logged at 25 Hz. */
    const slow = env({ n: 100, dtMs: 100, drift: driftN(28, 1.5, 100) });
    ok('a 10 Hz recording measures the same 10 s',
       Math.round(slow.slideSecs()) === 10, String(slow.slideSecs()));
    ok('…and reaches the same verdict', slow.suggest().n === 0);
    const slowBrief = env({ n: 50, dtMs: 100, drift: driftN(28, 1.5, 50) });
    ok('…and 5 s at 10 Hz is still not a drift session',
       slowBrief.suggest().n !== 0, String(slowBrief.slideSecs()));

    ok('a recording too short to judge is not judged',
       env({ n: 20, drift: driftN(28, 1.5, 20) }).suggest() === null);
}
{
    /* Offered, never applied — and only to somebody who has not answered. */
    const E = env({ drift: driftN(28) });
    ok('an untouched layout gets the offer', E.untouched() && !!E.suggested());
    ok('…and the offer is the same as the suggestion',
       E.suggested().n === E.suggest().n);

    const named = n => env({ drift: driftN(28), cam: Object.assign({ overlay: true }, n) });
    ok('a stored style counts as an answer',
       !named({ hud: { v: 1, w: {}, st: { hudAngle: 'dial' } } }).untouched());
    ok('a moved widget counts as an answer',
       !named({ hud: { v: 1, w: { hudSpeed: { dx: 4, dy: 0, k: 1 } } } }).untouched());
    ok('a reorder counts as an answer',
       !named({ hud: { v: 1, w: {}, z: ['hudMap'] } }).untouched());
    ok('a widget you made counts as an answer',
       !named({ hud: { v: 1, w: {}, add: [{ id: 'w1', type: 'bar' }] } }).untouched());
    ok('a widget switched off counts as an answer',
       !env({ drift: driftN(28), cam: { overlay: true, hudTacho: false } }).untouched());
    ok('and having answered once is remembered',
       !named({ hud: { v: 1, w: {}, sug: 1 } }).untouched());
    ok('an answered layout is offered nothing',
       named({ hud: { v: 1, w: {}, sug: 1 } }).suggested() === null);
}

/* The one check that cannot be synchronous: the export's wait on the mark.
   A late image costs the tile a repaint and costs an export the first frames
   of an 80 MB file, burned in — so gpExportRunNow waits. Both ways it can
   settle are checked, because the timeout is the half that stops a missing
   file from hanging the export for ever. */
console.log('\nthe export waits for the mark before frame 0');
/* A watchdog, not politeness. The interesting failure here is a wait that
   never settles, and awaiting one of those exits node 0 with the assertion
   never reached — a hang that reads as a pass. Same sentinel as
   check_untaint.js, for the same reason. */
const WATCH = setTimeout(() => {
    console.log('  FAIL  the export wait settled at all  -- still waiting after 5 s');
    console.log('\n' + pass + ' passed, ' + (fail + 1) + ' failed');
    process.exit(1);
}, 5000);

Promise.resolve()
    .then(() => env().logoReady(50))
    .then(v => { ok('a logo that loads resolves the wait', v === true, String(v)); })
    .then(() => {
        /* The race itself: asked BEFORE the image lands. This is the only
           path that uses the queue — a logo already loaded takes an early
           return, so a broken queue is invisible without it. */
        const E = env({ imgLoad: 'defer' });
        ok('the wait is genuinely pending when the logo is still in flight',
           E.logo().done === false, 'already done');
        return E.logoReady(2000);
    })
    .then(v => { ok('a logo that lands DURING the wait still resolves it',
                    v === true, String(v)); })
    .then(() => env({ imgLoad: false }).logoReady(20))
    .then(v => { ok('one that never lands times out instead of hanging the export',
                    v === false, String(v)); })
    .then(() => {
        /* And the export ACTUALLY waits. The two checks above prove the wait
           works; this one proves it is on the path — an export that skips it
           passes both of them and still burns a markless frame 0. */
        const E = env();
        E.exportRun({ W: 1280, H: 720 });
        const started = E.explog.length;
        return new Promise(r => setTimeout(() => r(started), 40));
    })
    .then(started => {
        ok('no export work begins on the tick the button is pressed',
           started === 0, started + ' steps ran first');
        ok('…and it does begin once the mark has landed',
           env().explog.length === 0, 'sanity');
        const E2 = env();
        E2.exportRun({ W: 1280, H: 720 });
        return new Promise(r => setTimeout(() => r(E2.explog.slice()), 60));
    })
    .then(log => {
        ok('the export runs after the wait, not instead of it',
           log.length > 0 && log[0] === 'progress', log.join(',') || 'nothing ran');
        clearTimeout(WATCH);
        console.log('\n' + pass + ' passed, ' + fail + ' failed');
        process.exit(fail ? 1 : 0);
    });
