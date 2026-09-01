/* The overlay designer: where a moved widget is remembered, and what the
 * remembering is allowed to change.
 *
 * The editor's whole promise is that it is the SAME HUD, nudged. So the
 * dangerous failures here are not "the drag felt wrong" — they are:
 *
 *   - a layout that forgets itself on reload (gpCamLoad copies key by key,
 *     and anything it does not name is silently dropped)
 *   - a stored layout that means something different at 4K than it did on the
 *     tile it was laid out on
 *   - an editor whose picture and the export's picture come apart
 *
 * The last one is checked in check_hud.js, where an untouched layout is
 * asserted to be the factory picture call for call. This file is the store
 * and the arithmetic around it.
 *
 *   node tools/check_hudedit.js
 */
const fs = require('fs');
const path = require('path');

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
    const re = new RegExp('^        var ' + name + ' = ([\\[{]?)', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: var ' + name);
    if (!m[1]) {
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

const VARS = ['GP_HUD_WIDGETS', 'GP_CAM_LS', 'GP_HUD_MADE', 'GP_HUD_STYLES', 'GP_HUD_PRESETS',
    'GP_HUD_MAP_STYLES', 'GP_HUD_BUNDLE_NAME'];
const FNS = ['gpHudOn', 'gpCamLoad', 'gpCamPut', 'gpCamSet', 'gpHudLayout', 'gpHudPlaceOf',
             'gpHudPlace', 'gpHudOrder', 'gpHudEdStore', 'gpHudEdSet', 'gpHudEdHit',
             'gpHudEdSize', 'gpHudEdOrderNow', 'gpHudEdMove', 'gpHudEdLocked', 'gpHudEdLock',
             'gpHudEdCanDrag', 'gpHudChanList', 'gpHudChanById', 'gpHudChanAt',
             'gpHudAdds', 'gpHudAddById', 'gpHudWidgetList', 'gpHudMadeBox',
             'gpHudTrackShape', 'gpHudMadeType', 'gpHudMadeDef', 'gpHudMadeNeeds', 'gpHudDrawMade', 'gpHudMadeVal', 'gpHudMadeLo', 'gpHudMadeHi', 'gpHudMadeLit', 'gpHudMadeText', 'gpHudMadeUnit', 'gpHudMadeCap',
             'gpHudEdAdd', 'gpHudEdEdit', 'gpHudEdDelete', 'gpHudDashPlan',
             'gpHudNorm', 'gpHudWords', 'gpHudMatchChan',
             'gpHudDashName',
             'gpHudStyle', 'gpHudEdStyle', 'gpHudEdPreset',
             'gpHudUntouched', 'gpHudEdSugDone',
             'gpHudBundlePayload', 'gpHudBundleEntry', 'gpHudBundleTake',
             'gpHudMapStyle'];
const parts = [], missing = [];
for (const v of VARS) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

function env(opt) {
    opt = opt || {};
    const store = { v: opt.ls === undefined ? null : opt.ls };
    const shim = `
        var gp = { cam: null, playIdx: 0, trace: [{}], video: null };
        var LS = {
            getItem: function (k) { return ARGstore.v; },
            setItem: function (k, v) { ARGstore.v = v; ARGstore.writes = (ARGstore.writes||0)+1; }
        };
        var window = { localStorage: LS };
        var VIDEO = ARGvideo;
        var document = { getElementById: function (id) {
            return id === 'gpVideo' ? VIDEO : null; } };
        function gpVideoDrawOverlay() { PAINTS++; }
        function gpHudEdDraw() { DRAWS++; }
        /* gpCamSet re-renders the Setup rail after every toggle — irrelevant
           here, but a preset turns eight widgets on and off in a row and
           without this the whole thing dies on the first one. */
        function gpRenderSetup() { SETUPS++; }
        var PAINTS = 0, DRAWS = 0, SETUPS = 0;
        var GP_HUD_ED = ARGed;
        var CONFIRM = ARGconfirm;
        function gpConfirm(msg) { LOGC.push(msg); return Promise.resolve(CONFIRM); }
        var LOGC = [];
        var TextEncoder = ARGte, TextDecoder = ARGtd;
        ${parts.join('\n')}
        return {
            gp: gp, load: gpCamLoad, put: gpCamPut, set: gpCamSet, on: gpHudOn,
            layout: gpHudLayout, placeOf: gpHudPlaceOf, place: gpHudPlace,
            edStore: gpHudEdStore, edSet: gpHudEdSet, hit: gpHudEdHit, size: gpHudEdSize,
            order: gpHudOrder, orderNow: gpHudEdOrderNow, move: gpHudEdMove,
            locked: gpHudEdLocked, lock: gpHudEdLock, widgets: GP_HUD_WIDGETS,
            canDrag: gpHudEdCanDrag, chanList: gpHudChanList,
            add: gpHudEdAdd, edit: gpHudEdEdit, del: gpHudEdDelete,
            dashPlan: gpHudDashPlan, match: gpHudMatchChan,
            adds: gpHudAdds, addById: gpHudAddById, widgetList: gpHudWidgetList,
            madeBox: gpHudMadeBox,
            styleOf: gpHudStyle, edStyle: gpHudEdStyle, preset: gpHudEdPreset,
            hudStyles: GP_HUD_STYLES, presets: GP_HUD_PRESETS,
            untouched: gpHudUntouched, sugDone: gpHudEdSugDone,
            payload: gpHudBundlePayload, entry: gpHudBundleEntry, take: gpHudBundleTake,
            asked: function () { return LOGC; },
            stored: function () { return ARGstore.v; },
            counts: function () { return { paints: PAINTS, draws: DRAWS }; }
        };
    `;
    return new Function('ARGstore', 'ARGed', 'ARGvideo', 'ARGconfirm', 'ARGte', 'ARGtd', shim)(
        store, opt.ed || { sel: null, rects: [], frame: 'land' }, opt.video || null,
        opt.confirm === undefined ? true : opt.confirm, TextEncoder, TextDecoder);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

/* ══ the store survives a reload ══════════════════════════════════════════ */
console.log('a layout that is saved comes back');
{
    /* gpCamLoad copies key by key — it does NOT merge. Every setting it does
       not name by hand is dropped on the next page load, and a layout that
       silently forgets itself every reload is worse than no editor at all.
       This is the check that exists because that trap was written down
       before the code was. */
    const E = env();
    E.gp.cam = E.load();
    E.edSet('hudSpeed', { dx: 40, dy: -12, k: 1.25 });
    const raw = E.stored();
    ok('the layout reaches localStorage', /"hud"/.test(raw), raw && raw.slice(0, 90));

    const F = env({ ls: raw });
    const back = F.load();
    ok('…and gpCamLoad brings it back', !!(back.hud && back.hud.w && back.hud.w.hudSpeed),
       JSON.stringify(back.hud));
    F.gp.cam = back;
    const p = F.placeOf('hudSpeed');
    ok('every field survives the round trip',
       p.dx === 40 && p.dy === -12 && near(p.k, 1.25), JSON.stringify(p));
    ok('the other camera settings are still there too',
       back.overlay === true && back.follow === true);
}
{
    /* And the settings that were already there are not trampled by it. */
    const E = env({ ls: JSON.stringify({ auto: false, muted: true, hudDelta: false,
                                         hudMapStyle: 'satdim' }) });
    E.gp.cam = E.load();
    E.edSet('hudMap', { dx: 5 });
    const back = env({ ls: E.stored() }).load();
    ok('a saved layout does not disturb the ground choice',
       back.hudMapStyle === 'satdim', back.hudMapStyle);
    ok('…nor a widget someone had switched off',
       back.hudDelta === false, String(back.hudDelta));
    ok('…nor the mute preference', back.muted === true);
}

/* ══ absent means factory ═════════════════════════════════════════════════ */
console.log('\nabsent means factory, per widget and per field');
{
    const E = env();
    E.gp.cam = E.load();
    const p = E.placeOf('hudSpeed');
    ok('a widget nobody has touched sits where it belongs',
       p.dx === 0 && p.dy === 0 && p.k === 1, JSON.stringify(p));

    E.gp.cam.hud = { v: 1, w: { hudSpeed: { dx: 12 } } };
    const q = E.placeOf('hudSpeed');
    ok('a half-written entry fills the rest in from the factory',
       q.dx === 12 && q.dy === 0 && q.k === 1, JSON.stringify(q));

    /* A widget that did not exist when this layout was saved must come up
       where it belongs, not at the origin — the same rule gpHudOn follows
       for visibility, and for the same reason. */
    const r = E.placeOf('hudSomethingNew');
    ok('a widget added in a later version comes up at its default',
       r.dx === 0 && r.dy === 0 && r.k === 1);
}
{
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = { v: 1, w: { hudMap: { dx: 'nonsense', dy: NaN, k: 0 } } };
    const p = E.placeOf('hudMap');
    ok('rubbish in the store cannot move or shrink anything',
       p.dx === 0 && p.dy === 0 && p.k === 1, JSON.stringify(p));
    E.gp.cam.hud = { v: 1, w: { hudMap: { k: -2 } } };
    ok('…including a negative size, which would mirror the widget',
       E.placeOf('hudMap').k === 1);
}
{
    /* Back at the defaults, the entry goes away. The stored object should
       say what has been CHANGED; a file full of zeroes is the same layout
       described badly, and it is what would freeze a widget in place if the
       defaults were ever improved. */
    const E = env();
    E.gp.cam = E.load();
    E.edSet('hudG', { dx: 9 });
    ok('a moved widget is written down', !!E.edStore().w.hudG);
    E.edSet('hudG', { dx: 0, dy: 0, k: 1 });
    ok('a widget put back drops out of the store entirely',
       E.edStore().w.hudG === undefined, JSON.stringify(E.edStore().w));
}

/* ══ the arithmetic ═══════════════════════════════════════════════════════ */
console.log('\nthe offsets mean the same thing at every size');
{
    /* The reason dx/dy are in S units and not pixels. A layout laid out on a
       600 px tile has to land in the same PROPORTIONAL place in a 4K export,
       or the editor is showing something the exported file will not agree
       with — which is the one failure this whole design exists to avoid. */
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = { v: 1, w: { hudSpeed: { dx: 30, dy: -10 } } };
    const run = (S) => {
        const out = [];
        const g = { save() {}, restore() {}, translate(x, y) { out.push(['t', x, y]); },
                    scale(a, b) { out.push(['s', a, b]); } };
        const rects = [];
        E.place(g, 'hudSpeed', S, { x: 100, y: 200, w: 80, h: 40 }, rects, function () {});
        return { calls: out, rect: rects[0] };
    };
    const a = run(1), b = run(3);
    ok('a nudge is scaled by S on the way to the canvas',
       near(b.rect.x - 100, (a.rect.x - 100) * 3) &&
       near(b.rect.y - 200, (a.rect.y - 200) * 3),
       (b.rect.x - 100) + ' vs ' + (a.rect.x - 100));
    ok('at S=1 the nudge is exactly the stored number',
       near(a.rect.x, 130) && near(a.rect.y, 190), a.rect.x + ',' + a.rect.y);
}
{
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = { v: 1, w: { hudMap: { k: 1.5 } } };
    const rects = [], seen = [];
    const g = { save() { seen.push('save'); }, restore() { seen.push('restore'); },
                translate(x, y) { seen.push(['t', x, y]); }, scale(a) { seen.push(['s', a]); } };
    E.place(g, 'hudMap', 1, { x: 100, y: 100, w: 200, h: 200 }, rects, function () {});
    const r = rects[0];
    ok('a resize keeps the widget\'s centre where it was',
       near(r.x + r.w / 2, 200) && near(r.y + r.h / 2, 200),
       (r.x + r.w / 2) + ',' + (r.y + r.h / 2));
    ok('…and the rectangle grows by the factor', near(r.w, 300) && near(r.h, 300));
    ok('the canvas is saved and restored around it',
       seen[0] === 'save' && seen[seen.length - 1] === 'restore', JSON.stringify(seen));
}
{
    /* The rectangle the editor hit-tests and outlines is computed by hand,
       while the drawing goes through the CANVAS transform. Nothing forces
       those two to agree, and if they drift the selection box sits somewhere
       the widget is not — the editor lying about its own subject. So: push
       the default box through the transform that was actually issued, and
       insist it lands on the reported rectangle.

       This check exists because a mutation that scaled about the ORIGIN
       instead of the widget's centre passed every other check in this file. */
    const through = (cfg, box, S) => {
        const E = env();
        E.gp.cam = E.load();
        E.gp.cam.hud = { v: 1, w: { hudSpeed: cfg } };
        /* a 2x3 affine, applied the way canvas applies it */
        let m = [1, 0, 0, 1, 0, 0];
        const mul = (n) => {
            m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
                 m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
                 m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
        };
        const g = { save() {}, restore() {},
                    translate(x, y) { mul([1, 0, 0, 1, x, y]); },
                    scale(a2, b2) { mul([a2, 0, 0, b2, 0, 0]); } };
        const rects = [];
        E.place(g, 'hudSpeed', S, box, rects, function () {});
        const pt = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        const tl = pt(box.x, box.y), br = pt(box.x + box.w, box.y + box.h);
        return { drawn: { x: tl[0], y: tl[1], w: br[0] - tl[0], h: br[1] - tl[1] },
                 said: rects[0] };
    };
    const cases = [
        ['a plain nudge', { dx: 20, dy: -8 }, 1],
        ['a nudge at 4K scale', { dx: 20, dy: -8 }, 3],
        ['a resize', { k: 1.5 }, 1],
        ['both at once', { dx: -30, dy: 14, k: 0.75 }, 2]
    ];
    cases.forEach(([what, cfg, S]) => {
        const r = through(cfg, { x: 100, y: 200, w: 80, h: 40 }, S);
        ok('the rectangle matches where the canvas actually draws — ' + what,
           near(r.drawn.x, r.said.x, 1e-6) && near(r.drawn.y, r.said.y, 1e-6) &&
           near(r.drawn.w, r.said.w, 1e-6) && near(r.drawn.h, r.said.h, 1e-6),
           JSON.stringify(r));
    });
}
{
    /* Nothing at all should happen to a widget nobody moved: no save, no
       transform, no restore. It is what makes the refactor free. */
    const E = env();
    E.gp.cam = E.load();
    const seen = [];
    const g = { save() { seen.push('save'); }, restore() { seen.push('restore'); },
                translate() { seen.push('t'); }, scale() { seen.push('s'); } };
    let drew = 0;
    E.place(g, 'hudSpeed', 1, { x: 0, y: 0, w: 10, h: 10 }, null, function () { drew++; });
    ok('an untouched widget is drawn with no transform at all',
       seen.length === 0 && drew === 1, JSON.stringify(seen));
}

/* ══ hit-testing ══════════════════════════════════════════════════════════ */
console.log('\nclicking the picture picks the right widget');
{
    const rects = [
        { key: 'hudMap', x: 100, y: 100, w: 200, h: 200 },
        { key: 'hudG', x: 250, y: 60, w: 100, h: 100 }   /* drawn later, on top */
    ];
    const E = env({ ed: { sel: null, rects: rects, frame: 'land' } });
    ok('a click inside one widget finds it', E.hit(150, 150) === 'hudMap');
    ok('a click on empty picture finds nothing', E.hit(20, 20) === null);
    ok('where two overlap, the one drawn ON TOP wins',
       E.hit(270, 120) === 'hudG', String(E.hit(270, 120)));
    ok('the edges count — a widget is not a target you can miss by a pixel',
       E.hit(100, 100) === 'hudMap' && E.hit(300, 300) === 'hudMap');
    ok('just outside does not', E.hit(99, 100) === null);
}

/* ══ a widget dragged out of sight ════════════════════════════════════════ */
console.log('\na widget can leave the picture, and must stay recoverable');
{
    /* Nothing stops a drag from carrying a widget off the edge, and nothing
       should — but once it is gone there is nothing left in the picture to
       click on, so the LIST has to say where it went. This is the arithmetic
       that decides that. */
    const gone = (r, W, H) => r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= W || r.y >= H;
    ok('a widget inside the frame is not reported gone',
       !gone({ x: 100, y: 100, w: 50, h: 50 }, 800, 600));
    ok('one hanging half off the edge is still there to grab',
       !gone({ x: -20, y: 100, w: 50, h: 50 }, 800, 600));
    ok('one entirely past the left edge is gone',
       gone({ x: -60, y: 100, w: 50, h: 50 }, 800, 600));
    ok('…and past the right edge', gone({ x: 800, y: 100, w: 50, h: 50 }, 800, 600));
    ok('…and off the top', gone({ x: 100, y: -50, w: 50, h: 50 }, 800, 600));
    ok('…and off the bottom', gone({ x: 100, y: 600, w: 50, h: 50 }, 800, 600));
}
{
    /* And it can always be put back, whatever it was dragged to. */
    const E = env();
    E.gp.cam = E.load();
    E.edSet('hudMap', { dx: -9999, dy: 4321, k: 0.5 });
    E.edSet('hudMap', { dx: 0, dy: 0, k: 1 });
    const p = E.placeOf('hudMap');
    ok('putting one back works from anywhere',
       p.dx === 0 && p.dy === 0 && p.k === 1 && E.edStore().w.hudMap === undefined);
}

/* ══ layer order ═════════════════════════════════════════════ */
console.log('\nlayers decide what covers what, and nothing else');
{
    /* The plan arrives in FLOW order — the order the layout works itself out
       in, which is the order the HUD has always drawn in. The Layers panel
       reorders the PAINTING, and must not move anything: the flow decides
       where a widget belongs, the layer order decides what is on top. */
    const flow = ['hudPedals', 'hudSpeed', 'hudTacho', 'hudMap', 'hudG', 'hudDelta', 'hudMark'];
    const plan = flow.map(k => ({ key: k }));
    const keys = (E) => E.order(plan).map(w => w.key);

    {
        const E = env();
        E.gp.cam = E.load();
        ok('no stored order at all leaves the flow order alone',
           keys(E).join() === flow.join(), keys(E).join());
        E.gp.cam.hud = { v: 1, w: {}, z: [] };
        ok('an empty stored order does too', keys(E).join() === flow.join());
    }
    {
        const E = env();
        E.gp.cam = E.load();
        E.gp.cam.hud = { v: 1, w: {}, z: ['hudMark', 'hudMap', 'hudPedals', 'hudSpeed',
                                          'hudTacho', 'hudG', 'hudDelta'] };
        ok('a stored order is obeyed',
           keys(E).join() === 'hudMark,hudMap,hudPedals,hudSpeed,hudTacho,hudG,hudDelta',
           keys(E).join());
        ok('…and the LAST one in the list is painted last, so it is on top',
           keys(E)[keys(E).length - 1] === 'hudDelta');
    }
    {
        /* The rule that keeps a later version working: a widget the stored
           order has never heard of must not jump to the front or vanish. */
        const E = env();
        E.gp.cam = E.load();
        E.gp.cam.hud = { v: 1, w: {}, z: ['hudMap', 'hudSpeed'] };
        const got = keys(E);
        ok('a widget missing from the stored order is still painted',
           got.length === flow.length && flow.every(k => got.indexOf(k) >= 0), got.join());
        /* The exact result, not a property of it. The obvious comparator here
           (stored rank, falling back to flow position) is NOT transitive, and
           a non-transitive comparator lets Array.prototype.sort return
           whatever it likes — so the order is built explicitly instead, and
           this pins the build. */
        ok('…the named ones lead, in the order named',
           got.slice(0, 2).join() === 'hudMap,hudSpeed', got.join());
        ok('…and the rest follow in flow order',
           got.slice(2).join() === flow.filter(k => k !== 'hudMap' && k !== 'hudSpeed').join(),
           got.join());
        ok('…so a widget the order has never heard of lands ON TOP, not lost',
           got[got.length - 1] === 'hudMark', got.join());
    }
    {
        const E = env();
        E.gp.cam = E.load();
        E.gp.cam.hud = { v: 1, w: {}, z: ['nonsense', 'alsoNotAWidget'] };
        ok('an order naming only widgets that do not exist changes nothing',
           keys(E).join() === flow.join(), keys(E).join());
    }
    {
        /* Reordering is not moving. The boxes must be untouched by it. */
        const E = env();
        E.gp.cam = E.load();
        E.gp.cam.hud = { v: 1, w: {}, z: ['hudMark', 'hudMap'] };
        const rects = [];
        E.place({ save() {}, restore() {}, translate() {}, scale() {} },
                'hudMap', 1, { x: 10, y: 20, w: 30, h: 40 }, rects, function () {});
        ok('a reordered widget is still exactly where it was',
           rects[0].x === 10 && rects[0].y === 20 && rects[0].w === 30 && rects[0].h === 40,
           JSON.stringify(rects[0]));
    }
}

/* ══ the Layers panel's own controls ═══════════════════════════ */
console.log('\nreordering and locking behave like the dash editor');
{
    const flowKeys = () => env().widgets.map(w => w[0]);
    {
        const E = env();
        E.gp.cam = E.load();
        ok('with nothing stored, the order IS the flow order',
           E.orderNow().join() === flowKeys().join(), E.orderNow().join());
    }
    {
        /* One nudge writes the WHOLE order down, so later moves have a
           complete list to rearrange rather than a partial one. */
        const E = env();
        E.gp.cam = E.load();
        E.move('hudMark', -1);
        const z = E.edStore().z;
        ok('the first move records the complete order',
           !!z && z.length === flowKeys().length, z ? z.length : 'none');
        ok('…with the moved widget one place earlier',
           z.indexOf('hudMark') === flowKeys().indexOf('hudMark') - 1,
           z.join());
    }
    {
        const E = env();
        E.gp.cam = E.load();
        const last = flowKeys()[flowKeys().length - 1];
        E.move(last, 1);
        ok('the topmost widget cannot be pushed past the top',
           E.orderNow()[E.orderNow().length - 1] === last, E.orderNow().join());
        const first = flowKeys()[0];
        E.move(first, -1);
        ok('…nor the bottom one below the bottom', E.orderNow()[0] === first);
    }
    {
        const E = env();
        E.gp.cam = E.load();
        E.move('nonsenseWidget', 1);
        ok('moving something that is not a widget does nothing',
           !E.edStore().z, JSON.stringify(E.edStore().z));
    }
    {
        /* Reordering must never MOVE anything — that is the whole contract
           between the flow and the layer order. */
        const E = env();
        E.gp.cam = E.load();
        E.edSet('hudMap', { dx: 25, dy: -5, k: 1.4 });
        const before = JSON.stringify(E.placeOf('hudMap'));
        E.move('hudMap', -1);
        E.move('hudMap', -1);
        ok('a reordered widget keeps its position and size exactly',
           JSON.stringify(E.placeOf('hudMap')) === before, before);
    }
    {
        const E = env();
        E.gp.cam = E.load();
        ok('nothing is locked to begin with', !E.locked('hudSpeed'));
        E.lock('hudSpeed');
        ok('locking one is remembered', E.locked('hudSpeed'));
        ok('…and written to the store',
           !!(E.edStore().lock && E.edStore().lock.hudSpeed));
        ok('…without locking anything else', !E.locked('hudMap'));
        ok('a locked widget refuses to be dragged', !E.canDrag('hudSpeed'));
        ok('…while its neighbours still drag', E.canDrag('hudMap'));
        ok('nothing at all is not draggable either', !E.canDrag(null));
        E.lock('hudSpeed');
        ok('unlocking releases it', !E.locked('hudSpeed'));
        ok('…and it can be dragged again', E.canDrag('hudSpeed'));
    }
    {
        /* Reset all clears the layout, the order AND the locks — otherwise
           "put everything back" leaves a widget pinned and a stacking order
           nobody can see the effect of. */
        const E = env();
        E.gp.cam = E.load();
        E.edSet('hudMap', { dx: 9 });
        E.move('hudMark', -1);
        E.lock('hudG');
        const st = E.edStore();
        st.w = {}; delete st.z; delete st.lock;
        E.put('hud', st);
        ok('reset all clears positions, order and locks',
           Object.keys(E.edStore().w).length === 0 && !E.edStore().z && !E.edStore().lock,
           JSON.stringify(E.edStore()));
        ok('…and the order falls back to the flow',
           E.orderNow().join() === flowKeys().join());
    }
}

/* ══ bringing a dash layout across ══════════════════════════════ */
console.log('\na dash layout brings its CHOICES across, not its geometry');
{
    /* 800x480 of fixed hardware and a portrait video with the road as the
       subject are not the same picture. What carries is which numbers the
       driver chose, what they called them and what range they set. */
    const chans = [
        { id: 'ecu:rpm',  name: 'Engine RPM',    unit: 'rpm', dp: 0, lo: 800, hi: 7200 },
        { id: 'ecu:clt',  name: 'Coolant temp',  unit: '°C',  dp: 0, lo: 60,  hi: 104 },
        { id: 'ecu:thr',  name: 'Throttle',      unit: '%',   dp: 0, lo: 0,   hi: 100 }
    ];
    const layout = {
        name: 'race', signals: [
            { name: 'ENGINE_RPM', unit: 'rpm' },
            { name: 'COOLANT_TEMP', unit: 'C' },
            { name: 'OIL_PRESSURE', unit: 'kPa' }
        ],
        widgets: [
            { type: 'text', signal: 'ENGINE_RPM', config: { label: 'REVS' } },
            { type: 'bar', signal: 'COOLANT_TEMP', config: { min: 70, max: 110 } },
            { type: 'text', signal: 'OIL_PRESSURE', config: {} },
            { type: 'panel', config: {} },
            { type: 'text', signal: 'ENGINE_RPM', config: { label: 'again' } }
        ]
    };
    const plan = env().dashPlan(layout, chans);
    ok('a channel-bound gauge comes across', plan.made.length === 2,
       plan.made.length + ' made');
    ok('…matched by name through the shouting and the underscores',
       plan.made[0].chan === 'ecu:rpm', plan.made[0].chan);
    ok('…keeping the name the dash gave it', plan.made[0].label === 'REVS', plan.made[0].label);
    ok('a dash BAR becomes a bar', plan.made[1].type === 'bar', plan.made[1].type);
    ok('…and its caption is not taken from the widget that had none',
       !!plan.made[1].label, plan.made[1].label);
    /* One for one, since ADR-0051. This used to collapse everything to "bar"
       or "value" because those were the only two shapes the overlay had; the
       thirteen shared types are the vocabulary now, and a dash text gauge
       becomes the overlay's own text gauge. */
    ok('…and a text gauge becomes a text gauge, not a flattened one',
       plan.made[0].type === 'text', plan.made[0].type);
    ok('…with the range the DASH was set to, not the recording\'s',
       plan.made[1].lo === 70 && plan.made[1].hi === 110,
       plan.made[1].lo + '-' + plan.made[1].hi);
    ok('a widget bound to nothing is skipped, not guessed at',
       !plan.made.some(m => !m.chan));
    ok('the same channel twice makes ONE widget',
       plan.made.filter(m => m.chan === 'ecu:rpm').length === 1);
    ok('a gauge this recording cannot feed is REPORTED, not invented',
       plan.missed.length === 1 && /OIL/i.test(plan.missed[0]), plan.missed.join());
    ok('…and never silently bound to the wrong channel',
       !plan.made.some(m => /OIL/i.test(m.label)));
}
{
    /* A layout usually shows the same number twice — a panel with the
       reading and a bar beside it. Taking whichever came first in the file
       turned his real coolant and throttle BARS into plain readouts. The bar
       carries a range, so the bar is the richer answer and wins however the
       file happens to be ordered. */
    const chans = [{ id: 'ecu:clt', name: 'Coolant Temp', unit: '\u00b0C', dp: 0, lo: 60, hi: 104 }];
    const layout = {
        signals: [{ name: 'COOLANT_TEMP', unit: 'C' }],
        widgets: [
            { type: 'panel', signal: 'COOLANT_TEMP', config: { label: 'COOLANT' } },
            { type: 'bar', signal: 'COOLANT_TEMP', config: { min: 70, max: 110 } }
        ]
    };
    const plan = env().dashPlan(layout, chans);
    ok('a signal shown as BOTH a panel and a bar comes across as the bar',
       plan.made.length === 1 && plan.made[0].type === 'bar',
       JSON.stringify(plan.made));
    ok('…keeping the caption the panel carried',
       plan.made[0].label === 'COOLANT', plan.made[0].label);
    ok('…and the range the bar was set to',
       plan.made[0].lo === 70 && plan.made[0].hi === 110,
       plan.made[0].lo + '-' + plan.made[0].hi);
    /* order in the file must not decide it */
    const flipped = env().dashPlan({ signals: layout.signals,
        widgets: [layout.widgets[1], layout.widgets[0]] }, chans);
    ok('…whichever order the file lists them in',
       flipped.made.length === 1 && flipped.made[0].type === 'bar' &&
       flipped.made[0].label === 'COOLANT', JSON.stringify(flipped.made));
}
{
    /* Names have to survive two conventions without ever binding a gauge to
       the wrong number. Measured against his real layout: INTAKE_AIR_TEMP
       had to reach a column called "Intake Temp", and OIL_TEMP must never
       reach "Coolant Temp". */
    const E = env();
    const chans = [
        { id: 'a', name: 'Intake Temp' }, { id: 'b', name: 'Coolant Temp' },
        { id: 'c', name: 'Engine RPM' }, { id: 'd', name: 'Oil Pressure' }
    ];
    const m = (w) => { const h = E.match(w, chans); return h ? h.id : null; };
    ok('an exact name matches', m('Engine RPM') === 'c');
    ok('shouting and underscores match', m('ENGINE RPM') === 'c');
    ok('a longer dash name reaches a shorter column',
       m('INTAKE AIR TEMP') === 'a', String(m('INTAKE AIR TEMP')));
    ok('…and does not wander onto a different temperature',
       m('OIL TEMP') !== 'b', String(m('OIL TEMP')));
    ok('a name nothing carries matches nothing', m('BOOST PRESSURE') === null);
    ok('an empty name matches nothing', m('') === null);
}
{
    const empty = env().dashPlan({ widgets: [], signals: [] }, [{ id: 'a', name: 'A', lo: 0, hi: 1, dp: 0, unit: '' }]);
    ok('an empty layout brings nothing across and says nothing went wrong',
       empty.made.length === 0 && empty.missed.length === 0);
    ok('a layout that is not there at all is handled',
       env().dashPlan(null, []).made.length === 0);
}

/* ══ the store fills gaps, it does not replace ══════════════════ */
console.log('\nreading the store never destroys what is in it');
{
    /* This was a real bug, found by driving the editor rather than by any
       check here: gpHudEdStore replaced the whole object whenever the
       positions map was absent, which threw away the widget list, the layer
       order and the locks. A layout with widgets in it but nothing moved yet
       is exactly that shape. */
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = { v: 1, seq: 2,
                     add: [{ id: 'w1', type: 'value', chan: 'x', label: 'Oil' },
                           { id: 'w2', type: 'bar', chan: 'y', label: 'Water' }],
                     z: ['w2', 'w1'], lock: { w1: 1 } };
    const st = E.edStore();
    ok('a store with no positions map keeps its widgets',
       (st.add || []).length === 2, JSON.stringify(st.add));
    ok('…its layer order', (st.z || []).join() === 'w2,w1', JSON.stringify(st.z));
    ok('…its locks', !!(st.lock && st.lock.w1), JSON.stringify(st.lock));
    ok('…and gains the positions map it was missing',
       st.w && typeof st.w === 'object', JSON.stringify(st.w));
    ok('the widget list still sees them',
       E.widgetList().filter(w => w[0] === 'w1' || w[0] === 'w2').length === 2);
}
{
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = { add: [{ id: 'w1', type: 'value' }] };   /* no v, no w */
    const st = E.edStore();
    ok('a half-written store is completed, not discarded',
       st.v === 1 && !!st.w && (st.add || []).length === 1, JSON.stringify(st));
}
{
    const E = env();
    E.gp.cam = E.load();
    E.gp.cam.hud = "not an object";
    const st = E.edStore();
    ok('rubbish in place of a store is replaced with an empty one',
       st && typeof st === 'object' && !!st.w, JSON.stringify(st));
}

/* ══ made widgets in the store ═════════════════════════════════ */
console.log('\nmaking, editing and deleting a widget');
{
    {
        const E = env();
        E.gp.cam = E.load();
        const id = E.add('value');
        ok('making one returns an id', !!id, String(id));
        ok('…and it is in the store', !!E.addById(id));
        ok('…and in the widget list', E.widgetList().some(w => w[0] === id));
        const id2 = E.add('bar');
        ok('two made in a row get different ids', id2 !== id, id + ' / ' + id2);
        /* The one that matters: an id keys the position, the lock and the
           layer order, so handing a NEW widget the id of a deleted one hands
           it the dead one's place as well. Counting the list length instead
           of keeping a counter does exactly that, and only after a delete. */
        E.del(id);
        const id3 = E.add('value');
        ok('…and an id is never reused after a delete',
           id3 !== id && id3 !== id2, [id, id2, id3].join(' / '));
    }
    {
        const E = env();
        E.gp.cam = E.load();
        const id = E.add('value');
        E.edit(id, { label: 'Oil', dp: 2 });
        ok('editing sticks', E.addById(id).label === 'Oil' && E.addById(id).dp === 2);
    }
    {
        /* Deleting must take EVERYTHING keyed off the id with it. A stale
           position or lock is invisible until an id is reused, which is
           exactly when it is hardest to explain. */
        const E = env();
        E.gp.cam = E.load();
        const id = E.add('value');
        E.edSet(id, { dx: 12 });
        E.lock(id);
        E.move(id, -1);
        E.del(id);
        const st = E.edStore();
        ok('deleting removes the widget', !E.addById(id));
        ok('…its position', !(st.w && st.w[id]), JSON.stringify(st.w));
        ok('…its lock', !(st.lock && st.lock[id]), JSON.stringify(st.lock));
        ok('…and its place in the layer order',
           !(st.z && st.z.indexOf(id) >= 0), JSON.stringify(st.z));
    }
    {
        const E = env();
        E.gp.cam = E.load();
        const id = E.add('value');
        const raw = E.stored();
        const F = env({ ls: raw });
        F.gp.cam = F.load();
        ok('a made widget survives a reload', !!F.addById(id), raw.slice(0, 80));
    }
}

/* ══ the stage ════════════════════════════════════════════════════════════ */
console.log('\nthe stage is shaped like the footage, not like a monitor');
{
    /* His footage is 1216x1616 portrait. An overlay laid out on a landscape
       stage and then burned into a portrait video is exactly how the HUD came
       to hang off the side of a picture the first time. */
    const E = env({ video: { videoWidth: 1216, videoHeight: 1616, readyState: 4 },
                    ed: { frame: 'video', rects: [] } });
    const s = E.size();
    ok('with footage open the stage takes the footage\'s shape',
       near(s[0] / s[1], 1216 / 1616, 1e-3), s.join('x'));
    ok('…scaled down to something a screen can hold', Math.max(s[0], s[1]) <= 1000, s.join('x'));

    const P = env({ ed: { frame: 'port', rects: [] } });
    ok('portrait is offered even with no footage', P.size()[1] > P.size()[0], P.size().join('x'));
    const L = env({ ed: { frame: 'land', rects: [] } });
    ok('and landscape', L.size()[0] > L.size()[1], L.size().join('x'));
}

/* ══ the editor repaints what it changed ══════════════════════════════════ */
console.log('\nchanging something changes the picture behind it too');
{
    const E = env();
    E.gp.cam = E.load();
    E.edSet('hudSpeed', { dx: 3 });
    const c = E.counts();
    ok('the editor redraws its own stage', c.draws >= 1, JSON.stringify(c));
    ok('…and the video tile underneath, so the two never disagree',
       c.paints >= 1, JSON.stringify(c));
}

/* ══ style variants, and the presets that set them ════════════════════════ */
console.log('\na style is stored like a nudge: only when it is not the factory one');
{
    const E = env();
    E.gp.cam = E.load();
    ok('nothing stored means every widget is factory',
       Object.keys(E.hudStyles).every(k => E.styleOf(k) === E.hudStyles[k][0][0]));

    E.edStyle('hudAngle', 'dial');
    const raw = E.stored();
    ok('a chosen style reaches localStorage', /"dial"/.test(raw), raw && raw.slice(0, 120));

    /* The trap this whole file exists for. `st` lives INSIDE hud, which
       gpCamLoad carries as one object — put it beside hud on gp.cam and it
       would be dropped on the next load with nothing to show for it. */
    const F = env({ ls: raw });
    F.gp.cam = F.load();
    ok('…and gpCamLoad brings it back', F.styleOf('hudAngle') === 'dial');

    F.edStyle('hudAngle', 'panel');
    const back = env({ ls: F.stored() });
    back.gp.cam = back.load();
    ok('picking the factory style stores nothing rather than storing "panel"',
       !/"panel"/.test(back.stored()), back.stored().slice(0, 140));
    ok('…and it still reads as the factory style', back.styleOf('hudAngle') === 'panel');

    /* A style is not a position. Choosing one must not disturb where the
       widget was put, or the two controls fight each other. */
    const G = env();
    G.gp.cam = G.load();
    G.edSet('hudAngle', { dx: 12, dy: -8, k: 1.5 });
    G.edStyle('hudAngle', 'bar');
    const gp2 = G.placeOf('hudAngle');
    ok('choosing a style leaves the nudge alone',
       gp2.dx === 12 && gp2.dy === -8 && near(gp2.k, 1.5), JSON.stringify(gp2));
}

console.log('\na preset sets the picture and touches nothing else');
{
    const E = env();
    E.gp.cam = E.load();
    /* Everything a preset must NOT disturb, set up first. */
    E.edSet('hudSpeed', { dx: 30, dy: -6, k: 1.4 });
    E.lock('hudMap', true);
    const madeId = E.add('bar');
    E.move('hudMap', -1);
    const orderBefore = E.orderNow().join(',');

    const drift = E.presets.findIndex(p => p[0] === 'Drift');
    ok('there is a Drift preset', drift >= 0);
    E.preset(drift);
    ok('it sets the styles it names',
       E.styleOf('hudAngle') === 'dial' && E.styleOf('hudG') === 'radar' &&
       E.styleOf('hudMark') === 'badge',
       [E.styleOf('hudAngle'), E.styleOf('hudG'), E.styleOf('hudMark')].join(','));
    ok('…switches on what it wants', E.on('hudSteer') && E.on('hudRun') && E.on('hudAngle'));
    ok('…and switches off what it does not',
       !E.on('hudTacho') && !E.on('hudPedals') && !E.on('hudDelta'));

    const p = E.placeOf('hudSpeed');
    ok('a preset leaves a widget you had moved where you put it',
       p.dx === 30 && p.dy === -6 && near(p.k, 1.4), JSON.stringify(p));
    ok('…leaves the layer order alone', E.orderNow().join(',') === orderBefore);
    ok('…leaves locks alone', E.locked('hudMap') === true);
    ok('…and does not delete a widget you made', !!E.addById(madeId));

    /* The reason gpHudEdPreset walks every styled widget rather than only the
       ones its own spec names: a dial left over from Drift coming through
       into Circuit would make the preset not a preset. */
    const circuit = E.presets.findIndex(p2 => p2[0] === 'Circuit');
    E.preset(circuit);
    ok('switching preset clears a style the previous one set',
       E.styleOf('hudAngle') === 'panel' && E.styleOf('hudG') === 'circle',
       [E.styleOf('hudAngle'), E.styleOf('hudG')].join(','));
    ok('…and switches the instruments back over',
       E.on('hudTacho') && E.on('hudDelta') && !E.on('hudSteer'));

    /* Every preset has to name a real widget and a real style, or it silently
       does half of what it says. */
    let bad = [];
    E.presets.forEach(pr => {
        Object.keys(pr[2].st || {}).forEach(k => {
            const list = E.hudStyles[k];
            if (!list || !list.some(s => s[0] === pr[2].st[k])) bad.push(pr[0] + ':' + k);
        });
        (pr[2].on || []).concat(pr[2].off || []).forEach(k => {
            if (!E.widgets.some(w => w[0] === k)) bad.push(pr[0] + ':' + k);
        });
    });
    ok('every preset names widgets and styles that exist', bad.length === 0, bad.join(' '));
    ok('…and no preset both shows and hides the same widget',
       E.presets.every(pr => !(pr[2].on || []).some(k => (pr[2].off || []).indexOf(k) >= 0)));
    ok('…and between them they account for every instrument',
       E.presets.every(pr => E.widgets.every(w =>
           (pr[2].on || []).indexOf(w[0]) >= 0 || (pr[2].off || []).indexOf(w[0]) >= 0)),
       'a preset that leaves one out lets the previous preset leak through');
}

console.log('\nthe suggestion is answered once, and stays answered');
{
    const E = env();
    E.gp.cam = E.load();
    ok('a fresh layout has not answered', E.untouched());

    E.sugDone();
    ok('…"No thanks" is an answer', !E.untouched());
    const raw = E.stored();
    ok('…and it reaches localStorage', /"sug"/.test(raw), raw && raw.slice(0, 120));

    const F = env({ ls: raw });
    F.gp.cam = F.load();
    ok('…and survives the reload, so the banner does not come back',
       !F.untouched());
}
{
    /* Taking the offer marks it answered too — by the flag the button sets
       and, independently, by the styles and visibility the preset writes.
       Either alone is enough; both is belt and braces. */
    const E = env();
    E.gp.cam = E.load();
    E.sugDone();
    E.preset(0);
    ok('taking the offer answers it', !E.untouched());
    ok('…and the flag survives the preset writing over the same store',
       /"sug"/.test(E.stored()), E.stored().slice(0, 160));

    /* And a preset picked from the list, with no banner involved, also ends
       the offer — otherwise it would return over a layout somebody chose. */
    const G = env();
    G.gp.cam = G.load();
    G.preset(1);
    ok('a preset chosen from the list ends the offer too', !G.untouched());
}

/* ══ the overlay travels in the .rdm bundle (ADR-0051) ════════════════════ */
console.log('\none file, two placements');
{
    const E = env();
    E.gp.cam = E.load();
    ok('a factory layout has nothing to put in a file', E.payload() === null);
    ok('…so no entry is appended', E.entry() === null);

    E.edSet('hudSpeed', { dx: 12, dy: -4, k: 1.5 });
    E.edStyle('hudAngle', 'dial');
    E.set('hudTacho', false);
    const p = E.payload();
    ok('a layout with something in it does', !!p);
    ok('…carrying the placements', !!(p.hud && p.hud.w && p.hud.w.hudSpeed));
    ok('…and the styles', p.hud.st && p.hud.st.hudAngle === 'dial');
    /* Absent means ON for a widget, so it is the switched-off ones that have
       to be written down — the whole list would be a state dump. */
    ok('…and the widgets switched OFF, because absent means on',
       p.off.indexOf('hudTacho') >= 0 && p.off.indexOf('hudSpeed') < 0,
       JSON.stringify(p.off));
    ok('…and the minimap ground, which lives beside hud and not inside it',
       typeof p.mapStyle === 'string', String(p.mapStyle));
}
{
    const E = env();
    E.gp.cam = E.load();
    E.edSet('hudMap', { dx: 3 });
    const e = E.entry();
    ok('the entry is type 4', e[0] === 4, String(e[0]));
    const nameLen = e[1];
    const name = new TextDecoder().decode(e.slice(2, 2 + nameLen));
    ok('…names itself', /overlay/.test(name), name);
    const dv = new DataView(e.buffer, e.byteOffset);
    const len = dv.getUint32(2 + nameLen, true);
    ok('…declares its own length, and that is the length',
       len === e.length - (2 + nameLen + 4), len + ' vs ' + (e.length - (2 + nameLen + 4)));
    const body = JSON.parse(new TextDecoder().decode(e.slice(2 + nameLen + 4)));
    ok('…and the body is the payload', !!(body.hud && body.hud.w.hudMap));
}
{
    /* Offered, never applied. */
    const src = env();
    src.gp.cam = src.load();
    src.edSet('hudG', { dx: 9, dy: 2, k: 0.8 });
    src.edStyle('hudG', 'radar');
    src.set('hudDelta', false);
    const e = src.entry();
    const body = e.slice(2 + e[1] + 4);

    const no = env({ confirm: false });
    no.gp.cam = no.load();
    no.take(body).then(function (took) {
        ok('turning the offer down changes nothing', took === false);
        ok('…and it did ask', no.asked().length === 1);
        ok('…leaving the layout alone', !no.layout() || !no.layout().hudG);

        const yes = env({ confirm: true });
        yes.gp.cam = yes.load();
        return yes.take(body).then(function (ok2) {
            ok('taking it applies the placement', ok2 === true);
            const q = yes.placeOf('hudG');
            ok('…every field of it', q.dx === 9 && q.dy === 2 && near(q.k, 0.8),
               JSON.stringify(q));
            ok('…the styles', yes.styleOf('hudG') === 'radar', yes.styleOf('hudG'));
            ok('…and the widgets that were switched off', yes.on('hudDelta') === false);
            ok('…while the ones that were not stay on', yes.on('hudSpeed') === true);
            /* Written through the setters, so gpCamLoad's key-by-key copy
               brings it back. Straight into localStorage it would evaporate. */
            const back = env({ ls: yes.stored() });
            back.gp.cam = back.load();
            ok('…and it survives a reload', back.placeOf('hudG').dx === 9,
               JSON.stringify(back.placeOf('hudG')));
            return rubbish();
        });
    });
}
function rubbish() {
    const E = env({ confirm: true });
    E.gp.cam = E.load();
    return E.take(new TextEncoder().encode('{ not json')).then(function (took) {
        ok('a bundle whose overlay will not parse is declined, not thrown',
           took === false);
        ok('…without even asking', E.asked().length === 0, String(E.asked().length));
        return E.take(new TextEncoder().encode('{"v":1}')).then(function (t2) {
            ok('…and neither is one with no layout in it', t2 === false);
            mapping();
        });
    });
}
function mapping() {
    /* One for one, now that there is a vocabulary to be one for one with. */
    console.log('\nthe dash importer stops collapsing');
    const E = env();
    const chans = [{ id: 'ecu:rpm', name: 'Engine RPM', unit: 'rpm', dp: 0, lo: 0, hi: 8000 }];
    const shared = E.hudStyles ? null : null;
    const types = ['panel', 'text', 'bar', 'rpm_bar', 'meter', 'shift_light',
                   'warning', 'indicator', 'banner', 'shape_panel', 'line', 'arc'];
    const wrong = [];
    types.forEach(function (t) {
        const plan = E.dashPlan({
            name: 'x', signals: [{ name: 'ENGINE_RPM', unit: 'rpm' }],
            widgets: [{ type: t, signal: 'ENGINE_RPM', config: {} }]
        }, chans);
        if (!plan.made.length || plan.made[0].type !== t) wrong.push(t + '->' +
            (plan.made[0] ? plan.made[0].type : 'nothing'));
    });
    ok('every shared type comes across as itself', wrong.length === 0, wrong.join(' '));

    /* The excluded ones have nothing here to become — pressable, or needing
       the device's own image store, or dash chrome. They still carry their
       reading rather than being dropped. */
    ['toggle', 'button', 'image', 'pathbar', 'anim'].forEach(function (t) {
        const plan = E.dashPlan({
            name: 'x', signals: [{ name: 'ENGINE_RPM', unit: 'rpm' }],
            widgets: [{ type: t, signal: 'ENGINE_RPM', config: {} }]
        }, chans);
        ok('a dash ' + t + ' still brings its reading across',
           plan.made.length === 1 && plan.made[0].chan === 'ecu:rpm',
           JSON.stringify(plan.made));
    });

    /* Ranges live under six key names across the dash widget set. */
    [['bar_min', 'bar_max'], ['min', 'max'], ['signal_min', 'signal_max'],
     ['range_min', 'range_max']].forEach(function (pair) {
        const cfg = {};
        cfg[pair[0]] = 11; cfg[pair[1]] = 99;
        const plan = E.dashPlan({
            name: 'x', signals: [{ name: 'ENGINE_RPM', unit: 'rpm' }],
            widgets: [{ type: 'bar', signal: 'ENGINE_RPM', config: cfg }]
        }, chans);
        ok('a range written as ' + pair[0] + '/' + pair[1] + ' is understood',
           plan.made[0].lo === 11 && plan.made[0].hi === 99,
           plan.made[0].lo + '-' + plan.made[0].hi);
    });

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
}
