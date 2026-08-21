/* Correcting a decode after the drive, and the two controls around it.
 *
 * Three things asked for on 2026-08-21, all of them about being able to change
 * your mind after the recording exists:
 *
 *   1. full-screen one panel        — gp.full, and what the mosaic must NOT do
 *                                     while one panel is filling the window
 *   2. fix a wrong CAN decode       — corrections, their two scopes, and the
 *                                     precedence that makes them work at all
 *   3. turn recorded data on/off    — the bulk tick over a column
 *
 * The one that needs the most care is (2). A correction has to beat the
 * definition frozen into the recording at download (ADR-0044), or the freeze
 * turns into a permanent record of a mistake — but it must not beat it by
 * accident, and it must not lose the WIRE position underneath it, because
 * can_id / start bit / width decided which bits the puck copied months ago and
 * are not ours to revise.
 *
 *   node tools/check_chanfix.js
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
/* `var NAME = ...;` lifted verbatim, so the numbers under test are the shipped
   numbers. Two shapes, because the file has both: a literal that ends on its
   own line (often with a trailing comment after the semicolon, which is why
   "up to the first ;\n" does not work), and an array or object spanning many
   lines. The file is CRLF, so nothing here may assume a bare \n. */
function grabVar(src, name) {
    const re = new RegExp('^[ \\t]*var ' + name + '\\s*=\\s*', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    const at = m.index + m[0].length;
    const open = src[at];
    if (open === '[' || open === '{') {
        const close = open === '[' ? ']' : '}';
        let depth = 0, j = at;
        for (; j < src.length; j++) {
            if (src[j] === open) depth++;
            else if (src[j] === close) { depth--; if (depth === 0) { j++; break; } }
        }
        return 'var ' + name + ' = ' + src.slice(at, j) + ';';
    }
    const end = src.indexOf(';', at);
    if (end < 0) throw new Error('unterminated: var ' + name);
    return 'var ' + name + ' = ' + src.slice(at, end) + ';';
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

const VARS = ['GP_CHANFIX_LS', 'GP_MYCHAN_LS', 'GP_DASHCHAN_LS', 'GP_FIX_SCALES', 'GP_CHAN_MAX', 'GP_CHAN_LS'];
const WANT = ['gpN', 'gpMyChans', 'gpDashChansCached', 'gpAllChans',
              'gpChanFixes', 'gpChanFixApply', 'gpChanFixFor', 'gpLogChans',
              'gpChanDefsById', 'gpChanDef', 'gpChanValue', 'gpChanDefsFor',
              'gpChanRawRange', 'gpChanWouldRead', 'gpChanBulkState'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

const parts = [], missing = [];
for (const n of VARS) { try { parts.push(grabVar(src, n)); } catch (e) { missing.push('var ' + n); } }
for (const n of WANT) { try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); } }

const STORE = {};
const F = new Function(`
    var STORE = arguments[0];
    var window = { localStorage: {
        getItem: function (k) { return (k in STORE) ? STORE[k] : null; },
        setItem: function (k, v) { STORE[k] = String(v); },
    } };
    var gp = { dashChans: null, dashChanCache: undefined, myChans: null,
               traceChanDefs: null, traceChanIds: null, trace: [], sessionId: null,
               chanFix: null, laneShow: {} };
    function gpLaneShown(l) { return l && l.__shown !== false; }
    ${parts.join('\n')}
    return {
        gp: gp, STORE: STORE,
        fixes: gpChanFixes, fixFor: gpChanFixFor,
        byId: gpChanDefsById, def: gpChanDef, val: gpChanValue, forIds: gpChanDefsFor,
        raw: gpChanRawRange, would: gpChanWouldRead,
        bulk: gpChanBulkState, SCALES: GP_FIX_SCALES, MAX: GP_CHAN_MAX,
        reset: function () {
            gp.dashChans = null; gp.dashChanCache = undefined; gp.myChans = null;
            gp.traceChanDefs = null; gp.traceChanIds = null; gp.trace = [];
            gp.sessionId = null; gp.chanFix = null;
            for (var k in STORE) delete STORE[k];
        },
    };
`)(STORE);

console.log('lifted: ' + WANT.concat(VARS).filter(n =>
    missing.indexOf(n) < 0 && missing.indexOf('var ' + n) < 0).length + ' of ' +
    (WANT.length + VARS.length));
ok('every function and constant under test was found', missing.length === 0,
   'missing: ' + missing.join(', '));

/* The dash's shape, as channel_to_full_json() emits it. */
const DASH_TPS = {
    id: 'throttle_position', label: 'Throttle Position',
    units_native: '%', decimals: 0,
    decode: { can_id: 0x360, bit_start: 16, bit_length: 16,
              scale: 1, offset: 0, is_signed: false, endian: 1 },
};

/* ── precedence ───────────────────────────────────────────────────────── */
console.log('\nwhich description of a column wins');
{
    F.reset();
    F.gp.dashChans = [DASH_TPS];

    let d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('with nothing else, the library describes it', d.scale === 1 && d.name === 'Throttle Position');

    /* The recording's own frozen definition beats the library — ADR-0044. */
    F.gp.traceChanDefs = [{ id: 'throttle_position', name: 'Throttle Position', unit: '%',
                            decimals: 0, scale: 1, offset: 0, signed: false }];
    d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('a recording carries its own definition', d.scale === 1);

    /* …and a correction beats BOTH. This is the whole point: without it,
       ADR-0044's freeze would preserve a mistake for ever. */
    F.fixes().global['throttle_position'] = { scale: 0.1, unit: '%', decimals: 1, signed: false };
    d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('a correction outranks the frozen definition', d.scale === 0.1, d.scale);
    ok('and outranks the library', F.byId()['throttle_position'].corrected === true);

    /* Per-recording beats global — the narrower statement is the more
       specific one. */
    F.gp.sessionId = 'ses_x';
    F.fixes().bySession['ses_x'] = { throttle_position: { scale: 0.5, unit: '%', decimals: 1 } };
    d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('a per-recording correction beats a global one', d.scale === 0.5, d.scale);
    ok('and gpChanFixFor says which scope is in force',
       F.fixFor('throttle_position').scope === 'session', JSON.stringify(F.fixFor('throttle_position')));

    /* A DIFFERENT recording is not affected by that one's correction. */
    F.gp.sessionId = 'ses_y';
    d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('another recording falls back to the global correction', d.scale === 0.1, d.scale);

    delete F.fixes().bySession['ses_x'];
    delete F.fixes().global['throttle_position'];
    F.gp.sessionId = null;
    d = F.def('throttle_position', F.byId()['throttle_position']);
    ok('removing the correction goes back to what was there', d.scale === 1, d.scale);
}

/* ── what a correction must NOT touch ─────────────────────────────────── */
console.log('\nthe wire position is history, not a setting');
{
    F.reset();
    F.gp.dashChans = [DASH_TPS];
    F.fixes().global['throttle_position'] = { scale: 0.1, unit: '%', decimals: 1, name: 'Pedal' };
    const c = F.byId()['throttle_position'];
    ok('can_id survives a correction', c.decode.can_id === 0x360, c.decode.can_id);
    ok('start bit survives', c.decode.bit_start === 16, c.decode.bit_start);
    ok('width survives', c.decode.bit_length === 16, c.decode.bit_length);
    ok('endianness survives', c.decode.endian === 1, c.decode.endian);
    /* Those three are what gpChanToDevShape sends to the puck. Losing them
       would make a corrected channel un-loggable. */
    ok('so the channel can still be logged after being corrected',
       c.decode.can_id > 0 && c.decode.bit_length >= 1 && c.decode.bit_length <= 16);

    const d = F.def('throttle_position', c);
    ok('the name is corrected', d.name === 'Pedal', d.name);
    ok('the unit is corrected', d.unit === '%', d.unit);
    ok('and it counts as described, so no "not decoded" tag', d.known === true);

    /* A correction that names nothing keeps the library's name rather than
       falling back to the bare id — clearing the box means "no opinion". */
    F.fixes().global['throttle_position'] = { scale: 0.1, name: '' };
    ok('an empty name falls back to the library name',
       F.def('throttle_position', F.byId()['throttle_position']).name === 'Throttle Position');

    /* A unit deliberately cleared must STAY cleared, not fall through
       gpChanDef's unit/units/units_native chain back to the dash's. */
    F.fixes().global['throttle_position'] = { scale: 1, unit: '' };
    ok('a unit cleared on purpose stays cleared',
       F.def('throttle_position', F.byId()['throttle_position']).unit === '',
       '"' + F.def('throttle_position', F.byId()['throttle_position']).unit + '"');
}

/* ── the preview the form is built around ─────────────────────────────── */
console.log('\nwhat it would read, before you commit to it');
{
    F.reset();
    /* A throttle column, raw 0..998 — his real Mount Barker shape. */
    F.gp.traceChanIds = ['throttle_position'];
    F.gp.trace = [];
    for (let i = 0; i < 400; i++) {
        const v = Math.round(499 + 499 * Math.sin(i / 20));
        F.gp.trace.push({ can: [v] });
    }
    F.gp.trace.push({ can: [0xFFFF] });            /* one stale sample */

    const r = F.raw('throttle_position');
    ok('the raw counts are reported as counts', r.lo === 0 && r.hi === 998,
       r.lo + '..' + r.hi);
    ok('the stale sentinel is not counted as a sample', r.n === 400, r.n);
    ok('and it says how many samples that is out of', r.of === 401, r.of);

    let w = F.would(r, 1, 0, false);
    ok('at x1 it reads as counts', w.lo === 0 && w.hi === 998);
    w = F.would(r, 0.1, 0, false);
    ok('at x0.1 it reads like a throttle', near(w.lo, 0) && near(w.hi, 99.8),
       w.lo + '..' + w.hi);
    w = F.would(r, 0.1, -5, false);
    ok('an offset moves both ends', near(w.lo, -5) && near(w.hi, 94.8), w.lo + '..' + w.hi);

    /* A negative scale inverts the reading, so the ends have to swap or the
       preview claims a range that runs backwards. */
    w = F.would(r, -0.1, 0, false);
    ok('a negative scale still reports low-to-high', w.lo < w.hi, w.lo + '..' + w.hi);

    ok('one of the offered scales is the one that fixes it',
       F.SCALES.some(s => near(s.v, 0.1)), F.SCALES.map(s => s.v).join(','));
    ok('and raw counts is offered too, because sometimes it IS counts',
       F.SCALES.some(s => s.v === 1));

    /* Signed. Sign extension REORDERS the samples, so the signed range cannot
       be derived from the unsigned one — it has to be measured. */
    F.gp.traceChanIds = ['ignition_timing'];
    F.gp.trace = [{ can: [280] }, { can: [0xFFC4] }, { can: [10] }];   /* 28.0, -6.0, 1.0 */
    const rs = F.raw('ignition_timing');
    ok('unsigned, the range runs to 65,476', rs.lo === 10 && rs.hi === 0xFFC4,
       rs.lo + '..' + rs.hi);
    ok('signed, it runs from -60', rs.sLo === -60 && rs.sHi === 280, rs.sLo + '..' + rs.sHi);
    const ws = F.would(rs, 0.1, 0, true);
    ok('so a signed preview reads like ignition advance',
       near(ws.lo, -6) && near(ws.hi, 28), ws.lo + '..' + ws.hi);
    const wu = F.would(rs, 0.1, 0, false);
    ok('and read unsigned it is visibly nonsense', wu.hi > 6000, wu.hi);

    ok('a column not in the recording has no preview', F.raw('nope') === null);
    ok('and gpChanWouldRead survives that', F.would(null, 1, 0, false) === null);
}

/* ── corrections reach the numbers, not just the labels ───────────────── */
console.log('\na correction changes what the lane reads');
{
    F.reset();
    F.gp.dashChans = [DASH_TPS];
    F.gp.traceChanIds = ['throttle_position'];
    F.gp.trace = [{ can: [998] }];
    let def = F.forIds(['throttle_position'])[0];
    ok('before: 998 counts reads as 998', F.val(998, def) === 998);
    F.fixes().global['throttle_position'] = { scale: 0.1, unit: '%', decimals: 1 };
    def = F.forIds(['throttle_position'])[0];
    ok('after: it reads 99.8', near(F.val(998, def), 99.8), F.val(998, def));
    ok('and the unit came with it', def.unit === '%');

    /* Signedness is correctable too — that is the fault that turns -6 into
       65530, and it is the one you cannot see without knowing to look. */
    F.fixes().global['throttle_position'] = { scale: 0.1, signed: true };
    def = F.forIds(['throttle_position'])[0];
    ok('a channel can be corrected TO signed', def.signed === true);
    ok('so 0xFFC4 reads -6.0, not 6546.0', near(F.val(0xFFC4, def), -6), F.val(0xFFC4, def));
    F.fixes().global['throttle_position'] = { scale: 0.1, signed: false };
    def = F.forIds(['throttle_position'])[0];
    ok('and corrected back to unsigned again', def.signed === false);
}

/* ── the store ────────────────────────────────────────────────────────── */
console.log('\nthe correction store');
{
    F.reset();
    const fx = F.fixes();
    ok('an empty store still has both scopes', !!fx.global && !!fx.bySession);
    F.STORE['rdm7_gp_chanfix'] = 'not json at all';
    F.gp.chanFix = null;
    ok('a corrupt store does not take the workspace down',
       !!F.fixes().global && !!F.fixes().bySession);
    F.STORE['rdm7_gp_chanfix'] = JSON.stringify({ global: { a: { scale: 2 } } });
    F.gp.chanFix = null;
    ok('a store with no bySession is repaired, not rejected',
       F.fixes().global.a.scale === 2 && !!F.fixes().bySession);
}

/* ── the bulk tick ────────────────────────────────────────────────────── */
console.log('\nturning a column of ticks on and off');
{
    const rows = [
        { dashId: 'a', canLog: true, log: true, lane: { id: 'can_a' } },
        { dashId: 'b', canLog: true, log: false, lane: { id: 'can_b' } },
        { dashId: 'c', canLog: false, log: false, lane: null },
        { id: 'speed', lane: { id: 'speed' } },
    ];
    let st = F.bulk('log', rows);
    ok('only loggable rows count towards the Log tick', st.n === 2, st.n);
    ok('one of two on is the mixed state', st.state === 'some', String(st.state));

    rows[1].log = true;
    ok('all on reads as on', F.bulk('log', rows).state === true);
    rows[0].log = false; rows[1].log = false;
    ok('all off reads as off', F.bulk('log', rows).state === false);

    st = F.bulk('graph', rows);
    ok('the Graph tick counts every row that HAS a lane', st.n === 3, st.n);
    rows[0].lane.__shown = false;
    ok('hiding one makes it mixed', F.bulk('graph', rows).state === 'some');

    ok('a list with nothing eligible offers no tick', F.bulk('log', [{ id: 'x' }]) === null);
    ok('and an empty list offers none either', F.bulk('graph', []) === null);

    /* The cap is the puck's record size, and it is a real limit — the bulk
       action has to know about it rather than tick past it. */
    ok('the puck cap is a number the bulk action can see', F.MAX > 0 && F.MAX <= 64, F.MAX);

    /* Found live 2026-08-21: his dash describes 119 channels and the record
       holds 12, so "every eligible row is ticked" is unreachable — and a tick
       whose state can never be `true` never offers to turn anything OFF.
       Pressing it twice ticked twelve, then ticked the same twelve again. */
    const many = [];
    for (let i = 0; i < 119; i++)
        many.push({ dashId: 'c' + i, canLog: true, log: i < F.MAX, lane: null });
    F.gp.logChans = many.filter(r => r.log).map(r => r.dashId);
    const big = F.bulk('log', many);
    ok('with more channels than the puck holds, a full record reads as ON',
       big.state === true, String(big.state) + ' with ' + big.on + ' of ' + big.n);
    ok('so the tick can still turn them all off again', big.state === true);

    /* Found live: one of his twelve logged channels has no CAN decode, so it
       is not an ELIGIBLE row — yet it is still occupying a slot on the puck.
       Counting only eligible rows left the state at "some" with a full record
       and the tick stuck offering ON. The cap has to be read from the whole
       selection. */
    many[0].canLog = false;
    F.gp.logChans = many.filter(r => r.log).map(r => r.dashId);
    ok('a logged channel that lost its decode still occupies a slot',
       F.bulk('log', many).state === true,
       String(F.bulk('log', many).state) + ' — the record is full, so the ' +
       'only useful action is to clear');
    many[0].canLog = true;

    many[F.MAX - 1].log = false;
    F.gp.logChans = many.filter(r => r.log).map(r => r.dashId);
    ok('one short of the cap is mixed, not full',
       F.bulk('log', many).state === 'some', String(F.bulk('log', many).state));
    many.forEach(r => { r.log = false; });
    F.gp.logChans = [];
    ok('and none ticked is still off', F.bulk('log', many).state === false);
    /* The graph column has no cap, so its rule must NOT change. */
    const g = [{ lane: { id: 'a' } }, { lane: { id: 'b' } }];
    g[0].lane.__shown = false;
    ok('the graph tick is unaffected by the log cap',
       F.bulk('graph', g).state === 'some' && F.bulk('graph', g).full === 2);
}

/* ── full screen, as source text ──────────────────────────────────────── */
console.log('\none panel filling the window');
{
    /* No DOM here, so these are claims about the code that has to be true for
       full screen not to eat the saved arrangement. */
    const layout = grabFrom(src, 'gpGridLayout');
    const idx = layout.indexOf('gp.full');
    /* Stated as offsets rather than as one regex: the file is CRLF, and a
       pattern that pins `return;` to a following `\n` silently stops matching
       the moment the guard grows from a one-liner into a block. */
    const guardRet = idx >= 0 ? layout.indexOf('return;', idx) : -1;
    ok('gpGridLayout leaves the arrangement alone while one panel is full',
       idx >= 0 && guardRet > idx,
       'no early return on gp.full — the measurement pass would write row ' +
       'heights back from a tree whose other panels are not on screen');
    ok('and it returns BEFORE anything is written to g.root',
       guardRet > 0 && guardRet < layout.indexOf('root.sz'),
       'the guard is after the first write');
    /* Found live, 2026-08-21: pinning the canvas to the port made full screen
       WORSE for the case it exists for. Nineteen lanes get 46 px each in the
       mosaic with the page scrolling; crushed into one screen they came out at
       27 px — under the floor, and smaller than before the gesture. The rack
       measured 894 px before and 526 px after. */
    ok('a full-screened panel still gets at least the height it wants',
       /gpNodeWantH\(/.test(layout.slice(idx, idx + 600)),
       'full screen pins the canvas to the port, so a tall rack is SQUEEZED ' +
       'by the very gesture meant to give it room');
    ok('and the page scrolls when that is more than the window',
       /minHeight = want > port[\s\S]{0,80}px/.test(layout),
       'no scroll path — the excess would just be clipped');

    const render = grabFrom(src, 'gpRenderGrid');
    ok('a full-screened panel that no longer exists clears the state',
       /gp\.full = null/.test(render), 'stale gp.full would render nothing at all');
    ok('a SPLIT cannot be full-screened, only a panel',
       /fullHit\.node\.kids/.test(render), 'no leaf check');
    ok('the + Row button is not offered while one panel fills the window',
       /if \(!fullHit\)[\s\S]{0,200}gpb-addrow/.test(render), 'addrow not gated');

    const solo = grabFrom(src, 'gpPanelFull');
    ok('toggling it off is the same call as toggling it on',
       /gp\.full !== id\) \? id : null/.test(solo));
    ok('and it is not written to storage — reopening into one panel would ' +
       'read as a lost layout', !/localStorage/.test(solo));

    /* Esc goes through gpEscapeCaught, which the suite's own capture handler
       asks FIRST. Found live: an ordinary listener fires second, and by then
       Escape has closed the entire workspace — the probe came back with the
       workspace shut and the panel still full. A way in with no way out is
       worse than no way in. */
    const esc = grabFrom(src, 'gpEscapeCaught');
    ok('Esc leaves full screen through gpEscapeCaught, not its own listener',
       /gp\.full[\s\S]{0,120}gpPanelFull\(null\)/.test(esc),
       'a plain document listener fires after the suite has already closed ' +
       'the workspace');
    ok('and the popovers are asked first, because they are the inner thing',
       esc.indexOf('gp.splitMenu') < esc.indexOf('gp.full'),
       'Esc over an open split menu would leave full screen instead of ' +
       'closing the menu');
    ok('it reports that it handled the key, so the workspace does not also close',
       /gpPanelFull\(null\); return true;/.test(esc));
    ok('and no rival Escape listener was left behind',
       !/e\.key !== "Escape" \|\| !gp\.full/.test(src),
       'two handlers for one key');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
