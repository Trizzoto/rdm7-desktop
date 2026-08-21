/* Does a CAN column come back as a READING, or as counts?
 *
 * Reported 2026-08-20: "the canbus in the graph is all wrong like throttle
 * position 818 and -74, shouldn't it be between 0 and 100. same with ignition
 * timing." Both numbers were real and neither was a reading.
 *
 * The puck stores RAW FIELD COUNTS — one 16-bit slot per channel per sample,
 * ADR-0008, the puck is dumb on purpose. Everything needed to turn a count
 * into a percent (name, unit, scale, offset, signedness) lives in a channel
 * library that comes off a DASH, over HTTP, when you open Setup. It was never
 * written down. So:
 *
 *   - dash in the car + puck on the desk  ->  library empty
 *   - "throttle_position" resolves to nothing
 *   - scale 1, offset 0, no unit, id as the label
 *   - the lane plots 0..744 raw
 *   - gpLaneScale pads the axis by 10% either side  ->  -74 .. 818
 *
 * Every step correct, the answer nonsense. And a second fault underneath it:
 * the node sign-extends a signed field and keeps the low 16 bits
 * (trace_log.c, `s_chan_val[i] = (uint16_t)raw`), while Studio read every slot
 * with getUint16 — so ignition advance at -6 degrees came back as 65530, and a
 * right-hand yaw rate feeding the drift engine came back as about +1300 deg/s.
 *
 * These checks are written against BOTH: the resolver that has to find a
 * definition, and the arithmetic that has to use it.
 *
 *   node tools/check_candecode.js
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

/* `var NAME = ...;` lifted verbatim. Not optional here: the storage keys are
   referenced from inside a try/catch, so a missing one is swallowed and the
   harness silently tests nothing. */
function grabVar(src, name) {
    const re = new RegExp('^        var ' + name + ' = ([^;]+);', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    return m[0].trim();
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

const VARS = ['GP_DASHCHAN_LS', 'GP_MYCHAN_LS'];
const WANT = ['gpN', 'gpMyChans', 'gpDashChansCached', 'gpDashChansCache', 'gpAllChans',
              'gpChanDefsById', 'gpChanFixes', 'gpChanFixApply', 'gpChanFixFor', 'gpChanRawRange', 'gpChanWouldRead', 'gpChanDef', 'gpChanValue', 'gpChanDefsFor',
              'gpLaneRanges', 'gpLaneScale'];

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
               traceChanDefs: null, traceChanIds: null, trace: [], laneR: null };
    ${parts.join('\n')}
    return {
        gp: gp,
        all: gpAllChans, def: gpChanDef, val: gpChanValue,
        forIds: gpChanDefsFor, byId: gpChanDefsById,
        cached: gpDashChansCached, cache: gpDashChansCache,
        scale: gpLaneScale,
        reset: function () {
            gp.dashChans = null; gp.dashChanCache = undefined;
            gp.myChans = null; gp.traceChanDefs = null; gp.laneR = null;
            for (var k in STORE) delete STORE[k];
        },
    };
`)(STORE);

console.log('lifted: ' + WANT.filter(n => missing.indexOf(n) < 0).join(', '));
ok('every function under test was found', missing.length === 0, 'missing: ' + missing.join(', '));

/* ── the dash's own JSON shape ────────────────────────────────────────────
   Copied from RDM-7_Dash channel_to_full_json(): `label` not `name`,
   `units_native` not `unit`, and the decode block nested under `decode`.
   That mismatch is why every dash channel used to arrive at the rack
   unitless. */
const DASH_TPS = {
    id: 'throttle_position', label: 'Throttle Position',
    units_native: '%', units_display: '%', decimals: 0, min: 0, max: 100,
    decode: { can_id: 0x360, bit_start: 0, bit_length: 16,
              scale: 0.1, offset: 0, is_signed: false, endian: 1 },
};
const DASH_TIMING = {
    id: 'ignition_timing', label: 'Ignition Advance',
    units_native: '°BTDC', units_display: '°BTDC', decimals: 1,
    decode: { can_id: 0x361, bit_start: 16, bit_length: 16,
              scale: 0.1, offset: 0, is_signed: true, endian: 1 },
};
/* A channel whose display unit differs from what the decode produces —
   the dash converts kPa to bar for its own screens. */
const DASH_FUEL = {
    id: 'fuel_pressure', label: 'Fuel Pressure',
    units_native: 'kPa', units_display: 'bar', decimals: 1,
    decode: { can_id: 0x362, bit_start: 0, bit_length: 16,
              scale: 1, offset: 0, is_signed: false, endian: 1 },
};

/* ── resolving one column ─────────────────────────────────────────────── */
console.log('\nwhat a column means');
{
    F.reset();
    const d = F.def('throttle_position', DASH_TPS);
    ok('the dash calls it `label`, and that is the name', d.name === 'Throttle Position', d.name);
    ok('the dash calls it `units_native`, and that is the unit', d.unit === '%', '"' + d.unit + '"');
    ok('scale comes off the decode block', d.scale === 0.1, d.scale);
    ok('offset comes off the decode block', d.offset === 0, d.offset);
    ok('and it is known', d.known === true);

    const fp = F.def('fuel_pressure', DASH_FUEL);
    /* scale and offset are defined against the NATIVE unit. Labelling the
       decoded number with the dash's display unit would be wrong by 100. */
    ok('the display unit does not relabel the decoded number', fp.unit === 'kPa', fp.unit);

    const unknown = F.def('throttle_position', null);
    ok('an id nothing describes falls back to the id', unknown.name === 'throttle_position');
    ok('with no scale', unknown.scale === 1);
    ok('no offset', unknown.offset === 0);
    ok('no unit', unknown.unit === '');
    ok('and says it is NOT known', unknown.known === false);

    /* A hand-typed channel uses `name`/`unit`; both spellings have to work. */
    const mine = F.def('my:abc', { id: 'my:abc', name: 'Steering', unit: 'deg',
                                   decimals: 0, decode: { scale: 0.1, offset: -720,
                                                          is_signed: false } });
    ok('a hand-typed channel keeps its own name', mine.name === 'Steering');
    ok('and its own unit', mine.unit === 'deg');
    ok('and a negative offset survives', mine.offset === -720, mine.offset);

    /* Zero scale would flatten a channel to a constant. It is refused at
       entry (gpMyChanCheck), so if one ever reaches here it must not be
       silently turned into 1 by an || — that would draw raw counts under a
       name that promises otherwise. */
    const z = F.def('x', { id: 'x', decode: { scale: 0, offset: 5 } });
    ok('a zero scale is not quietly rewritten to 1', z.scale === 0, z.scale);
}

/* ── the arithmetic ───────────────────────────────────────────────────── */
console.log('\nthe slot, turned back into a reading');
{
    const tps = F.def('throttle_position', DASH_TPS);
    const timing = F.def('ignition_timing', DASH_TIMING);

    ok('a count times its scale is the reading', near(F.val(744, tps), 74.4, 1e-9),
       'got ' + F.val(744, tps));
    ok('and it lands inside 0..100, which is the whole complaint',
       F.val(744, tps) >= 0 && F.val(744, tps) <= 100, 'got ' + F.val(744, tps));
    ok('idle is zero, not something', F.val(0, tps) === 0);

    /* THE SIGNED READ. trace_log.c sign-extends then truncates to uint16;
       reading it back unsigned is how -6 degrees became 6553.0. */
    ok('a negative reading comes back negative', near(F.val(0xFFC4, timing), -6.0, 1e-9),
       'got ' + F.val(0xFFC4, timing));
    ok('not as sixty-five thousand', F.val(0xFFC4, timing) < 0,
       'got ' + F.val(0xFFC4, timing));
    ok('a positive one is untouched', near(F.val(280, timing), 28.0, 1e-9),
       'got ' + F.val(280, timing));
    ok('the boundary belongs to the positive side', near(F.val(32767, timing), 3276.7, 1e-6));
    ok('and one past it is the most negative', near(F.val(32768, timing), -3276.8, 1e-6));

    /* An UNSIGNED channel must not be sign-extended — a 16-bit RPM count of
       40000 is 40000, not -25536. */
    const rpm = F.def('rpm', { id: 'rpm', label: 'RPM', units_native: 'rpm',
                               decode: { scale: 0.25, offset: 0, is_signed: false } });
    ok('an unsigned channel is never sign-extended', near(F.val(40000, rpm), 10000, 1e-9),
       'got ' + F.val(40000, rpm));

    /* Nothing, said as nothing. */
    ok('the stale sentinel is no reading, not 6553.5', F.val(0xFFFF, tps) === null);
    ok('the stale sentinel is no reading on a signed channel either',
       F.val(0xFFFF, timing) === null);
    ok('a missing slot is null', F.val(null, tps) === null);
    ok('an absent slot is null', F.val(undefined, tps) === null);

    /* Cross-check against the node's own arithmetic, for every field width
       it accepts. This is the contract: extract_bits() sign-extends to 32
       bits, then `(uint16_t)raw` keeps the low 16. Reading those 16 bits back
       as int16 must recover the value for ANY bit_len from 1 to 16. */
    let widthFails = [];
    for (let bits = 2; bits <= 16; bits++) {
        const sdef = F.def('t', { id: 't', decode: { scale: 1, offset: 0, is_signed: true } });
        const lo = -(1 << (bits - 1)), hi = (1 << (bits - 1)) - 1;
        for (const v of [lo, lo + 1, -1, 0, 1, hi]) {
            const stored = v & 0xFFFF;              /* what the node writes */
            if (stored === 0xFFFF) continue;        /* -1 collides with STALE, by design */
            const back = F.val(stored, sdef);
            if (back !== v) widthFails.push(bits + 'bit ' + v + ' -> ' + back);
        }
    }
    ok('every signed field width 2..16 survives the round trip',
       widthFails.length === 0, widthFails.slice(0, 6).join('; '));

    /* The one honest hole, stated rather than hidden: a signed -1 is
       indistinguishable from TRACE_CHAN_STALE on the wire. */
    const s1 = F.def('t', { id: 't', decode: { scale: 1, offset: 0, is_signed: true } });
    ok('a signed -1 reads as no-reading, which is the safer of the two',
       F.val(0xFFFF, s1) === null);
}

/* ── the library, when the dash is in the car ─────────────────────────── */
console.log('\nthe library survives the dash being somewhere else');
{
    F.reset();
    ok('with nothing anywhere, nothing resolves', F.all().length === 0);

    /* A session with the dash attached. */
    F.gp.dashChans = [DASH_TPS, DASH_TIMING];
    ok('a live dash supplies the library', F.all().length === 2);
    F.cache(F.gp.dashChans);

    /* Studio closed; opened again at home with only the puck. THIS is the
       reported situation. */
    const stored = STORE['rdm7_gp_dashchans'];
    ok('the library is written down', !!stored, 'nothing stored');
    ok('with a date on it, so the UI can say how old it is',
       !!JSON.parse(stored).at, stored && stored.slice(0, 60));

    /* New Studio, no dash. */
    F.gp.dashChans = null; F.gp.dashChanCache = undefined; F.gp.myChans = null;
    ok('with no dash attached the library still resolves', F.all().length === 2);
    const defs = F.forIds(['throttle_position', 'ignition_timing']);
    ok('and the throttle is decoded', defs[0].known && defs[0].scale === 0.1);
    ok('and the timing is known to be signed', defs[1].signed === true);

    /* A dash that does not answer must never erase what it said before. */
    F.cache(null); F.cache([]);
    F.gp.dashChanCache = undefined;
    ok('a silent dash does not wipe the library', F.all().length === 2, F.all().length);

    /* A recording that carries its own definitions wins for its own ids —
       an imported VBO is the only thing that can describe its columns. */
    F.gp.traceChanDefs = [{ id: 'throttle_position', name: 'Throttle (from file)',
                            unit: '%', decimals: 1, scale: 0.5, offset: 0, signed: false }];
    const own = F.forIds(['throttle_position']);
    ok('a recording’s own definition wins for its own id',
       own[0].name === 'Throttle (from file)' && own[0].scale === 0.5,
       own[0].name + ' / ' + own[0].scale);
    ok('and its signedness travels with it', own[0].signed === false);

    F.gp.traceChanDefs = [{ id: 'ignition_timing', name: 'Timing', unit: '°',
                            decimals: 1, scale: 0.1, offset: 0, signed: true }];
    ok('a saved SIGNED definition is still signed after a round trip',
       F.forIds(['ignition_timing'])[0].signed === true);
}

/* ── the reported numbers, reproduced ─────────────────────────────────── */
console.log('\nthe reported reading, reproduced and then fixed');
{
    F.reset();
    /* One lap of throttle: raw counts 0..744, exactly what the puck logged. */
    const raw = [];
    for (let i = 0; i < 200; i++) raw.push(Math.round(372 + 372 * Math.sin(i / 12)));
    const rows = raw.map(v => ({ can: [v] }));
    F.gp.trace = rows;

    const undecoded = F.def('throttle_position', null);
    const decoded = F.def('throttle_position', DASH_TPS);
    const laneFor = (def) => ({
        id: 'can_throttle_position',
        get: (i) => F.val(rows[i].can[0], def),
    });

    const bad = F.scale(laneFor(undecoded), { from: 0, to: rows.length - 1 });
    ok('undecoded, the axis really does run about -74 to 818',
       Math.round(bad.lo) === -74 && Math.round(bad.hi) === 818,
       Math.round(bad.lo) + ' .. ' + Math.round(bad.hi));
    /* The -74 was never a reading — it is gpLaneScale's 10% breathing room
       under a column that peaked at 744. Worth pinning: the instinct is to
       hunt for a signedness bug, and there isn't one on this channel. */
    ok('the negative end is axis padding, not a sample',
       Math.min.apply(null, raw) >= 0, 'lowest sample ' + Math.min.apply(null, raw));

    const good = F.scale(laneFor(decoded), { from: 0, to: rows.length - 1 });
    ok('decoded, it lands inside 0..100 where a throttle belongs',
       good.hi <= 100 && good.lo >= -10, good.lo.toFixed(1) + ' .. ' + good.hi.toFixed(1));
    ok('and the peak is 74.4%, which is a throttle reading',
       near(Math.max.apply(null, raw) * 0.1, 74.4, 1e-9));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
