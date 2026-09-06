/* The keypad boot sequence, run against a keypad that is not there.
 *
 * The engine's whole problem is that its output is thrown away twice before
 * anybody sees it. An effect renders in true RGB; a quantiser throws most of
 * that away to reach the seven colours a PKP ring can be; an encoder throws
 * the colours away again to reach twenty-four bits of a CAN frame. Every one
 * of those steps looks fine on screen while being wrong on the wire, because
 * the screen is fed from the step BEFORE the mistake.
 *
 * Three specific ways that goes wrong, all cheap and none visible by reading:
 *
 *   - the quantiser picking amber or lime, which the legend backlight can
 *     make and the rings cannot;
 *   - the LED frame's stride — one byte per colour up to eight keys, two
 *     above, keys 9-16 in the high byte — which is invisible on a 2x2 and
 *     scrambles a 3x5, and already made the exported DBC disagree with the
 *     setup file once;
 *   - the frame budget. The dash refuses more than two dozen frames a second,
 *     and an effect that dedupes badly earns that refusal mid-boot.
 *
 * And underneath: determinism. A boot is previewed, exported and streamed by
 * three separate code paths, and they are the same boot only if the frame at
 * t is a function of t. One Math.random() anywhere makes every assertion here
 * a coin toss, so that is checked against the source too.
 *
 * The product is a ROW OF STEPS — each an effect, a colour and a length —
 * then the keys settle. So the harness also plays every ready-made boot on
 * every keypad model from cold and checks the things a person would notice:
 * that each step finishes what it started inside its own time, that the
 * colour you pick is the colour that comes out, that a step's length and its
 * speed each do what the panel says they do, and that a boot saved in any of
 * the day's earlier shapes still loads.
 *
 * Runs the shipped code, pulled out of src/tauri-overlay.html, never copied.
 *
 *   node tools/check_lightshow.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}

/* ---- pull the real code out ------------------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1;
    while (SRC[i] === ' ') i++;
    const open = SRC[i];
    const close = open === '{' ? '}' : open === '[' ? ']' : null;
    if (!close) throw new Error('var ' + name + ' is not an object/array literal');
    let depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === open) depth++;
        else if (SRC[j] === close) { depth--; if (depth === 0) { j++; break; } }
    }
    return 'var ' + name + ' = ' + SRC.slice(i, j) + ';';
}
/* window.NAME = function ... }; — the page's public verbs are assigned, not
   declared, so grab() cannot see them. */
function grabWin(name) {
    const re = new RegExp('^        window\\.' + name + ' = (async )?function', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: window.' + name);
    let i = SRC.indexOf('{', m.index), depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return SRC.slice(m.index, j) + ';';
}
function line(re, what) {
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + what);
    return m[0];
}
function region(startMark, endMark) {
    const a = SRC.indexOf(startMark);
    if (a < 0) throw new Error('region start not found: ' + startMark);
    const b = SRC.indexOf(endMark, a);
    if (b < 0) throw new Error('region end not found: ' + endMark);
    return SRC.slice(a, b);
}

const SHOW = region('/* ══════════════ Lightshow', '\n        var kpRailBuilt = false;');
ok('the boot block is still where the harness looks for it', SHOW.length > 15000, SHOW.length + ' chars');
/* Read with block comments blanked out, keeping the line count, for the
   source-level checks: the engine's own comments EXPLAIN the rules, and a
   check that fails on its own explanation is a check nobody keeps. */
const SHOWCODE = SHOW.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/* ---- the sandbox ------------------------------------------------------ */
function build() {
    const win = {};
    const doc = {
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }),
        body: { appendChild() {} }
    };
    const sandbox = {
        window: win, document: doc, console,
        Math, JSON, Date, Object, Array, String, Number, parseInt, parseFloat, isFinite,
        requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
        performance: { now: () => 0 },
        setTimeout, clearTimeout, setInterval, clearInterval,
        showToast: () => {},
        kpw: { busy: false, cancel: false },
        kpwLinkState: () => 'offline',
        kpwTx: async () => ({ ok: true }), kpwSleep: async () => {},
        kpwTakeDash: async () => {}, kpwRestoreDash: async () => {},
        kpwDashRate: async () => ({ ok: true }), kpwRateIdx: () => 2,
        KPW_SETTLE_MS: 500,
        _wsDownload: (name, body, mime) => { sandbox.__saved = { name, body, mime }; },
        kpSaveCfg: () => {}, kpRenderStage: () => {}, kpRenderInspector: () => {}, kpRenderPageHead: () => {},
        kpAfterKeypadChange: () => {}, kpRenderConnection: () => {}, kpRenderLighting: () => {}, kpRenderBar: () => {},
        kpUpdateChip: () => {}, kpRenderEcuPage: () => {},
        localStorage: { getItem: () => null, setItem: () => {} }
    };
    const ctx = vm.createContext(sandbox);
    const pre = [
        grabVar('LED_COLORS'),
        line(/^\s*var HEX = \{\}; LED_COLORS\.forEach\([^\n]*$/m, 'the HEX map'),
        grabVar('MODELS'), grabVar('ICONS'), grabVar('DEFAULT_KEYS'), grabVar('KP_COL'), grabVar('kp'),
        line(/^\s*var CELL = 104[^\n]*$/m, 'the keypad geometry constants'),
        grab('kpCol'), grab('kpHex'), grab('kpHex2'), grab('kpIsJ'),
        grab('keyAssigned'), grab('_kpEsc'), grab('_kpChanRange'), grab('kpSimVal'),
        grab('_kpAlertHit'), grab('kpActiveAlert'), grab('_kpPositions'), grab('_kpCurPos'),
        /* the ring state the Design page paints, and the demo bus it consults */
        grabVar('kpDemo'), grab('kpDemoActive'), grab('kpNow'), grab('kpDemoVal'), grab('kpDemoFor'),
        grab('ledActive'), grab('ledColor'), grab('ledBehavior'),
        grab('kpBrightness'), grab('_kpHexMix'), grab('kpLegendLook'), grab('kpInsertColor'),
        grab('ledBase'), grab('_kpRing'),
        grab('kpFrameMap'), grab('kpIds'), grab('kpSigName'), grab('kpBuildSvg'),
        grab('kpSlug'),   /* every file is named after the keypad it describes (ADR-0060) */
        /* undo: one snapshot of the whole keypad, put back whole */
        grabVar('KP_FIELDS'), grab('kpModelOf'),
        line(/^\s*var kpUndoStack = \[\], KP_UNDO_MAX[^\n]*$/m, 'the undo stack'),
        grab('kpSnapshot'), grab('kpUndoPush'), grab('kpUndoClear'), grab('kpRenderUndo'), grabWin('kpUndo')
    ].join('\n\n');
    const names = ['kpfxGeom', 'kpfxRim', 'kpfxQuant', 'kpfxCtx', 'kpfxDef', 'kpfxColours', 'kpfxKnobs',
        'kpfxRenderStep', 'kpfxStepsSecs', 'kpfxStepAt', 'kpfxCompose', 'kpfxFrame',
        'kpfxLedFrame', 'kpfxBlFrame', 'kpfxBake', 'kpfxBakeBoot', 'kpfxPeakRate', 'kpfxSameData',
        'kpfxPresetDef', 'kpfxPreset', 'kpfxDefaultShow', 'kpfxNormalise', 'kpfxNormaliseStep',
        'kpfxMigrateV1', 'kpfxMigrateV2', 'kpfxShow', 'kpfxPresetMatch', 'kpfxRingColour',
        'kpfxHexRgb', 'kpfxRgbHex', 'kpfxRgb', 'kpfxBakeText', 'kpfxPreviewFrame', 'kpfxStepSpeed',
        'KPFX_PRESS', 'KPFX_PRESS_S', 'kpfxPressDef', 'kpfxPressAt', 'kpfxRestable', 'kpfxUsesColour',
        'kpfxSpeedVal', 'kpfxSpeedLabel',
        'kpfxSel', 'kpfxOnRest', 'kpfxOnStart',
        'kpfxWatchDecode', 'kpfxWatchApply', 'kpfxWatchHeld', 'kpfxWatch', 'KPFX_WATCH_MS',
        'KPFX_DASH_MAX_FRAMES', 'KPFX_DASH_MAX_MS',
        'kpfxDashTape', 'kpfxDashFits', 'kpfxDashLine',
        'kpfxStepBl', 'kpfxShowDrivesBl', 'kpfxStandingBl', 'kpfxBlAt', 'KPFX_BL_MIN_MS',
        'KPFX', 'KPFX_PRESETS', 'KPFX_LEDS', 'KPFX_OFF_AT', 'KPFX_MAX_FPS', 'KPFX_BUDGET',
        'KPFX_REST_S', 'KPFX_MAX_STEPS', 'KPFX_DIRS', 'kp', 'kpfx',
        'KPFX_SPEED', 'KPFX_SPEED_MIN', 'KPFX_SPEED_MAX', 'KPFX_SETTLE',
        'HEX', 'KP_COL', 'MODELS', 'DEFAULT_KEYS', 'kpBuildSvg', 'kpFrameMap',
        'kpSnapshot', 'kpUndoPush', 'kpUndoClear', 'undoLen', 'KP_UNDO_MAX',
        'KPFX_STARTUP', 'kpfxStartupDef', 'KPFX_START_I', 'KPFX_REST_I'];
    vm.runInContext(pre + '\n\n' + SHOW + '\n\nfunction undoLen() { return kpUndoStack.length; }' +
                    '\n\nglobalThis.__api = { ' + names.map(n => n + ': ' + n).join(', ') + ' };',
                    ctx, { timeout: 30000 });
    sandbox.__api.win = win;
    sandbox.__api.saved = () => sandbox.__saved;
    return sandbox.__api;
}
let A;
try { A = build(); }
catch (e) { console.log('\n  the boot sequence could not be extracted and run:\n  ' + (e.stack || e.message) + '\n'); process.exit(1); }

const TIMES = [0, 0.037, 0.4, 1.1, 2.9, 3.5, 7.3, 19.7, 61.5, 240.25];
function ledOf(f) { const out = []; for (let i = 0; i < f.n; i++) out.push(A.kpfxQuant(f.out[i * 3], f.out[i * 3 + 1], f.out[i * 3 + 2])); return out; }
function step(fx, o) { return Object.assign({ fx: fx, color: 'white' }, o || {}); }
/* a step rendered with NO length loops; with one it is paced by it */
function render(model, fx, t, o) { A.kp.model = model; return A.kpfxRenderStep(model, step(fx, o), t); }
function boot(steps) { return A.kpfxNormalise({ steps: steps, idle: { fx: 'buttons' } }); }

/* === 1. every effect renders a legal frame, on every model ============== */
console.log('\nevery effect renders a legal frame');
{
    ok('there are effects to check, and not too many', A.KPFX.length >= 12 && A.KPFX.length <= 20, A.KPFX.length + ' effects');
    let bad = [], n = 0;
    A.MODELS.forEach(m => {
        A.KPFX.forEach(e => {
            TIMES.forEach(t => {
                const f = render(m, e.id, t);
                n++;
                if (f.out.length !== m.rows * m.cols * 3) { bad.push(e.id + '/' + m.id + ': wrong length'); return; }
                for (let i = 0; i < f.out.length; i++) {
                    const v = f.out[i];
                    if (!Number.isFinite(v) || v < 0 || v > 255 || v !== Math.round(v)) { bad.push(e.id + '/' + m.id + '@' + t + ': out[' + i + '] = ' + v); return; }
                }
            });
        });
    });
    ok('every channel of every frame is a whole 0-255', !bad.length, bad.slice(0, 4).join('\n         '));
    ok('that was a real sweep', n >= A.KPFX.length * A.MODELS.length * TIMES.length, n + ' frames');
    ok('effects are either once-through or looping, and both kinds exist', A.KPFX.some(e => e.once) && A.KPFX.some(e => !e.once));
}

/* === 2. the same moment is always the same frame ======================== */
console.log('\nthe same moment is always the same frame');
{
    let bad = [];
    A.KPFX.forEach(e => {
        [0.31, 4.7, 88.125].forEach(t => {
            const a = JSON.stringify(render(A.MODELS[3], e.id, t).out), b = JSON.stringify(render(A.MODELS[3], e.id, t).out);
            if (a !== b) bad.push(e.id + ' @' + t);
        });
    });
    ok('rendering the same effect twice gives the same pixels', !bad.length, bad.join(', '));
    ok('and the scatter effects are hashes, not dice', !/Math\s*\.\s*random/.test(SHOWCODE), 'Math.random() appears in the block');
    const cut = SHOWCODE.indexOf('function kpfxLedFrame');
    const engineOnly = cut > 0 ? SHOWCODE.slice(0, cut) : '';
    ok('and nothing in the effects reads a wall clock',
       engineOnly.length > 8000 && !/Date\s*\.\s*now|performance\s*\.\s*now/.test(engineOnly),
       'the effect engine reads a clock instead of its own t');
}

/* === 3. moving effects move, still ones hold ============================ */
console.log('\nmoving effects move, still ones hold');
{
    const STILL = ['dark', 'keys', 'buttons', 'solid'];
    let stuck = [], drifted = [];
    A.KPFX.forEach(e => {
        const frames = TIMES.map(t => JSON.stringify(render(A.MODELS[2], e.id, t).out));
        const moved = new Set(frames).size > 1;
        if (STILL.indexOf(e.id) >= 0) { if (moved) drifted.push(e.id); }
        else if (!moved) stuck.push(e.id);
    });
    ok('every moving effect actually changes over time', !stuck.length, 'frozen: ' + stuck.join(', '));
    ok('and the still ones stay still', !drifted.length, 'drifting: ' + drifted.join(', '));
    const SPATIAL = ['rainbow', 'fire', 'checker', 'scan'];
    let uniform = [];
    SPATIAL.forEach(id => {
        let differs = false;
        TIMES.forEach(t => { if (new Set(ledOf(render(A.MODELS[0], id, t))).size > 1) differs = true; });
        if (!differs) uniform.push(id);
    });
    ok('a spreading effect still spreads on the smallest keypad', !uniform.length, 'the same colour on every key: ' + uniform.join(', '));
}

/* === 4. the quantiser stays inside the hardware ========================= */
console.log('\nthe quantiser stays inside the hardware');
{
    ok('the ring palette is the seven the bits can make', A.KPFX_LEDS.join(',') === 'red,green,blue,yellow,cyan,purple,white');
    ok('amber and lime are marked backlight-only in the colour table', !!A.KP_COL.amber.bl && !!A.KP_COL.lime.bl);
    ok('and the step colour picker refuses them', !A.kpfxRingColour('amber') && !A.kpfxRingColour('lime') && A.kpfxRingColour('blue'));
    let bad = [], off = 0, lit = 0;
    for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) {
        const q = A.kpfxQuant(r, g, b);
        if (q === null) { off++; continue; }
        lit++;
        if (A.KPFX_LEDS.indexOf(q) < 0 || q === 'amber' || q === 'lime') bad.push([r, g, b] + ' -> ' + q);
    }
    ok('no RGB anywhere maps to a colour a ring cannot be', !bad.length, bad.slice(0, 3).join('; '));
    ok('the sweep covered both dark and lit', off >= 8 && lit > 1000, off + ' dark, ' + lit + ' lit');
    ok('black is dark, not a colour', A.kpfxQuant(0, 0, 0) === null);
    let wrong = [];
    A.KPFX_LEDS.forEach(id => { const c = A.kpfxHexRgb(A.HEX[id]); const q = A.kpfxQuant(c[0], c[1], c[2]); if (q !== id) wrong.push(id + ' -> ' + q); });
    ok('each ring colour quantises back to itself', !wrong.length, wrong.join(', '));
    let flips = 0, was = A.kpfxQuant(255, 0, 0);
    for (let s = 255; s >= 0; s--) { const q = A.kpfxQuant(s, 0, 0); if (q !== was) { flips++; was = q; } }
    ok('fading a colour to black crosses into dark exactly once', flips === 1, flips + ' changes');
}

/* === 5. what actually goes on the wire ================================== */
console.log('\nthe LED frame is the one the manual describes');
{
    const NODE = 0x15;
    const f8 = A.kpfxLedFrame(['red', null, null, null, null, null, null, null], 8, NODE);
    ok('the rings frame is 0x200 + node, standard 11-bit', f8.id === 0x200 + NODE && f8.ext === false);
    ok('key 1 red is byte 0 bit 0', f8.data[0] === 0x01 && f8.data[1] === 0 && f8.data[2] === 0, f8.data.join(','));
    const g8 = A.kpfxLedFrame([null, 'green', null, null, null, null, null, null], 8, NODE);
    ok('up to eight keys, green is byte 1', g8.data[0] === 0 && g8.data[1] === 0x02 && g8.data[2] === 0, g8.data.join(','));
    const led15 = new Array(15).fill(null); led15[8] = 'green';
    const g15 = A.kpfxLedFrame(led15, 15, NODE);
    ok('above eight keys, key 9 green is byte 3 bit 0', g15.data[3] === 0x01 && g15.data[2] === 0 && g15.data[0] === 0, g15.data.join(','));
    A.kp.model = A.MODELS[3];
    const map = A.kpFrameMap().filter(fr => fr.id === 0x200 + (A.kp.node & 0x7f));
    const gSig = [].concat.apply([], map.map(fr => fr.sigs)).filter(s => /_G$/.test(s.name));
    ok('the exported DBC puts green where the encoder puts it', gSig.length && gSig[0].start === 16, gSig.length ? String(gSig[0].start) : 'no green signals');
    const src = ['red', 'green', 'blue', 'yellow', 'cyan', 'purple', 'white', null, 'red', null, 'cyan', 'white', 'green', 'blue', 'purple'];
    const enc = A.kpfxLedFrame(src, 15, NODE), back = [];
    for (let i = 0; i < 15; i++) {
        const by = Math.floor(i / 8), bit = 1 << (i % 8);
        const rgb = [(enc.data[0 + by] & bit) ? 1 : 0, (enc.data[2 + by] & bit) ? 1 : 0, (enc.data[4 + by] & bit) ? 1 : 0];
        let found = null;
        A.KPFX_LEDS.forEach(id => { const t = A.KP_COL[id].rgb; if (t[0] === rgb[0] && t[1] === rgb[1] && t[2] === rgb[2]) found = id; });
        back.push(found);
    }
    ok('every colour survives the trip to bits and back', back.join(',') === src.join(','));
    const bl = A.kpfxBlFrame({ color: 'amber', bright: 40 }, NODE);
    ok('the legend backlight is 0x500 + node, 6-bit brightness, Blink colour index', bl.id === 0x500 + NODE && bl.data[0] === 40 && bl.data[1] === 8);
    ok('a brightness out of range is clamped, not wrapped', A.kpfxBlFrame({ color: 'amber', bright: 999 }, NODE).data[0] === 0x3f);
}

/* === 6. a step's length is its speed ==================================== */
console.log('\na step’s length is its speed');
{
    A.MODELS.forEach(m => {
        A.kp.model = m;
        let unfinished = [], early = [];
        A.KPFX.filter(e => e.once).forEach(e => {
            [0.3, 1.0, 4.0].forEach(secs => {
                const st = step(e.id, { secs: secs });
                const end = ledOf(A.kpfxRenderStep(m, st, secs - 0.01));
                const later = ledOf(A.kpfxRenderStep(m, st, secs + 2));
                if (end.join(',') !== later.join(',')) unfinished.push(e.id + '@' + secs + 's');
                /* and it must not have ALREADY settled a quarter of the way in:
                   that would mean the length is being ignored */
                const quarter = ledOf(A.kpfxRenderStep(m, st, secs * 0.25));
                if (quarter.join(',') === later.join(',') && e.id !== 'flash') early.push(e.id + '@' + secs + 's');
            });
        });
        ok(m.name + ': every once-through effect has settled by the end of its own time', !unfinished.length, unfinished.join(', '));
        ok(m.name + ': and is still going a quarter of the way in — the length is not ignored', !early.length, early.join(', '));
    });
    A.kp.model = A.MODELS[3];
    const a = ledOf(A.kpfxRenderStep(A.kp.model, step('rollcall', { secs: 1 }), 0.5));
    const b = ledOf(A.kpfxRenderStep(A.kp.model, step('rollcall', { secs: 2 }), 1.0));
    ok('a step given twice the time is at the same point halfway through', a.join(',') === b.join(','), a.join(',') + ' / ' + b.join(','));
    const rc = ledOf(A.kpfxRenderStep(A.kp.model, step('rollcall', { secs: 1.2 }), 1.19)).filter(Boolean).length;
    ok('roll call on fifteen keys reaches the last assigned key inside a 1.2 s step', rc === 13, rc + ' lit (13 of the 15 default keys are assigned)');
}

/* === 6b. and speed is the other knob ==================================== */
console.log('\nand speed is the other knob: how fast it runs inside that length');
{
    const m = A.MODELS[3];
    A.kp.model = m;
    ok('the slider’s ends are a quarter pace and four times it, around a normal 1x',
       A.KPFX_SPEED_MIN === 0.25 && A.KPFX_SPEED_MAX === 4 && A.kpfxStepSpeed({}) === 1);
    ok('a step with no speed of its own runs at normal pace',
       JSON.stringify(A.kpfxRenderStep(m, step('scan', { secs: 2 }), 0.7).out) ===
       JSON.stringify(A.kpfxRenderStep(m, step('scan', { secs: 2, speed: 1 }), 0.7).out));
    ok('a speed nobody could mean is pulled back to the ends, not obeyed',
       A.kpfxStepSpeed({ speed: 99 }) === 4 && A.kpfxStepSpeed({ speed: 0.001 }) === 0.25 &&
       A.kpfxStepSpeed({ speed: 'fast' }) === 1 && A.kpfxStepSpeed({ speed: -2 }) === 1);
    /* looping: twice the speed is the same picture at twice the time */
    let off = [];
    A.KPFX.filter(e => !e.once).forEach(e => {
        const a = JSON.stringify(A.kpfxRenderStep(m, step(e.id, { secs: 8 }), 2.0).out);
        const b = JSON.stringify(A.kpfxRenderStep(m, step(e.id, { secs: 8, speed: 2 }), 1.0).out);
        if (a !== b) off.push(e.id);
    });
    ok('a looping effect at 2x is that effect at twice the time', !off.length, off.join(', '));
    /* once-through: faster finishes early and HOLDS, slower runs out of step */
    let late = [], notheld = [];
    A.KPFX.filter(e => e.once).forEach(e => {
        const st = step(e.id, { secs: 2, speed: 2 }), settled = ledOf(A.kpfxRenderStep(m, st, 5));
        if (ledOf(A.kpfxRenderStep(m, st, 1.05)).join() !== settled.join()) late.push(e.id);
        if (ledOf(A.kpfxRenderStep(m, st, 1.9)).join() !== settled.join()) notheld.push(e.id);
    });
    ok('at 2x a once-through effect is finished by halfway', !late.length, late.join(', '));
    ok('and holds what it made until the step ends', !notheld.length, notheld.join(', '));
    const half = ledOf(A.kpfxRenderStep(m, step('wipe', { secs: 1, speed: 0.5, k1: 0 }), 0.99));
    const full = ledOf(A.kpfxRenderStep(m, step('wipe', { secs: 1, k1: 0 }), 0.99));
    ok('at half speed the step ends before the effect finishes — and says so, rather than being cut',
       half.filter(Boolean).length > 0 && half.filter(Boolean).length < full.filter(Boolean).length,
       half.filter(Boolean).length + ' of ' + full.filter(Boolean).length + ' keys reached');
    /* The panel used to explain this in a sentence under the slider. The
       explanation belongs in the guide; what has to stay on screen is the fact
       the number alone cannot tell you — when a once-through effect lands, or
       how far it gets before the step runs out. */
    ok('the speed readout carries the fact the multiplier alone cannot',
       /kpfxSpeedVal/.test(SHOW) && !/kpfxSpeedNote/.test(SHOW));
    ok('above 1x it says when the effect lands', /ends /.test(A.kpfxSpeedVal(step('wipe', { secs: 2, speed: 2 }))),
       A.kpfxSpeedVal(step('wipe', { secs: 2, speed: 2 })));
    ok('below 1x it says how far it gets', /% of the way/.test(A.kpfxSpeedVal(step('wipe', { secs: 2, speed: 0.5 }))),
       A.kpfxSpeedVal(step('wipe', { secs: 2, speed: 0.5 })));
    ok('at 1x, and for anything that loops, it is just the multiplier',
       A.kpfxSpeedVal(step('wipe', { secs: 2 })) === '1×' && A.kpfxSpeedVal(step('scan', { secs: 2, speed: 3 })) === '3×',
       A.kpfxSpeedVal(step('wipe', { secs: 2 })) + ' / ' + A.kpfxSpeedVal(step('scan', { secs: 2, speed: 3 })));
    ok('speed changes what goes on the wire, not just the picture',
       A.kpfxBake(boot([step('scan', { secs: 4, speed: 4 })]), 4, A.KPFX_MAX_FPS, 0x15).length !==
       A.kpfxBake(boot([step('scan', { secs: 4, speed: 0.25 })]), 4, A.KPFX_MAX_FPS, 0x15).length);
    let overSp = [];
    A.KPFX.forEach(e => {
        const p = A.kpfxPeakRate(A.kpfxBake(boot([step(e.id, { secs: 6, speed: 4 })]), 6, A.KPFX_MAX_FPS, 0x15));
        if (p > A.KPFX_BUDGET) overSp.push(e.id + ' = ' + p + '/s');
    });
    ok('and no effect wound all the way up outruns the dash', !overSp.length, overSp.join(', '));
}

/* === 7. the colour you pick is the colour that comes out ================ */
console.log('\nthe colour you pick is the colour that comes out');
{
    A.kp.model = A.MODELS[3];
    let wrong = [];
    ['red', 'green', 'blue', 'yellow', 'cyan', 'purple', 'white'].forEach(c => {
        const led = ledOf(A.kpfxRenderStep(A.kp.model, step('wipe', { secs: 1, color: c, k1: 0 }), 0.95)).filter(Boolean);
        if (!led.length || !led.every(x => x === c)) wrong.push(c + ' -> ' + led[0]);
    });
    ok('a wipe in each ring colour comes out in that colour', !wrong.length, wrong.join(', '));
    const amber = A.kpfxNormaliseStep({ fx: 'wipe', secs: 1, color: 'amber' });
    ok('a step cannot be amber — the rings have no bits for it', amber.color !== 'amber' && A.kpfxRingColour(amber.color), amber.color);
    const wL = ledOf(A.kpfxRenderStep(A.kp.model, step('wipe', { secs: 1, k1: 0 }), 0.3));
    const wR = ledOf(A.kpfxRenderStep(A.kp.model, step('wipe', { secs: 1, k1: 1 }), 0.3));
    const wD = ledOf(A.kpfxRenderStep(A.kp.model, step('wipe', { secs: 1, k1: 2 }), 0.3));
    ok('"left to right" lights the left first, "right to left" the right, "top to bottom" the top',
       !!wL[0] && !wL[4] && !!wR[4] && !wR[0] && !!wD[0] && !wD[10], wL.join(',') + ' | ' + wR.join(',') + ' | ' + wD.join(','));
    ok('the direction choices are the four the UI offers', A.KPFX_DIRS.length === 4);
    const sw = ledOf(A.kpfxRenderStep(A.kp.model, step('sweep', { secs: 1, color: 'red', k1: 0 }), 2));
    ok('a sweep ends on the key colours from the Design page, not the step colour', sw[0] === 'green' && sw[2] === 'blue' && sw[13] === null, sw.join(','));
    const saved = A.kp.keys;
    A.kp.keys = saved.map(k => Object.assign({}, k, { label: '', preset: '— unassigned —' }));
    const blank = ledOf(A.kpfxRenderStep(A.kp.model, step('rollcall', { secs: 1, color: 'cyan' }), 2));
    ok('on a keypad with no keys assigned, roll call uses the step colour rather than showing nothing', blank.every(x => x === 'cyan'), blank.join(','));
    A.kp.keys = saved;
}

/* === 8. every ready-made boot, from cold, on every keypad =============== */
console.log('\nevery ready-made boot plays from cold on every keypad');
{
    ok('there are boots to start from, and not many', A.KPFX_PRESETS.length >= 4 && A.KPFX_PRESETS.length <= 8, String(A.KPFX_PRESETS.length));
    const ids = A.KPFX_PRESETS.map(p => p.id);
    ok('their ids are unique', new Set(ids).size === ids.length);
    let changed = [];
    A.KPFX_PRESETS.forEach(d => {
        const p = A.kpfxPreset(d.id);
        if (JSON.stringify(A.kpfxNormalise(JSON.parse(JSON.stringify(p)))) !== JSON.stringify(p)) changed.push(d.id);
        if (A.kpfxPresetMatch(p) !== d.id) changed.push(d.id + ' (not recognised as itself)');
    });
    ok('every boot survives normalising unchanged, and is recognised as itself', !changed.length, changed.join(', '));
    /* The panel promises a ready-made boot "replaces the steps above". It must
       not also throw away the resting look and the reaction, which are set on
       another block of the same page and have nothing to do with which boot
       you picked. */
    A.kp.show = A.kpfxNormalise({ steps: [step('flash', { secs: 0.4 })],
                                  idle: { fx: 'fire', color: 'red', speed: 2 }, press: { fx: 'ripple' } });
    A.win.kpfxUsePreset('rollcall');
    ok('picking a ready-made boot replaces the steps',
       A.kp.show.steps.length === 1 && A.kp.show.steps[0].fx === 'rollcall', JSON.stringify(A.kp.show.steps));
    ok('and leaves the resting look and the reaction alone',
       A.kp.show.idle.fx === 'fire' && A.kp.show.idle.color === 'red' && A.kp.show.idle.speed === 2 &&
       A.kp.show.press.fx === 'ripple', JSON.stringify(A.kp.show.idle) + ' / ' + JSON.stringify(A.kp.show.press));
    A.kp.show = A.kpfxDefaultShow();
    A.MODELS.forEach(m => {
        A.kp.model = m;
        let dark = [], bad = [], settle = [];
        A.KPFX_PRESETS.forEach(d => {
            const show = A.kpfxPreset(d.id), total = A.kpfxStepsSecs(show);
            let anyLit = false;
            for (let t = 0; t < total; t += 0.05) if (A.kpfxFrame(m, show, { t }).led.some(Boolean)) { anyLit = true; break; }
            if (!anyLit) dark.push(d.id);
            const fr = A.kpfxFrame(m, show, { t: total + 0.2 });
            if (fr.moment !== 'rest') bad.push(d.id + ' -> ' + fr.moment);
            show.steps.forEach((st, i) => {
                if (!A.kpfxDef(st.fx).once) return;
                const end = ledOf(A.kpfxRenderStep(m, st, st.secs - 0.02)), later = ledOf(A.kpfxRenderStep(m, st, st.secs + 0.6));
                if (end.join(',') !== later.join(',')) settle.push(d.id + ' step ' + (i + 1));
            });
        });
        ok(m.name + ': every boot lights something', !dark.length, 'dark: ' + dark.join(', '));
        ok(m.name + ': every boot ends with the keys at rest', !bad.length, bad.join(', '));
        ok(m.name + ': every once-through step in every boot settles inside its time', !settle.length, settle.join(', '));
    });
    A.kp.model = A.MODELS[1];
    const S = boot([step('solid', { secs: 1.0, color: 'blue' }), step('wipe', { secs: 1.0, color: 'red', k1: 0 })]);
    const at = t => A.kpfxFrame(A.kp.model, S, { t });
    ok('the first step plays first', at(0.5).moment === 'boot' && at(0.5).step === 0 && at(0.5).led[0] === 'blue');
    ok('then the second, from ITS OWN zero', at(1.05).moment === 'boot' && at(1.05).step === 1 &&
       JSON.stringify(at(1.05).led) === JSON.stringify(ledOf(A.kpfxRenderStep(A.kp.model, S.steps[1], 0.05))));
    ok('after the last step, the rings go back to the buttons', at(2.1).moment === 'rest');
    ok('a boot with no steps is just the buttons', A.kpfxFrame(A.kp.model, boot([]), { t: 0.1 }).moment === 'rest');
}

/* === 8b. the legends, as part of the show ===============================
   The rings are three bits and seven colours; the lamp behind the legends is
   nine colours and sixty-four levels, and it used to be the one part of the
   keypad the show was not allowed to touch. The rules that matter: a step
   that says nothing changes nothing, a step that says something is on the
   wire as 0x500+node, and whatever the show does it gives the legends back. */
console.log('\nthe legends are part of the show now');
{
    A.kp.model = A.MODELS[3]; A.kp.node = 0x15;
    A.kp.blColor = 'amber'; A.kp.blBright = 18;
    const quiet = A.kpfxNormalise({ steps: [step('wipe', { secs: 1 })], idle: { fx: 'buttons' } });
    ok('a step that says nothing about the legends leaves them on the keypad’s own default',
       !A.kpfxShowDrivesBl(quiet) && A.kpfxFrame(A.kp.model, quiet, { t: 0.5 }).bl.color === 'amber' &&
       A.kpfxFrame(A.kp.model, quiet, { t: 0.5 }).bl.drive === false);
    const lit = A.kpfxNormalise({ steps: [step('wipe', { secs: 1, blc: 'lime', blv: 63 }), step('flash', { secs: 1 })],
                                  idle: { fx: 'buttons' } });
    ok('a step that sets them is what comes out during that step',
       A.kpfxFrame(A.kp.model, lit, { t: 0.5 }).bl.color === 'lime' && A.kpfxFrame(A.kp.model, lit, { t: 0.5 }).bl.bright === 63);
    ok('the step after it, which says nothing, is back on the keypad’s default',
       A.kpfxFrame(A.kp.model, lit, { t: 1.5 }).bl.color === 'amber' && A.kpfxFrame(A.kp.model, lit, { t: 1.5 }).bl.bright === 18);
    ok('and so is the rest — a show that borrows the legends gives them back',
       A.kpfxFrame(A.kp.model, lit, { t: 3 }).bl.color === 'amber' && A.kpfxFrame(A.kp.model, lit, { t: 3 }).bl.bright === 18);
    ok('once any step touches them the whole show drives them, so the way back is on the wire',
       A.kpfxShowDrivesBl(lit) && A.kpfxFrame(A.kp.model, lit, { t: 3 }).bl.drive === true);
    /* amber and lime are the point: no ring can make either */
    ok('the legends can be the two colours a ring cannot',
       ['amber', 'lime'].every(c => A.kpfxNormaliseStep({ fx: 'wipe', secs: 1, blc: c }).blc === c) &&
       ['amber', 'lime'].every(c => !A.kpfxRingColour(c)));
    ok('and a colour the lamp cannot make is dropped, not drawn',
       !('blc' in A.kpfxNormaliseStep({ fx: 'wipe', secs: 1, blc: 'octarine' })));
    ok('a level out of range is pulled back, and a missing one is full',
       A.kpfxNormaliseStep({ fx: 'wipe', secs: 1, blc: 'red', blv: 900 }).blv === 63 &&
       A.kpfxNormaliseStep({ fx: 'wipe', secs: 1, blc: 'red' }).blv === 63);
    /* the wire */
    const bf = A.kpfxBlFrame({ color: 'amber', bright: 0x3F }, 0x15);
    ok('the legend frame is 0x500+node, brightness then colour — the one proved on the bench',
       bf.id === 0x515 && bf.data[0] === 0x3F && bf.data[1] === 8, A.kpfxRgbHex ? bf.data.join(',') : '');
    const baked = A.kpfxBakeBoot(lit, 0x15);
    const blFrames = baked.filter(b => b.why === 'backlight');
    ok('the baked file carries the legend frames', blFrames.length >= 2, blFrames.length + ' legend frames');
    ok('and the last of them puts the legends back where the keypad keeps them',
       blFrames[blFrames.length - 1].f.data[0] === 18 && blFrames[blFrames.length - 1].f.data[1] === 8,
       blFrames[blFrames.length - 1].f.data.join(','));
    let tooFast = 0, prev = -1e9;
    blFrames.forEach(b => { if (b.ms - prev < A.KPFX_BL_MIN_MS) tooFast++; prev = b.ms; });
    ok('and never asks the lamp to change faster than it is throttled to', tooFast === 0, tooFast + ' too close together');
    ok('a boot that drives the legends is still inside the dash’s frame budget',
       A.kpfxPeakRate(baked) <= A.KPFX_BUDGET, A.kpfxPeakRate(baked) + '/s');
    ok('a boot that does not touch them puts no legend frame on the bus at all',
       A.kpfxBakeBoot(quiet, 0x15).every(b => b.why !== 'backlight'));
    /* the frame script says which of the two it is */
    A.kp.show = lit;
    ok('the frame script says the legends are driven, and what they end on', /0x515 sets the legend backlight/.test(A.kpfxBakeText()));
    A.kp.show = quiet;
    ok('and says plainly when they are not touched', /legend backlight is not touched/.test(A.kpfxBakeText()));
    /* and the ready-mades demonstrate it */
    ok('two of the ready-made boots drive the legends, so the lane is discoverable',
       A.KPFX_PRESETS.filter(d => A.kpfxShowDrivesBl(A.kpfxPreset(d.id))).length === 2,
       A.KPFX_PRESETS.filter(d => A.kpfxShowDrivesBl(A.kpfxPreset(d.id))).map(d => d.id).join(','));
    ok('and every ready-made boot is still inside the budget with the legends in it',
       A.KPFX_PRESETS.every(d => A.kpfxPeakRate(A.kpfxBakeBoot(A.kpfxPreset(d.id), 0x15)) <= A.KPFX_BUDGET));
    A.kp.show = A.kpfxDefaultShow();
}

/* === 8c. taking it back, and the edits that need it =====================
   There was no undo anywhere in this workspace, and three of its buttons are
   one click from throwing work away. The snapshot is deliberately the whole
   keypad rather than a diff: a keypad is a few kilobytes, and a partial undo
   that puts back the steps but not the key you also changed is worse than
   none, because it looks like it worked. */
console.log('\nundo, duplicate, and reordering the row');
{
    A.kp.model = A.MODELS[3];
    A.kpUndoClear();
    A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6, color: 'red' })], idle: { fx: 'buttons' } });
    ok('nothing to undo on a page nobody has touched', A.undoLen() === 0);
    /* a ready-made boot replaces your steps — the one that stings */
    A.win.kpfxUsePreset('rollcall');
    ok('picking a ready-made boot is undoable', A.undoLen() === 1);
    A.win.kpUndo();
    ok('and undoing it puts YOUR steps back, exactly',
       A.kp.show.steps.length === 1 && A.kp.show.steps[0].fx === 'wipe' && A.kp.show.steps[0].color === 'red',
       JSON.stringify(A.kp.show.steps));
    ok('and the stack is empty again', A.undoLen() === 0);
    /* removing a step */
    A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6 }), step('flash', { secs: 0.4, color: 'green' })],
                                  idle: { fx: 'buttons' } });
    A.kpfx.stepI = 1;
    A.win.kpfxDelStep();
    ok('removing a step removes it', A.kp.show.steps.length === 1);
    A.win.kpUndo();
    ok('and undo brings it back where it was',
       A.kp.show.steps.length === 2 && A.kp.show.steps[1].fx === 'flash' && A.kp.show.steps[1].color === 'green',
       JSON.stringify(A.kp.show.steps));
    /* the keys, not just the boot: one snapshot covers the whole keypad */
    const label = A.kp.keys[0].label;
    A.kpUndoPush('a test');
    A.kp.keys[0].label = 'ZZZ';
    A.win.kpUndo();
    ok('the snapshot is the whole keypad, so a cleared key comes back with the steps',
       A.kp.keys[0].label === label, A.kp.keys[0].label);
    /* the cap: a long session cannot eat the tab's memory */
    A.kpUndoClear();
    for (let i = 0; i < A.KP_UNDO_MAX + 12; i++) A.kpUndoPush('x' + i);
    ok('the stack is capped rather than growing all session', A.undoLen() === A.KP_UNDO_MAX, String(A.undoLen()));
    A.kpUndoClear();
    ok('and switching keypads clears it — undo must never cross from one keypad to another', A.undoLen() === 0);
    /* duplicate */
    A.kp.show = A.kpfxNormalise({ steps: [step('flash', { secs: 0.4, color: 'red', blc: 'amber', blv: 40 })],
                                  idle: { fx: 'buttons' } });
    A.kpfx.stepI = 0;
    A.win.kpfxDupStep();
    ok('duplicate makes a copy in the next slot, with everything set the way it was',
       A.kp.show.steps.length === 2 &&
       JSON.stringify(A.kp.show.steps[0]) === JSON.stringify(A.kp.show.steps[1]), JSON.stringify(A.kp.show.steps));
    ok('and opens the copy, not the original', A.kpfx.stepI === 1);
    ok('it is a copy, not the same object', (A.kp.show.steps[1].color = 'green') && A.kp.show.steps[0].color === 'red');
    A.kp.show.steps[1].color = 'red';
    ok('and it is undoable like everything else', (A.win.kpUndo(), A.kp.show.steps.length === 1));
    /* the row cannot grow past what the strip can show, duplicate included */
    A.kp.show = A.kpfxNormalise({ steps: new Array(A.KPFX_MAX_STEPS).fill(step('flash', { secs: 0.4 })), idle: { fx: 'buttons' } });
    A.kpfx.stepI = 0;
    A.win.kpfxDupStep();
    ok('duplicate stops at the same ceiling as Add', A.kp.show.steps.length === A.KPFX_MAX_STEPS);
    A.kp.show = A.kpfxDefaultShow(); A.kpUndoClear();
}

/* === 8d. the lead-in: the show the KEYPAD plays on its own ==============
   Two different things answer "what happens at ignition" — the keypad's own
   start-up animation (2014h, written into the part) and the boot on this
   page (streamed) — and they were three clicks and one broken button apart.
   The Connection page's "Change" called kpfxGoLane(), which went away with
   the lanes, so the only route to it threw. */
console.log('\nthe lead-in: what the keypad does with nothing attached');
{
    ok('there are three choices, because the keypad has three (2014h)', A.KPFX_STARTUP.length === 3);
    ok('their values are the object\u2019s own 0/1/2', A.KPFX_STARTUP.map(d => d.v).join(',') === '0,1,2');
    ok('every one has a plain sentence saying what it does',
       A.KPFX_STARTUP.every(d => d.name && d.blurb && d.blurb.length > 20));
    ok('an unknown value reads as the first, not as undefined',
       A.kpfxStartupDef(99).v === 0 && A.kpfxStartupDef(undefined).v === 0);
    ok('the lead-in is its own block index, before the first step and apart from the rest',
       A.KPFX_START_I === -2 && A.KPFX_REST_I === -1);
    A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6 })], idle: { fx: 'buttons' } });
    A.kpfx.stepI = A.KPFX_START_I;
    ok('opening it selects no step — it is not one, and editing it must not edit the boot',
       A.kpfxSel() === null, JSON.stringify(A.kpfxSel()));
    ok('and the picture is the keypad before anything is talking to it: rings dark, legends on the keypad’s own default',
       A.kpfxPreviewFrame(2).led.every(c => !c) && A.kpfxPreviewFrame(2).bl.color === A.kp.blColor);
    /* the dead button */
    ok('the Connection page\u2019s "Change" goes somewhere that exists now',
       /onclick=\\"kpfxGoStartup\(\)\\">Change/.test(SRC) && /window\.kpfxGoStartup = function/.test(SRC) &&
       !/kpfxGoLane\(/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, '')));
    ok('and it is written to the keypad with everything else — the setup file still carries 2014h',
       /sdo1\(0x2014, 0x00, kp\.startShow/.test(SRC));
    A.kpfx.stepI = 0;
}

/* === 8e. a real thumb on a real keypad ==================================
   Studio streams blind — it decides what the rings do and is never told that
   anyone touched the thing — so a reaction could only be previewed against
   your own mouse. The dash's frame tracker already holds the keypad's key
   frame, which is the same one the ECU reads, so the picture can be driven by
   the actual keypad. Two things must stay true: it only ever changes a frame
   marked `live`, and it never writes the Design page's own sim state. */
console.log('\nwatching the real keypad through the dash');
{
    A.kp.model = A.MODELS[3];
    A.kp.keys = JSON.parse(JSON.stringify(A.DEFAULT_KEYS));
    A.kp.keyOn = {}; A.kp.keyPos = {};
    const n = A.kp.model.rows * A.kp.model.cols;
    /* CANopen: a bitmap, one byte per eight keys */
    ok('a key frame with key 1 held decodes to key 1',
       JSON.stringify(A.kpfxWatchDecode([0x01, 0, 0, 0, 0, 0, 0, 0], n, false)) === '{"0":1}');
    ok('and key 9 lands in the second byte, not the first',
       JSON.stringify(A.kpfxWatchDecode([0x00, 0x01, 0, 0, 0, 0, 0, 0], n, false)) === '{"8":1}');
    ok('two at once are two at once',
       JSON.stringify(A.kpfxWatchDecode([0x05, 0, 0, 0, 0, 0, 0, 0], n, false)) === '{"0":1,"2":1}');
    ok('nothing held is nothing held', JSON.stringify(A.kpfxWatchDecode([0, 0, 0, 0, 0, 0, 0, 0], n, false)) === '{}');
    /* J1939: the key NUMBER in byte 3, its state in byte 4 */
    ok('J1939 sends a key number, not a bitmap',
       JSON.stringify(A.kpfxWatchDecode([0x04, 0x1B, 0x01, 3, 1, 0, 0, 0], n, true)) === '{"2":1}');
    ok('and a released J1939 key is not held',
       JSON.stringify(A.kpfxWatchDecode([0x04, 0x1B, 0x01, 3, 0, 0, 0, 0], n, true)) === '{}');
    ok('a key number outside this keypad is ignored rather than drawn off the end',
       JSON.stringify(A.kpfxWatchDecode([0, 0, 0, 99, 1, 0, 0, 0], n, true)) === '{}');
    /* the ring lights, and the reaction starts, on the frame the key went down */
    const sh = A.kpfxNormalise({ steps: [], idle: { fx: 'buttons' }, press: { fx: 'none' } });
    A.kpfxWatch.on = true; A.kpfxWatch.keys = {};
    A.kpfx.t = 5;
    A.kpfxWatchApply({ 12: 1 });                                  /* LOG: momentary, green, steady */
    const live = A.kpfxFrame(A.kp.model, sh, { t: 5, live: true });
    ok('a key held on the real keypad lights its ring in the preview', live.led[12] === 'green', String(live.led[12]));
    ok('and it does NOT reach a baked frame — the file is the boot, not last Tuesday’s thumb',
       !A.kpfxFrame(A.kp.model, sh, { t: 5 }).led[12]);
    ok('a key going down starts a reaction, with no mouse anywhere near it',
       A.kpfx.press && A.kpfx.press.i === 12 && A.kpfx.press.held === true, JSON.stringify(A.kpfx.press));
    A.kpfxWatchApply({});
    ok('and letting go of it lets go here', A.kpfx.press.held === false);
    ok('the ring goes out with it', !A.kpfxFrame(A.kp.model, sh, { t: 5, live: true }).led[12]);
    /* a key whose ring is set to blink blinks while it is held, at the rate
       the Design page draws — the dash is what does this in the car */
    A.kpfxWatchApply({ 6: 1 });                                   /* LAUNCH: momentary, red, fast blink */
    const at = t => A.kpfxFrame(A.kp.model, sh, { t: t, live: true }).led[6];
    ok('and a key set to blink blinks while it is held', at(5.0) !== at(5.0 + 0.21), at(5.0) + ' / ' + at(5.21));
    A.kpfxWatchApply({});
    ok('and the Design page’s own sim state was never touched',
       Object.keys(A.kp.keyOn).length === 0, JSON.stringify(A.kp.keyOn));
    A.kpfxWatch.on = false;
    ok('with the watch off, a stale held key means nothing',
       (A.kpfxWatch.keys = { 12: 1 }, !A.kpfxFrame(A.kp.model, sh, { t: 5, live: true }).led[12]));
    A.kpfxWatch.keys = {};
    A.kpfx.press = null;
    ok('the poll rate is often enough to feel like a button and slow enough not to be a flood',
       A.KPFX_WATCH_MS >= 60 && A.KPFX_WATCH_MS <= 250, A.KPFX_WATCH_MS + ' ms');
    ok('playing takes the dash over from the watcher rather than deadlocking on it',
       /kpw\.busy && kpw\.busyBy !== "watch"/.test(SRC) && /kpfxWatch\.own = false;/.test(SRC));
}

/* === 8f. the tape the dash plays =======================================
   The handover that stops this page being a demo: Studio bakes the boot to
   timed frames and the dash plays them at every power-up with no laptop in
   the car. The file crosses a repo boundary, so its shape is checked here —
   the reader is C in RDM-7_Dash/main/can/keypad_lights.c and it cannot ask
   for clarification. */
console.log('\nthe tape the dash plays');
{
    A.kp.model = A.MODELS[3]; A.kp.node = 0x15; A.kp.baud = 125;
    A.kp.name = 'Wheel pad';
    A.kp.show = A.kpfxNormalise({ steps: [step('crank', { secs: 1.8 }), step('sweep', { secs: 1.0 })],
                                  idle: { fx: 'buttons' } });
    const tape = A.kpfxDashTape();
    ok('the tape says which document it is, and for which keypad',
       tape.rdm_keypad_lights === 1 && tape.keypad === 'Wheel pad' && tape.node === 0x15 && tape.baud === 125);
    ok('it carries frames, each with a time, an 11-bit id and eight hex bytes',
       tape.frames.length > 2 && tape.frames.every(f =>
           Number.isInteger(f.ms) && f.ms >= 0 && Number.isInteger(f.id) && f.id <= 0x7FF &&
           /^[0-9A-F]{16}$/.test(f.d)), JSON.stringify(tape.frames[0]));
    let backwards = 0, prev = -1;
    tape.frames.forEach(f => { if (f.ms < prev) backwards++; prev = f.ms; });
    ok('and its times only ever go forwards — the player sleeps on the difference', backwards === 0);
    ok('a boot that hands the rings back does not loop, and the last frame is the hand-back',
       tape.loop === false && tape.loop_from_ms === 0);
    A.kp.show = A.kpfxNormalise({ steps: [step('crank', { secs: 1.8 })], idle: { fx: 'scan', speed: 1 } });
    const loops = A.kpfxDashTape();
    ok('a boot that rests on an animation says so, and says where one turn of it starts',
       loops.loop === true && loops.loop_from_ms === 1800, JSON.stringify({ l: loops.loop, f: loops.loop_from_ms }));
    /* the limits are the C player's, checked here because the C can only
       truncate, and half a boot is worse than no boot */
    ok('the frame ceiling matches the dash player’s array', A.KPFX_DASH_MAX_FRAMES === 384);
    ok('and the length ceiling stays inside its uint16 milliseconds', A.KPFX_DASH_MAX_MS <= 65000);
    ok('a boot the dash can hold is offered', !A.kpfxDashFits(A.kpfxBakeBoot(A.kpfxShow(), 0x15)));
    const tooMany = new Array(A.KPFX_DASH_MAX_FRAMES + 1).fill({ ms: 0, f: { id: 0x215, data: [0, 0, 0, 0, 0, 0, 0, 0] } });
    ok('one it cannot is refused with the number, not a shrug',
       /385 frames and the dash holds 384/.test(A.kpfxDashFits(tooMany)), A.kpfxDashFits(tooMany));
    const tooLong = [{ ms: 0, f: {} }, { ms: 61000, f: {} }];
    ok('and one that runs too long is refused for that instead', /runs 61s/.test(A.kpfxDashFits(tooLong)));
    A.kp.show = A.kpfxDefaultShow();
}

/* === 9. the bus budget ================================================== */
console.log('\nwhat this costs a bus a car is running on');
{
    A.kp.model = A.MODELS[3]; A.kp.node = 0x15;
    ok('the streaming ceiling is under the dash’s own limit', A.KPFX_MAX_FPS < A.KPFX_BUDGET && A.KPFX_BUDGET <= 24);
    const still = A.kpfxBake(boot([step('solid', { secs: 3 })]), 5, A.KPFX_MAX_FPS, 0x15);
    ok('a still step is one frame, and the settle is one more', still.filter(b => b.why === 'rings').length === 2, still.length + ' frames');
    let over = [];
    A.KPFX_PRESETS.forEach(d => { const p = A.kpfxPeakRate(A.kpfxBakeBoot(A.kpfxPreset(d.id), 0x15)); if (p > A.KPFX_BUDGET) over.push(d.id + ' = ' + p + '/s'); });
    ok('no ready-made boot ever asks for more frames than the dash allows', !over.length, over.join(', '));
    let overFx = [];
    A.KPFX.forEach(e => { const p = A.kpfxPeakRate(A.kpfxBake(boot([step(e.id, { secs: 6 })]), 6, A.KPFX_MAX_FPS, 0x15)); if (p > A.KPFX_BUDGET) overFx.push(e.id + ' = ' + p + '/s'); });
    ok('nor does any effect held for six seconds', !overFx.length, overFx.join(', '));
    const rain = A.kpfxBake(boot([step('rainbow', { secs: 6 })]), 6, A.KPFX_MAX_FPS, 0x15).filter(b => b.why === 'rings');
    let dupes = 0;
    for (let i = 1; i < rain.length; i++) if (A.kpfxSameData(rain[i].f.data, rain[i - 1].f.data)) dupes++;
    ok('no frame is ever sent twice in a row, and a moving effect still streams', dupes === 0 && rain.length > 4, dupes + ' repeats, ' + rain.length + ' frames');
    ok('the streamer keeps its own rolling one-second window', /win\s*=\s*win\.filter[\s\S]{0,220}win\.length\s*>=\s*KPFX_BUDGET/.test(SHOW));
    ok('it updates a counter, it does not rebuild the page', (() => {
        const loop = SHOW.slice(SHOW.indexOf('while (!kpfxLive.stop'), SHOW.indexOf('Leave it somewhere deliberate'));
        return loop.length > 300 && !/kpfxRender(Props|Rail|Time|All)\(\)/.test(loop) && /kpfxLiveLine\(\)/.test(loop); })());
    ok('and it gives the dash back whatever happens', /finally\s*\{[\s\S]{0,200}kpwRestoreDash\(\)/.test(SHOW));
}

/* === 10. a boot saved is a boot restored ================================ */
console.log('\na boot saved is a boot restored');
{
    const d = A.kpfxDefaultShow();
    ok('the default is a real ready-made boot', A.kpfxPresetMatch(d) === 'ignition', String(A.kpfxPresetMatch(d)));
    ok('normalising the default changes nothing', JSON.stringify(A.kpfxNormalise(d)) === JSON.stringify(d));
    ok('a missing boot becomes the default', JSON.stringify(A.kpfxNormalise(null)) === JSON.stringify(d));
    const junk = A.kpfxNormalise({ steps: new Array(20).fill({ fx: 'nope', secs: 99, color: 'octarine', k1: 7 }), idle: { fx: 'wipe' } });
    ok('a boot cannot be longer than the strip can show', junk.steps.length === A.KPFX_MAX_STEPS);
    ok('a step nobody recognises becomes a real step with a sane length and a real colour',
       junk.steps.every(s => A.kpfxDef(s.fx).id === s.fx && s.secs >= 0.2 && s.secs <= 8 && A.kpfxRingColour(s.color)), JSON.stringify(junk.steps[0]));
    ok('a direction out of range is pulled back', junk.steps[0].k1 >= 0 && junk.steps[0].k1 <= 3, String(junk.steps[0].k1));
    ok('every step comes back with a speed, even one saved before there was one',
       junk.steps.every(s => s.speed === 1), JSON.stringify(junk.steps[0]));
    const spd = A.kpfxNormalise({ steps: [{ fx: 'wipe', secs: 1, speed: 99 }, { fx: 'scan', secs: 1, speed: 0.01 }, { fx: 'fire', secs: 1, speed: 2.5 }] });
    ok('and a speed out of range is pulled back to the slider’s ends',
       spd.steps[0].speed === 4 && spd.steps[1].speed === 0.25 && spd.steps[2].speed === 2.5,
       spd.steps.map(s => s.speed).join(', '));
    ok('the rest cannot be a once-through effect', junk.idle.fx === 'buttons', junk.idle.fx);
    const v2 = A.kpfxNormalise({ preset: 'x', main: 'blue', accent: 'white', energy: 40, bl: 'hold',
        startup: [{ fx: 'crank', secs: 1.8 }, { fx: 'sweep', secs: 1.0, k1: 1 }], idle: { fx: 'keys' }, press: { fx: 'ripple' }, alert: { fx: 'alarm' } });
    ok('the shows-and-moments shape loads: its power-up steps, in its main colour',
       v2.steps.length === 2 && v2.steps[0].fx === 'crank' && v2.steps[1].fx === 'sweep' && v2.steps[1].k1 === 1 && v2.steps.every(s => s.color === 'blue'), JSON.stringify(v2.steps));
    const v1 = A.kpfxNormalise({ on: true, off: 30, slots: {
        startup: { layers: [{ fx: 'countdown', speed: 70, amt: 40, a: 'red', b: 'white' }], dur: 3300, bl: 'pulse' },
        idle: { layers: [{ fx: 'comet', speed: 33, a: 'blue' }] }, press: { layers: [{ fx: 'flash' }] }, alert: { layers: [{ fx: 'alarm' }] } } });
    ok('the lanes-of-layers shape loads: its power-up, its length, its colour',
       v1.steps.length === 1 && v1.steps[0].fx === 'countdown' && Math.abs(v1.steps[0].secs - 3.3) < 1e-9 && v1.steps[0].color === 'red', JSON.stringify(v1.steps));
    const v0 = A.kpfxNormalise({ on: true, slots: { startup: { fx: 'boot', speed: 55, dur: 2600 }, idle: { fx: 'keys' } } });
    ok('and the flat one from before that', v0.steps.length === 1 && v0.steps[0].fx === 'sweep', JSON.stringify(v0.steps));
    /* The resting look and the reaction came back on purpose, one at a time,
       once the boot was right — so the old shape's press lane is carried over
       where its name still means something. What stayed out stays out: the
       energy dial, the colour themes, the main/accent pair and the alert lane
       (warnings are a per-key thing on the Design page, ADR-0062). */
    ok('the shows-and-moments shape brings its press lane across', v2.press.fx === 'ripple', JSON.stringify(v2.press));
    ok('but not the dial, the theme or the alert lane it also had',
       !('alert' in v2) && !('main' in v2) && !('energy' in v2) && !('accent' in v2) && !('bl' in v2) && !('preset' in v2),
       Object.keys(v2).join(','));
    ok('a shape from before reactions existed gets the quiet one', v1.press.fx === 'none' && v0.press.fx === 'none');
    ok('and a press effect nobody recognises becomes the quiet one, not a crash',
       A.kpfxNormalise({ steps: [], press: { fx: 'fireworks' } }).press.fx === 'none');
    A.kp.model = A.MODELS[2]; A.kp.name = 'Wheel pad';
    A.kp.show = A.kpfxPreset('startlights');
    A.win.kpfxExportShow();
    const f = A.saved();
    let doc = null;
    try { doc = JSON.parse(f.body); } catch (e) { doc = null; }
    ok('saving writes valid JSON, named after the keypad, with a format and version',
       !!doc && doc.rdm_keypad_show === 5 && /wheel_pad/.test(f.name), f && f.name);
    ok('and the file is named for everything it holds, not just the boot', /_lights\.json$/.test(f.name), f && f.name);
    ok('and loading it back gives the same boot', doc && JSON.stringify(A.kpfxNormalise(doc.show)) === JSON.stringify(A.kp.show));
    const txt = A.kpfxBakeText();
    const rows = txt.split('\n').filter(l => /^\s*\d+\s+0x[0-9A-F]+\s+([0-9A-F]{2} ){7}[0-9A-F]{2}\s*$/.test(l));
    const stray = txt.split('\n').filter(l => l.trim() && !/^#/.test(l) && !/^\s*\d+\s+0x[0-9A-F]+\s+([0-9A-F]{2} ){7}[0-9A-F]{2}\s*$/.test(l));
    ok('the frame script is time, id and eight bytes, or a comment, and nothing else', rows.length > 6 && !stray.length, rows.length + ' rows, ' + stray.length + ' stray');
    ok('it says how to wake the keypad first', /0x000\s+01 15/.test(txt));
    let backwards = 0, last = -1;
    rows.forEach(l => { const ms = parseInt(l.trim(), 10); if (ms < last) backwards++; last = ms; });
    ok('and its times only go forwards', backwards === 0);
}

/* === 10b. what happens after the boot =================================== */
console.log('\nafter the boot: a resting look, and what a press does over it');
{
    A.kp.model = A.MODELS[3];
    const rest = (fx, o) => A.kpfxNormalise(Object.assign({ steps: [step('flash', { secs: 0.5 })], idle: Object.assign({ fx: fx }, o || {}) }));
    /* the default is the honest one: hand the rings back to the buttons */
    ok('out of the box the keypad hands its rings back to the buttons',
       A.kpfxDefaultShow().idle.fx === 'buttons' && A.kpfxDefaultShow().press.fx === 'none');
    ok('a resting look can only be an effect that loops', rest('crank').idle.fx === 'buttons', rest('crank').idle.fx);
    ok('and every looping effect is offered as one, with none of the once-through ones',
       A.kpfxRestable().every(d => !d.once) &&
       A.kpfxRestable().length === A.KPFX.filter(e => !e.once && !e.boot).length,
       A.kpfxRestable().map(d => d.id).join(','));
    ok('handing the rings back is the first thing offered, and the only rest that is not an animation',
       A.kpfxRestable()[0].id === 'buttons' && A.KPFX.filter(d => d.rest).length === 1,
       A.kpfxRestable().map(d => d.id).join(','));
    /* it has a colour and a speed of its own, like a step */
    const scan = rest('scan', { color: 'blue', speed: 2 });
    ok('a resting look carries its own colour and speed', scan.idle.color === 'blue' && scan.idle.speed === 2);
    const at = (sh, t, press) => A.kpfxFrame(A.kp.model, sh, { t: t, press: press });
    const restLed = at(scan, 3).led.filter(Boolean);
    ok('and it is what is playing once the boot is over',
       at(scan, 3).moment === 'rest' && restLed.length > 0 && restLed.every(c => c === 'blue'), restLed.join(','));
    ok('the resting look runs at its own speed, not the boot’s',
       JSON.stringify(at(rest('scan', { speed: 2 }), 1.0).led) === JSON.stringify(at(rest('scan', { speed: 1 }), 1.5).led),
       'a 2x rest at t+0.5 should be a 1x rest at t+1.0');
    /* a reaction is drawn OVER the rest, and only while it is happening */
    const show = A.kpfxNormalise({ steps: [step('flash', { secs: 0.5 })], idle: { fx: 'dark' }, press: { fx: 'flash' } });
    ok('nothing is lit at rest when the resting look is a pause', at(show, 3).led.every(c => !c));
    const pressed = at(show, 3, { i: 4, age: 0.02, held: true });
    ok('a press lights the key it happened on', pressed.moment === 'react' && pressed.press === 4 && !!pressed.led[4],
       pressed.moment + ' ' + pressed.led.join(','));
    ok('and lets go again once it is over', at(show, 3, { i: 4, age: A.KPFX_PRESS_S + 0.2, held: false }).moment === 'rest');
    ok('but not while it is still held', at(show, 3, { i: 4, age: 9, held: true }).moment === 'react');
    ok('a press during the BOOT is ignored — the boot is what is playing',
       at(show, 0.2, { i: 4, age: 0.02, held: true }).moment === 'boot');
    ok('"Nothing" really is nothing',
       at(A.kpfxNormalise({ steps: [], idle: { fx: 'dark' }, press: { fx: 'none' } }), 3, { i: 4, age: 0.02, held: true }).moment === 'rest');
    /* each reaction does something, on every model, and none of them cheats */
    let dead = [], illegal = [];
    A.MODELS.forEach(m => {
        A.kp.model = m;
        const sh = A.kpfxNormalise({ steps: [], idle: { fx: 'dark' }, press: { fx: 'none' } });
        A.KPFX_PRESS.filter(d => d.render).forEach(d => {
            sh.press = { fx: d.id };
            let moved = false;
            for (let a = 0; a <= A.KPFX_PRESS_S; a += 0.05) {
                const fr = A.kpfxFrame(m, sh, { t: 3, press: { i: 0, age: a, held: a < 0.1 } });
                if (fr.led.some(Boolean)) moved = true;
                fr.rgb.forEach(v => { if (!Number.isFinite(v) || v < 0 || v > 255) illegal.push(d.id + '/' + m.id); });
                fr.led.forEach(c => { if (c && A.KPFX_LEDS.indexOf(c) < 0) illegal.push(d.id + '/' + m.id + ' -> ' + c); });
            }
            if (!moved) dead.push(d.id + '/' + m.id);
        });
    });
    ok('every reaction lights something on every keypad', !dead.length, dead.join(', '));
    ok('and none of them draws a colour a ring cannot be', !illegal.length, illegal.slice(0, 3).join('; '));
    A.kp.model = A.MODELS[3];
    /* the one that has to be right: a held key is lit for exactly as long */
    const hold = A.kpfxNormalise({ steps: [], idle: { fx: 'dark' }, press: { fx: 'hold' } });
    ok('"light while held" is lit while held and dark the moment it is let go',
       !!at(hold, 3, { i: 2, age: 5, held: true }).led[2] && !at(hold, 3, { i: 2, age: 0.01, held: false }).led[2]);
    /* the bus: a resting animation streams for as long as the car is on */
    const bake = A.kpfxBake(A.kpfxNormalise({ steps: [], idle: { fx: 'rainbow' } }), 6, A.KPFX_MAX_FPS, 0x15);
    ok('a resting animation is inside the dash’s frame budget', A.kpfxPeakRate(bake) <= A.KPFX_BUDGET, A.kpfxPeakRate(bake) + '/s');
    let overRest = [];
    A.kpfxRestable().forEach(d => {
        const b = A.kpfxBake(A.kpfxNormalise({ steps: [], idle: { fx: d.id, speed: 4 } }), 6, A.KPFX_MAX_FPS, 0x15);
        if (A.kpfxPeakRate(b) > A.KPFX_BUDGET) overRest.push(d.id + ' = ' + A.kpfxPeakRate(b) + '/s');
    });
    ok('even wound all the way up', !overRest.length, overRest.join(', '));
    const still = A.kpfxBake(A.kpfxNormalise({ steps: [], idle: { fx: 'keys' } }), 6, A.KPFX_MAX_FPS, 0x15);
    ok('and handing the rings back costs one frame, not a stream',
       still.filter(b => b.why === 'rings').length === 1, still.length + ' frames');
    /* the file carries all three moments */
    A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6 })], idle: { fx: 'fire', speed: 1.5 }, press: { fx: 'ripple' } });
    A.win.kpfxExportShow();
    const doc = JSON.parse(A.saved().body);
    ok('the file carries the boot, the resting look and the reaction',
       doc.show.steps.length === 1 && doc.show.idle.fx === 'fire' && doc.show.idle.speed === 1.5 && doc.show.press.fx === 'ripple',
       JSON.stringify(doc.show));
    ok('and reading it back gives the same three', JSON.stringify(A.kpfxNormalise(doc.show)) === JSON.stringify(A.kp.show));
    const txt = A.kpfxBakeText();
    ok('the frame script keeps playing past the boot, so a resting animation is in it',
       txt.split('\n').filter(l => /^\s*\d+\s+0x/.test(l)).length > 20);
    /* The header used to promise "the last frame is the keys at rest, and it
       holds". Replay an animation once and stop, and the keypad freezes on
       whatever frame it happened to end on — so the file has to say which of
       the two it is. */
    ok('and it says the tail LOOPS when the resting look is an animation',
       /LOOPS/.test(txt) && /on repeat/.test(txt) && !/last frame is that, and it holds/i.test(txt));
    A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6 })], idle: { fx: 'keys' } });
    const held = A.kpfxBakeText();
    ok('and says it HOLDS when the rings go back to the buttons',
       /last frame is that, and it holds/i.test(held) && !/LOOPS/.test(held));
    A.kp.show = A.kpfxDefaultShow();
}

/* === 10c. "back to the buttons" is the buttons ==========================
   The one that sent this pass back: the boot ended and every assigned key
   lit up in its design colour, on a keypad whose buttons are all momentary
   and therefore all OFF. A rest that lights buttons nobody is holding is a
   picture of a keypad that does not exist — and it is the resting look
   nine boots out of ten end on, so it was the wrong answer nearly always. */
console.log('\nthe rest that hands the rings back shows the BUTTONS');
{
    A.kp.model = A.MODELS[3];
    A.kp.keys = JSON.parse(JSON.stringify(A.DEFAULT_KEYS));
    A.kp.keyOn = {}; A.kp.keyPos = {};
    const sh = A.kpfxNormalise({ steps: [step('flash', { secs: 0.5 })], idle: { fx: 'buttons' } });
    const led = () => A.kpfxFrame(A.kp.model, sh, { t: 2 }).led;
    ok('with every button at rest, nothing is lit', led().every(c => !c), led().join(','));
    /* index 1 of the default keypad is PIT — latching, yellow */
    A.kp.keyOn[1] = true;
    ok('latch one on and that ring — only that ring — takes its colour',
       led()[1] === 'yellow' && led().filter(Boolean).length === 1, led().join(','));
    A.kp.keyOn[1] = false;
    ok('let it go and the ring goes with it', !led()[1]);
    /* index 10 is WIPER: a cycle key whose first position is OFF */
    A.kp.keyPos[10] = 0;
    ok('a multi-position key parked on OFF is dark', !led()[10], String(led()[10]));
    A.kp.keyPos[10] = 2;
    ok('and lit on the colour of the position it is parked on', led()[10] === 'cyan', String(led()[10]));
    A.kp.keyPos = {};
    /* a blinking key blinks on the SCREEN and holds in the FILE */
    A.kp.keyOn[1] = true;                                  /* PIT: latching, yellow, slow blink */
    const liveAt = t => A.kpfxFrame(A.kp.model, sh, { t: t, live: true }).led[1];
    const bakedAt = t => A.kpfxFrame(A.kp.model, sh, { t: t }).led[1];
    ok('a key set to blink blinks in the preview, at the Design page’s own rate',
       liveAt(2.0) !== liveAt(2.0 + 0.75), liveAt(2.0) + ' / ' + liveAt(2.75));
    ok('and does not blink in the file, which has to end on one frame that holds',
       bakedAt(2.0) === 'yellow' && bakedAt(2.75) === 'yellow', bakedAt(2.0) + ' / ' + bakedAt(2.75));
    const bareRest = A.kpfxBake(A.kpfxNormalise({ steps: [], idle: { fx: 'buttons' } }), 6, A.KPFX_MAX_FPS, 0x15);
    ok('so handing the rings back is still ONE frame on the wire, not a stream, blinking key and all',
       bareRest.filter(b => b.why === 'rings').length === 1, bareRest.length + ' frames');
    A.kp.keyOn[1] = false;
    /* the other half of the fix: "Hold your keys" lights every assigned key
       whether its button is on or not, which is a fine way to END a boot and
       a lie about what the keypad is doing afterwards */
    ok('"Hold your keys" is still there for a boot step, and is not the same picture',
       A.kpfxDef('keys').id === 'keys' &&
       A.kpfxRenderStep(A.kp.model, step('keys', { secs: 1 }), 0.5).out.some(v => v > 0));
    ok('but it is not offered as a resting look any more',
       !A.kpfxRestable().some(d => d.id === 'keys'), A.kpfxRestable().map(d => d.id).join(','));
    ok('and every boot ever saved, which spelled the handover "keys", is read as the buttons',
       A.kpfxNormalise({ steps: [], idle: { fx: 'keys' } }).idle.fx === 'buttons');
    ok('the handover cannot be used as a boot STEP — it would be a hole in the boot',
       A.kpfxNormaliseStep({ fx: 'buttons', secs: 1 }).fx !== 'buttons',
       A.kpfxNormaliseStep({ fx: 'buttons', secs: 1 }).fx);
    /* it is what live streaming leaves behind, too */
    ok('and it is what the file holds on its last frame',
       /last frame is that, and it holds/i.test((A.kp.show = A.kpfxNormalise({ steps: [step('wipe', { secs: 0.6 })], idle: { fx: 'buttons' } }), A.kpfxBakeText())));
    A.kp.show = A.kpfxDefaultShow();
    A.kp.keyOn = {};
}

/* === 11. geometry ======================================================= */
console.log('\nthe grid the effects are written against');
{
    A.MODELS.forEach(m => {
        const G = A.kpfxGeom(m);
        let wrong = 0;
        G.k.forEach((k, i) => { if (k.r * m.cols + k.c !== i) wrong++; });
        ok(m.name + ': key index is row-major, the same order as the frame bits', wrong === 0);
        const rim = A.kpfxRim(m.cols, m.rows);
        const inside = m.cols > 2 && m.rows > 2 ? (m.cols - 2) * (m.rows - 2) : 0;
        ok(m.name + ': the outside edge is every key except the inner ones, none twice', new Set(rim).size === rim.length && rim.length === m.rows * m.cols - inside);
    });
}

/* === 12. the picture the boot is painted onto =========================== */
console.log('\nthe picture the boot is painted onto');
{
    A.kp.model = A.MODELS[3]; A.kp.live = false;
    const n = 15, plain = A.kpBuildSvg(), fx = A.kpBuildSvg(true);
    ok('the ordinary keypad picture carries no boot hooks', !/data-fxg=/.test(plain) && !/data-fxs=/.test(plain));
    ok('every key has exactly one lit ring group and two strokes to colour', (fx.match(/data-fxg=/g) || []).length === n && (fx.match(/data-fxs=/g) || []).length === n * 2);
    ok('every key has a cap tint and a legend to light', (fx.match(/data-fxc=/g) || []).length === n && (fx.match(/data-fxi=/g) || []).length >= n - 2);
    ok('the lit rings start dark, so nothing flashes before the first frame', /data-fxg="0" opacity="0"/.test(fx));
}

/* === 13. the page keeps the keypad in front of you ======================
   The shape is the point of this round: the dash designer's three columns,
   so what you are making cannot scroll away while you change it. Checked
   against the markup, because a layout that quietly reverts to one column
   is exactly the regression a re-sync causes. */
console.log('\nthe page keeps the keypad in front of you');
{
    const VIEW = region('<div class="kpb-view" id="kpViewShow">', '<div class="kpb-view" id="kpViewConnection">');
    ok('the boot page is a rail, a stage and an inspector — the dash designer’s shape',
       /class="kp-body"/.test(VIEW) && /id="kpFxRail"/.test(VIEW) && /id="kpFxStage"/.test(VIEW) && /id="kpFxInsp"/.test(VIEW));
    ok('choices on the left, keypad in the middle, properties on the right',
       VIEW.indexOf('kpFxRail') < VIEW.indexOf('kpFxStage') && VIEW.indexOf('kpFxStage') < VIEW.indexOf('kpFxInsp'));
    ok('the keypad is not in a scrolling sheet any more', !/kpb-sheet/.test(VIEW));
    ok('the side panels are the workspace’s own rail and inspector, so they scroll like every other page',
       /class="kp-rail kpfx-rail"/.test(VIEW) && /class="kp-insp kpfx-insp"/.test(VIEW) &&
       /\.kp-rail \{[^}]*overflow-y: auto/.test(SRC) && /\.kp-insp \{[^}]*overflow-y: auto/.test(SRC));
    const CSS = region('/* ---- boot sequence', '/* the 5-step flow strip');
    ok('and the middle column does not scroll — the keypad shrinks to fit instead',
       /\.kpfx-stage \{[^}]*overflow: hidden/.test(CSS) && /\.kpfx-stagewrap svg \{[^}]*max-height: 100%/.test(CSS));
    ok('the reflow rule for narrow windows still catches this page',
       /@media \(max-width: 900px\)[\s\S]{0,400}\.kp-rail \{[^}]*width: 100%/.test(SRC));
    /* the demo: a timeline you can read and drag */
    ok('the sequence is laid out in time, each step as wide as it is long',
       /kpfx-tlseg/.test(SHOW) && /\/ loop\) \* 100/.test(SHOW));
    ok('there is a playhead, and dragging it scrubs', /id='kpFxHead'/.test(SHOW) && /kpfxScrubTo/.test(SHOW) && /mousedown/.test(SHOW));
    const tick = SHOW.slice(SHOW.indexOf('function kpfxTick'), SHOW.indexOf('function kpfxStart()'));
    ok('the clock only paints and moves the playhead — it never rebuilds a panel',
       tick.length > 200 && !/kpfxRender(Rail|Time|Props|All)\(/.test(tick) && /kpfxMoveHead\(\)/.test(tick),
       tick.length + ' chars');
    ok('the playhead moves by one style write, not by re-rendering the timeline',
       /function kpfxMoveHead\(\) \{[\s\S]{0,260}el\.style\.left =/.test(SHOW));
    ok('every effect tile is the effect running on YOUR keypad, at your grid size',
       /data-fxfx=/.test(SHOW) && /kpfxMiniDraw\(cv, kpfxRenderStep\(kp\.model/.test(SHOW));
    ok('the store’s hook after copying a boot between keypads still exists (ADR-0060)',
       /function kpfxRenderInsp\(\) \{ if \(kpfxVisible\(\)\) kpfxRenderAll\(\); \}/.test(SHOW));
}

/* --emit-tape <path>: write a real baked tape where the dash's own native
   test can read it. The two repos meet at this file, and the only way that
   contract stays true is if the C parses the bytes Studio actually produces
   rather than a hand-typed lookalike. See RDM-7_Dash/tests/native/
   test_keypad_lights.c. */
{
    const at = process.argv.indexOf('--emit-tape');
    if (at > 0 && process.argv[at + 1]) {
        A.kp.model = A.MODELS[3]; A.kp.node = 0x15; A.kp.baud = 125; A.kp.name = 'Wheel pad';
        A.kp.blColor = 'amber'; A.kp.blBright = 18;
        /* Start lights: two steps, and the one ready-made boot that drives the
           legend backlight as well as the rings, so the fixture carries both
           frame IDs the player will ever see. */
        A.kp.show = A.kpfxPreset('startlights');
        fs.writeFileSync(process.argv[at + 1], JSON.stringify(A.kpfxDashTape(), null, 1));
        console.log('  wrote ' + process.argv[at + 1]);
    }
}

console.log('');
console.log(fail ? ('  FAILED ' + fail + ' of ' + (pass + fail)) : ('  passed all ' + pass + ' checks'));
console.log('');
process.exit(fail ? 1 : 0);
