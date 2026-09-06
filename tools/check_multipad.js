/* More than one keypad, run against keypads that are not there.
 *
 * The store used to be keyed by MODEL id, which meant Studio could remember a
 * 2200 and a 3500 and could not remember two 2200s — backwards, because nobody
 * fits one of each and plenty of builds fit two of the same. ADR-0060 makes
 * identity the keypad and the store a list.
 *
 * Three ways that goes wrong, all of them silent:
 *
 *   - the migration. Everybody upgrading has a model-keyed store, and a
 *     migration that drops a keypad drops a customer's afternoon of work. It
 *     runs exactly once, on a shape that will never be written again, so it is
 *     the least-exercised code in the workspace and the most expensive to get
 *     wrong.
 *   - `kp` as a cursor. Every render path reads one global. Selecting a keypad
 *     loads into it and saving writes it back, so a save against the WRONG
 *     entry silently copies one keypad's buttons over another's.
 *   - the address. Two keypads on one node ID is not a conflict anything
 *     reports: both answer, neither works, and it costs a bench afternoon.
 *
 * Runs the shipped code, pulled out of src/tauri-overlay.html, never copied.
 *
 *   node tools/check_multipad.js
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
function span(fromIdx) {
    let i = SRC.indexOf('{', fromIdx), depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return j;
}
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    return SRC.slice(m.index, span(m.index));
}
function grabWin(name) {
    const re = new RegExp('^        window\\.' + name + ' = function\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: window.' + name);
    return SRC.slice(m.index, span(m.index)) + ';';
}
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1;
    while (SRC[i] === ' ') i++;
    const open = SRC[i], close = open === '{' ? '}' : open === '[' ? ']' : null;
    if (!close) throw new Error('var ' + name + ' is not an object/array literal');
    let depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === open) depth++;
        else if (SRC[j] === close) { depth--; if (depth === 0) { j++; break; } }
    }
    return 'var ' + name + ' = ' + SRC.slice(i, j) + ';';
}
function line(re, what) {
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + what);
    return m[0];
}
function region(a, b) {
    const i = SRC.indexOf(a);
    if (i < 0) throw new Error('region start not found: ' + a);
    const j = SRC.indexOf(b, i);
    if (j < 0) throw new Error('region end not found: ' + b);
    return SRC.slice(i, j);
}

/* The lightshow block comes along whole, because a keypad entry carries a
   show and the store normalises it on the way in and out. */
const SHOW = region('/* ══════════════ Lightshow', '\n        var kpRailBuilt = false;');

function build(seedOld, seedNew) {
    const store = {};
    if (seedOld) store['rdm7_keypads_v1'] = JSON.stringify(seedOld);
    if (seedNew) store['rdm7_keypads_v2'] = JSON.stringify(seedNew);
    const localStorage = {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    };
    const noop = () => {};
    const sandbox = {
        window: {}, console, localStorage,
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop } }),
                    body: { appendChild: noop } },
        Math, JSON, Date, Object, Array, String, Number, parseInt, parseFloat, isFinite,
        requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
        performance: { now: () => 0 }, setTimeout, clearTimeout, setInterval, clearInterval,
        showToast: noop,
        kpw: { busy: false, cancel: false }, kpwLinkState: () => 'offline',
        kpwTx: async () => ({ ok: true }), kpwSleep: async () => {},
        kpwTakeDash: async () => {}, kpwRestoreDash: async () => {},
        kpwDashRate: async () => ({ ok: true }), kpwRateIdx: () => 2, KPW_SETTLE_MS: 0,
        _wsDownload: (name, body, mime) => { sandbox.__saved = { name, body, mime }; },
        opt: (v, l, c) => '', _kpAlertChanOptions: () => '',
        /* the render paths a keypad change fans out to — none of them is what
           this harness is about, and stubbing them keeps the store honest */
        kpUpdateChip: noop, kpRenderEcuPage: noop, kpRenderConnection: noop,
        kpRenderLighting: noop, kpRenderStage: noop, kpRenderInspector: noop,
        kpRenderPageHead: noop, kpRenderBar: noop, kpRenderInsp: noop
    };
    const ctx = vm.createContext(sandbox);
    const pre = [
        grabVar('LED_COLORS'),
        line(/^\s*var HEX = \{\}; LED_COLORS\.forEach\([^\n]*$/m, 'the HEX map'),
        grabVar('MODELS'), grabVar('ICONS'), grabVar('DEFAULT_KEYS'), grabVar('KP_COL'),
        line(/^\s*var KP_LS = "rdm7_keypads_v1";[^\n]*$/m, 'the old store key'),
        line(/^\s*var KP_LS2 = "rdm7_keypads_v2";[^\n]*$/m, 'the new store key'),
        grabVar('kp'),
        line(/^\s*var CELL = 104[^\n]*$/m, 'the keypad geometry constants'),
        grab('kpCol'), grab('kpHex'), grab('kpHex2'), grab('kpIsJ'),
        grab('keyAssigned'), grab('_kpEsc'), grab('_kpChanRange'), grab('kpSimVal'),
        grab('_kpAlertHit'), grab('kpActiveAlert'), grab('_kpPositions'), grab('_kpCurPos'),
        grabVar('kpDemo'), grab('kpDemoActive'), grab('kpNow'), grab('kpDemoVal'), grab('kpDemoFor'),
        grab('ledActive'), grab('ledColor'), grab('ledBehavior'),
        grab('kpBrightness'), grab('_kpHexMix'), grab('kpLegendLook'), grab('kpInsertColor'),
        grab('ledBase'), grab('_kpRing'),
        grab('kpFrameMap'), grab('kpIds'), grab('kpSigName'), grab('kpBuildSvg')
    ].join('\n\n');
    const storeCode = [
        grabVar('KP_FIELDS'),
        grab('kpNewId'), grab('kpBlank'), grab('kpSlug'), grab('kpModelOf'),
        grab('kpMigrate'), grab('kpStore'), grab('kpStoreWrite'), grab('kpEntry'),
        grab('kpNextFree'), grab('kpAddrClash'), grab('kpLoadCfg'), grab('kpSaveCfg'),
        /* loading a keypad drops the undo history with it — the stack belongs
           to one keypad, and this file is the one that switches between them */
        line(/^\s*var kpUndoStack = \[\], KP_UNDO_MAX[^\n]*$/m, 'the undo stack'),
        grab('kpSnapshot'), grab('kpUndoPush'), grab('kpUndoClear'), grab('kpRenderUndo'),
        grab('kpAfterKeypadChange'),
        grabWin('kpAddKeypad'), grabWin('kpPickKeypad'), grabWin('kpRenameKeypad'),
        grabWin('kpRemoveKeypad'), grabWin('kpCopyShowTo')
    ].join('\n\n');

    vm.runInContext(pre + '\n\n' + SHOW + '\n\n' + storeCode +
        '\n\nglobalThis.__api = { ' + [
            'kp', 'kpStore', 'kpLoadCfg', 'kpSaveCfg', 'kpMigrate', 'kpNextFree',
            'kpAddrClash', 'kpBlank', 'kpModelOf', 'kpSlug', 'kpEntry',
            'MODELS', 'KP_FIELDS', 'kpfxDefaultShow', 'kpfxNormalise'
        ].map(n => n + ': ' + n).join(', ') + ' };', ctx, { timeout: 20000 });
    sandbox.__api.win = sandbox.window;
    sandbox.__api.raw = store;
    return sandbox.__api;
}

/* === 1. the migration, which runs once and can never be re-run ========== */
console.log('\nthe migration off the model-keyed store');
{
    /* Somebody who used two different models. Both must survive. */
    const A = build({
        pkp2200: { keys: [{ label: 'WHEEL' }], node: 0x15, baud: 500, proto: 'canopen', blColor: 'red' },
        pkp3500: { keys: [{ label: 'CONSOLE' }], node: 0x20, baud: 250, proto: 'canopen' }
    });
    const s = A.kpStore();
    ok('the store is a list now, with a version on it', s.v === 2 && Array.isArray(s.list), JSON.stringify(s.v));
    ok('both saved models come across as keypads', s.list.length === 2,
       s.list.map(e => e.model).join(','));
    ok('each one keeps its own model', s.list.map(e => e.model).join(',') === 'pkp2200,pkp3500',
       s.list.map(e => e.model).join(','));
    ok('and its own buttons', s.list[0].keys[0].label === 'WHEEL' && s.list[1].keys[0].label === 'CONSOLE',
       JSON.stringify(s.list.map(e => e.keys[0].label)));
    ok('and its own bus settings', s.list[0].baud === 500 && s.list[1].baud === 250,
       s.list.map(e => e.baud).join(','));
    ok('and anything else it had saved', s.list[0].blColor === 'red', s.list[0].blColor);
    ok('every migrated keypad gets an identity of its own',
       s.list[0].id && s.list[1].id && s.list[0].id !== s.list[1].id,
       s.list.map(e => e.id).join(','));
    ok('one of them is selected', s.sel === s.list[0].id, s.sel);
    ok('and it is named so it can be told apart', s.list[0].name === 'PKP-2200', s.list[0].name);
    /* Cheap insurance: a downgrade still finds its data. */
    ok('the old store is left where it was, so a downgrade still works',
       !!A.raw['rdm7_keypads_v1'], Object.keys(A.raw).join(','));
    ok('and the migrated list is written down, so it only runs once',
       !!A.raw['rdm7_keypads_v2']);

    /* A first run with nothing saved at all. */
    const B = build(null, null);
    const s2 = B.kpStore();
    ok('a first run gets exactly one keypad', s2.list.length === 1, String(s2.list.length));
    ok('and it is a working one, not an empty shell',
       s2.list[0].keys.length > 0 && !!s2.list[0].show && !!s2.list[0].show.idle,
       JSON.stringify(Object.keys(s2.list[0])));

    /* A junk store must not take the workspace down with it. */
    const C = build(null, null);
    C.raw['rdm7_keypads_v2'] = '{ not json at all';
    ok('a corrupt store falls back rather than throwing',
       C.kpStore().list.length === 1);
    const D = build(null, { v: 2, sel: 'nope', list: [] });
    ok('and so does an empty one', D.kpStore().list.length === 1);
}

/* === 2. kp as a cursor over the list =================================== */
console.log('\none live keypad, many saved');
{
    const A = build({
        pkp2200: { keys: [{ label: 'WHEEL' }], node: 0x15, baud: 500 },
        pkp3500: { keys: [{ label: 'CONSOLE' }], node: 0x20, baud: 250 }
    });
    A.kpLoadCfg();
    ok('opening loads the selected keypad into the live object',
       A.kp.keys[0].label === 'WHEEL' && A.kp.model.id === 'pkp2200',
       A.kp.keys[0].label + '/' + A.kp.model.id);
    ok('and the live object knows which entry it is', !!A.kp.id, String(A.kp.id));

    const other = A.kpStore().list[1].id;
    A.win.kpPickKeypad(other);
    ok('picking another one loads its buttons',
       A.kp.keys[0].label === 'CONSOLE', A.kp.keys[0].label);
    ok('and its model', A.kp.model.id === 'pkp3500', A.kp.model.id);
    ok('and its bus settings', A.kp.baud === 250, String(A.kp.baud));

    /* The bug this shape exists to prevent: editing one and having it land on
       the other. */
    A.kp.keys[0].label = 'EDITED';
    A.kpSaveCfg();
    const first = A.kpStore().list[0].id;
    A.win.kpPickKeypad(first);
    ok('editing one keypad does not touch the other',
       A.kp.keys[0].label === 'WHEEL', A.kp.keys[0].label);
    A.win.kpPickKeypad(other);
    ok('and the edit did land on the one being edited',
       A.kp.keys[0].label === 'EDITED', A.kp.keys[0].label);

    /* Switching models is a change to THIS keypad, not a switch of config. */
    A.kp.model = A.MODELS[0];
    A.kpSaveCfg();
    ok('changing the model changes this keypad’s part, not which one is open',
       A.kpStore().list.length === 2 && A.kp.id === other, String(A.kpStore().list.length));
    ok('and its keys are trimmed to the new model rather than left dangling',
       A.kpStore().list.find(e => e.id === other).keys.length === 4,
       String(A.kpStore().list.find(e => e.id === other).keys.length));

    /* A show belongs to a keypad, not to the app. */
    A.win.kpPickKeypad(first);
    A.kp.show = A.kpfxNormalise({ startup: [], idle: { fx: 'fire' } });
    A.kpSaveCfg();
    A.win.kpPickKeypad(other);
    ok('each keypad keeps its own show',
       A.kp.show.idle.fx !== 'fire', A.kp.show.idle.fx);
    /* One show spanning two panels was rejected; copying a finished one across
       is the actual want — ADR-0060. */
    A.win.kpPickKeypad(first);
    A.win.kpCopyShowTo(other);
    A.win.kpPickKeypad(other);
    ok('and “copy show to” is how you make two match',
       A.kp.show.idle.fx === 'fire', A.kp.show.idle.fx);
    A.win.kpPickKeypad(first);
    A.kp.show = A.kpfxNormalise({ startup: [], idle: { fx: 'rainbow' } });
    A.kpSaveCfg();
    A.win.kpPickKeypad(other);
    ok('and the copy is a copy — changing the source afterwards leaves it alone',
       A.kp.show.idle.fx === 'fire', A.kp.show.idle.fx);
}

/* === 3. addresses, which nothing else will tell you about =============== */
console.log('\ntwo keypads on one bus');
{
    const A = build(null, null);
    A.kpLoadCfg();
    const firstNode = A.kp.node;
    A.win.kpAddKeypad();
    ok('adding a keypad selects the new one', A.kpStore().list.length === 2 && A.kp.id === A.kpStore().list[1].id,
       String(A.kpStore().list.length));
    ok('and it is given the next free node, not the factory one',
       A.kp.node !== firstNode, '0x' + A.kp.node.toString(16) + ' vs 0x' + firstNode.toString(16));
    ok('and the next free source address too', A.kp.sa !== 0x21 || A.kpStore().list[0].sa !== 0x21,
       A.kpStore().list.map(e => e.sa).join(','));
    ok('a second one of the same model is named apart from the first',
       A.kp.name !== A.kpStore().list[0].name,
       A.kpStore().list.map(e => e.name).join(','));

    ok('a free address reports no clash', !A.kpAddrClash('node', 0x55, A.kp.id));
    const clash = A.kpAddrClash('node', firstNode, A.kp.id);
    ok('an address another keypad holds names that keypad',
       clash && clash.node === firstNode, clash && clash.name);
    ok('and a keypad never clashes with itself',
       !A.kpAddrClash('node', A.kp.node, A.kp.id), String(A.kp.node));

    /* The UI must actually refuse it, not just be able to detect it. */
    ok('the Connection page refuses an address another keypad holds',
       /function setAddr\([\s\S]{0,600}kpAddrClash\([\s\S]{0,400}return;/.test(SRC),
       'the node/address field accepts a duplicate');
    ok('and it says whose it is rather than just “invalid”',
       /kpAddrClash\(kpIsJ\(\) \? "sa" : "node"/.test(SRC) && /is also on/.test(SRC),
       'no warning naming the other keypad');
    ok('the setup wizard says to program them one at a time',
       /Program them one at a time/.test(SRC),
       'nothing warns that two factory-fresh keypads are indistinguishable');

    /* Allocation has to keep working when the low addresses are taken. */
    const s = A.kpStore();
    s.list[0].node = 0x15; s.list[1].node = 0x16;
    A.kpStore(); // no-op read
    ok('the next free node skips the ones in use',
       [0x15, 0x16].indexOf(A.kpNextFree('node', 0x15, 0x7F)) < 0,
       '0x' + A.kpNextFree('node', 0x15, 0x7F).toString(16));
}

/* === 4. removing, renaming, and the files that come out ================ */
console.log('\nnaming and removing');
{
    const A = build(null, null);
    A.kpLoadCfg();
    ok('the last keypad cannot be removed', (A.win.kpRemoveKeypad(), A.kpStore().list.length === 1),
       String(A.kpStore().list.length));
    A.win.kpAddKeypad();
    A.win.kpRemoveKeypad();
    ok('but one of two can be', A.kpStore().list.length === 1, String(A.kpStore().list.length));
    ok('and what is left is selected and loaded',
       A.kp.id === A.kpStore().list[0].id, A.kp.id + ' / ' + A.kpStore().list[0].id);

    A.win.kpRenameKeypad('  Wheel pad  ');
    ok('a name is trimmed and kept', A.kp.name === 'Wheel pad', '"' + A.kp.name + '"');
    A.win.kpRenameKeypad('');
    ok('and an empty one falls back to the model rather than blank',
       A.kp.name === A.kp.model.name, '"' + A.kp.name + '"');

    /* Every file describes one keypad, so every filename says which. */
    A.win.kpRenameKeypad('Wheel pad');
    ok('exports are named after the keypad', A.kpSlug() === 'wheel_pad', A.kpSlug());
    A.win.kpRenameKeypad('!!! ***');
    ok('and a name with nothing usable in it falls back to the model id',
       A.kpSlug() === A.kp.model.id, A.kpSlug());
    ok('the export filenames actually use it',
       (SRC.match(/"rdm_keypad_" \+ kpSlug\(\)/g) || []).length >= 5,
       (SRC.match(/"rdm_keypad_" \+ kpSlug\(\)/g) || []).length + ' filenames');
}

console.log('');
console.log(fail ? ('  FAILED ' + fail + ' of ' + (pass + fail)) : ('  passed all ' + pass + ' checks'));
console.log('');
process.exit(fail ? 1 : 0);
