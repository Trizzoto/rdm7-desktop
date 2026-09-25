/* The keypad setup wizard, run against a keypad that is not there.
 *
 * The wizard's whole job is to survive a device that lies about nothing but
 * tells you almost nothing either. A CAN keypad on the wrong bit rate is not
 * slow to reach, it is INVISIBLE — identical, from the bus, to one that is
 * unplugged or dead. So every claim the wizard makes has to be earned from
 * evidence, and the three ways it could cheat are all cheap:
 *
 *   - believe a tracker entry that a previous bit rate left behind,
 *   - assume a protocol switch left the keypad on the rate it was on,
 *   - pipeline requests, which this keypad answers by going deaf.
 *
 * All three cost real hours on the bench before the wizard existed (see
 * docs/BLINK_MARINE_PKP2200_CANOPEN_2026-08-28.md), and none of them can be
 * caught by reading the code, because each one LOOKS like it works whenever
 * the keypad happens to be where you guessed.
 *
 * So this runs the shipped code — pulled out of src/tauri-overlay.html, never
 * copied — against a simulated keypad and dash that reproduce each trap on
 * purpose. The simulation is deliberately meaner than the real unit: it goes
 * deaf on overlapping requests, it only answers when the dash's rate matches
 * its own, and it moves itself to the other protocol's factory rate when it
 * is switched, exactly as the real one did.
 *
 * Time is virtual. The wizard's pacing is measured in whole seconds of
 * waiting, and a harness nobody runs because it takes a minute is a harness
 * that stops being true. setTimeout resolves immediately while a virtual
 * clock advances by the requested amount, so the pacing is still MEASURED —
 * see the gap assertions — it just is not sat through.
 *
 *   node tools/check_keypad.js
 */
const fs = require('fs');
const path = require('path');

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
/* The wizard is one contiguous block; take it whole rather than naming its
   thirty functions, so a function added to it is covered without editing
   this list (and a block that gets renamed fails loudly here). */
function region(startMark, endMark) {
    const a = SRC.indexOf(startMark);
    if (a < 0) throw new Error('region start not found: ' + startMark);
    const b = SRC.indexOf(endMark, a);
    if (b < 0) throw new Error('region end not found: ' + endMark);
    return SRC.slice(a, b);
}

const WIZARD = region('/* ══════════════ Set it up for me', '\n        function kpLoadCfg() {');
ok('the wizard block is still where the harness looks for it', WIZARD.length > 8000,
   WIZARD.length + ' chars');

/* ---- the sandbox ------------------------------------------------------ */
/* Everything the extracted code reaches for that is not itself extracted.
   Kept as thin as it can be: the more that is stubbed, the less is tested. */
function makeSandbox(rig) {
    const win = {};
    const doc = { getElementById: () => null, createElement: () => ({ style: {}, classList: { add(){}, remove(){}, contains(){ return false; } } }), body: { appendChild(){} } };

    /* Virtual clock. Timers fire on the real microtask queue (so nothing is
       actually waited for) while the clock jumps forward by the requested
       delay. The wizard only ever has one timer pending at a time — every
       sleep is awaited before the next is created — so firing in scheduling
       order is firing in time order. */
    const clock = { now: 1000, timers: 0 };
    const setTimeoutV = (fn, ms) => {
        clock.timers++;
        return setImmediate(() => { clock.now += (ms || 0); clock.timers--; fn(); });
    };

    const header = `
        var window = __win, document = __doc;
        var Date = { now: function () { return __clock.now; } };
        var setTimeout = __setTimeout;
        var fetch = __fetch;
        var RDM = __rdm, _connectionOk = true;
        var showToast = function () {};
        var kpSaveCfg = function () { __calls.kpSaveCfg++; };
        var kpBusChanged = function () { __calls.kpBusChanged++; };
        var kpUpdateFlowProgress = function () {};
        var kpRenderInspector = function () {}, kpRenderStage = function () {};
    `;
    const body = [
        grabVar('MODELS'),
        grabVar('DEFAULT_KEYS'),
        grabVar('KP_BAUD_CO'),
        grabVar('KP_BAUD_J'),
        grabVar('KP_COL'),
        grabVar('kp'),
        grab('kpCol'),
        grab('kpHex'), grab('kpHex2'), grab('kpHex8'),
        grab('kpIsJ'), grab('kpIds'), grab('kpFmtId'),
        grab('kpSwitchToJ1939Frame'), grab('kpSwitchToCanopenFrame'),
        grabVar('KPW_PROTO_DEFAULTS'),
        grab('kpProvisionSteps'),
        'function kpProvisionFrames(from) { return kpProvisionSteps(from); }',
        WIZARD,
    ].join('\n');
    const footer = `
        return { kp: kp, kpw: kpw, win: window,
                 kpProvisionSteps: kpProvisionSteps,
                 kpSwitchToJ1939Frame: kpSwitchToJ1939Frame,
                 kpSwitchToCanopenFrame: kpSwitchToCanopenFrame,
                 kpwFindJ1939In: kpwFindJ1939In,
                 kpwAbortText: kpwAbortText,
                 kpwRateIdx: kpwRateIdx, kpwRateK: kpwRateK,
                 kpwDiffRows: kpwDiffRows, kpwNeedsChange: kpwNeedsChange,
                 clock: __clock };
    `;
    const calls = { kpSaveCfg: 0, kpBusChanged: 0 };
    const fn = new Function('__win', '__doc', '__clock', '__setTimeout', '__fetch', '__rdm', '__calls',
        header + body + footer);
    const api = fn(win, doc, clock, setTimeoutV, rig.fetch, { mode: 'wifi' }, calls);
    api.calls = calls;
    return api;
}

/* ---- the simulated rig ------------------------------------------------
 *
 * A dash and a keypad on one wire. The keypad only hears the dash when the
 * two are on the same bit rate, which is the entire difficulty being
 * modelled — everything else here exists to make that consequence visible.
 */
function makeRig(o) {
    o = o || {};
    const kpad = {
        present: o.present !== false,
        proto: o.proto || 'canopen',
        baud: o.baud == null ? 125 : o.baud,
        node: o.node == null ? 0x15 : o.node,
        sa: o.sa == null ? 0x21 : o.sa,
        /* Object dictionary, only the parts anything reads. */
        obj: Object.assign({ 0x1009: 'V_03' }, o.obj || {}),
        /* Minimum quiet before it will answer again. The real unit's
           threshold was never measured — only that no gap fails and seconds
           work — so this is a knob, and the tests set it high AND low. */
        quietMs: o.quietMs == null ? 400 : o.quietMs,
        /* The real unit applied a new bit rate at once; its manual says
           power-cycle. Both are modelled because the wizard must not assume. */
        baudTakesEffectNow: o.baudTakesEffectNow !== false,
        keyHeld: !!o.keyHeld,
        lastHeardAt: -1e9,
        deaf: 0,
    };
    const dash = { live: o.dashRate == null ? 2 : o.dashRate, saved: o.dashRate == null ? 2 : o.dashRate,
                   promisc: false, tracker: {}, seq: 0 };
    const RATE_K = [125, 250, 500, 1000];
    const log = { tx: [], config: [], promisc: [], resets: 0 };
    let clockRef = null;   /* wired up after the sandbox exists */

    function now() { return clockRef ? clockRef.now : 0; }
    function record(id, ext, bytes) {
        const k = (ext ? 'x' : 's') + id;
        const e = dash.tracker[k] || { id: id, ext: ext, dlc: 8, count: 0 };
        e.data = bytes.map(b => ('0' + (b & 0xFF).toString(16).toUpperCase()).slice(-2)).join('');
        e.count++;
        e.age_ms = 0;
        dash.tracker[k] = e;
    }
    /* The keypad's ear. Returns the reply bytes, or null for silence. */
    function keypadHears(id, ext, bytes) {
        if (!kpad.present) return null;
        if (RATE_K[dash.live] !== kpad.baud) return null;      /* wrong rate: invisible */
        const t = now(), gap = t - kpad.lastHeardAt;
        kpad.lastHeardAt = t;
        if (gap < kpad.quietMs) { kpad.deaf++; return null; }  /* overlapped: silently dropped */

        if (kpad.proto === 'canopen') {
            if (id === 0x000) return null;                      /* NMT is not acknowledged */
            if (!ext && id === 0x600 + kpad.node) {
                const cmd = bytes[0], idx = bytes[1] | (bytes[2] << 8), sub = bytes[3];
                if (cmd === 0x40) {                             /* read */
                    if (!(idx in kpad.obj)) {
                        /* the real abort captured on the bench */
                        return { id: 0x580 + kpad.node, bytes: [0x80, idx & 0xFF, idx >> 8, sub, 0x00, 0x00, 0x02, 0x06] };
                    }
                    const v = kpad.obj[idx];
                    if (typeof v === 'string') {
                        const b = [0x43, idx & 0xFF, idx >> 8, sub];
                        for (let i = 0; i < 4; i++) b.push(v.charCodeAt(i) || 0);
                        return { id: 0x580 + kpad.node, bytes: b };
                    }
                    return { id: 0x580 + kpad.node, bytes: [0x4F, idx & 0xFF, idx >> 8, sub, v & 0xFF, 0, 0, 0] };
                }
                if (cmd === 0x2F || cmd === 0x2B || cmd === 0x27 || cmd === 0x23) {
                    const val = bytes[4] | (bytes[5] << 8);
                    if (idx === 0xFF20 || (idx === 0x20FF)) { /* not a real object here */ }
                    /* The protocol switch rides in as an SDO write to FF20h. */
                    if (bytes[1] === 0xFF && bytes[2] === 0x20 && sub === 0x01 && bytes[4] === 0x01) {
                        toJ1939();
                        return null;                            /* no ack defined */
                    }
                    if (idx === 0x2010) {                       /* bit rate */
                        const k = { 0x00: 1000, 0x02: 500, 0x03: 250, 0x04: 125, 0x06: 50, 0x07: 20 }[bytes[4]];
                        if (k) { if (kpad.baudTakesEffectNow) kpad.baud = k; kpad.obj[0x2010] = bytes[4]; }
                        return { id: 0x580 + kpad.node, bytes: [0x60, idx & 0xFF, idx >> 8, sub, 0, 0, 0, 0] };
                    }
                    if (idx === 0x2013) {                       /* node id */
                        const ack = { id: 0x580 + kpad.node, bytes: [0x60, idx & 0xFF, idx >> 8, sub, 0, 0, 0, 0] };
                        kpad.node = bytes[4] & 0x7F; kpad.obj[0x2013] = kpad.node;
                        return ack;                             /* acked from the OLD node */
                    }
                    kpad.obj[idx] = val;
                    return { id: 0x580 + kpad.node, bytes: [0x60, idx & 0xFF, idx >> 8, sub, 0, 0, 0, 0] };
                }
            }
            return null;
        }
        /* J1939 — commands are accepted, nothing is ever acknowledged. */
        if (ext && ((id >> 16) & 0xFF) === 0xEF && bytes[0] === 0x04 && bytes[1] === 0x1B) {
            const cmd = bytes[2];
            if (cmd === 0x80) { toCanopen(); return null; }
            if (cmd === 0x6F) {
                const k = { 0x02: 500, 0x03: 250 }[bytes[3]];
                if (k && kpad.baudTakesEffectNow) kpad.baud = k;
                return null;
            }
            if (cmd === 0x70) { kpad.sa = bytes[3] & 0xFF; return null; }
            return null;
        }
        return null;
    }
    /* Switching protocol resets to the DESTINATION protocol's factory
       defaults — the trap the whole wizard is built around. */
    function toJ1939() { kpad.proto = 'j1939'; kpad.baud = 250; kpad.sa = 0x21; }
    function toCanopen() { kpad.proto = 'canopen'; kpad.baud = 125; kpad.node = 0x15; kpad.obj[0x2013] = 0x15; }

    /* A J1939 keypad broadcasts on its own, when a key is pressed. */
    function keypadBroadcast() {
        if (!kpad.present || kpad.proto !== 'j1939') return;
        if (RATE_K[dash.live] !== kpad.baud) return;
        if (!kpad.keyHeld) return;
        record((0x18EFFF00 | kpad.sa) >>> 0, true, [0x04, 0x1B, 0x01, 0x04, 0x01, kpad.sa, 0xFF, 0xFF]);
    }

    async function fetchImpl(url, init) {
        const method = (init && init.method) || 'GET';
        const body = init && init.body ? JSON.parse(init.body) : null;
        const json = (obj, status) => ({
            ok: (status || 200) < 300, status: status || 200,
            json: async () => obj,
        });
        if (url === '/api/can/config' && method === 'GET')
            return json({ bitrate: dash.saved, live: dash.live, promiscuous: dash.promisc, suspended: false });
        if (url === '/api/can/config' && method === 'POST') {
            log.config.push({ t: now(), bitrate: body.bitrate, persist: body.persist !== false });
            dash.live = body.bitrate;
            if (body.persist !== false) dash.saved = body.bitrate;
            return json({ status: 'ok', bitrate: body.bitrate, live: dash.live,
                          persisted: body.persist !== false, deferred: false });
        }
        if (url === '/api/can/promiscuous') {
            log.promisc.push({ t: now(), enable: !!body.enable });
            dash.promisc = !!body.enable;
            return json({ ok: true, promiscuous: dash.promisc });
        }
        if (url === '/api/can/monitor/reset') { log.resets++; dash.tracker = {}; return json({ ok: true, ids: 0 }); }
        if (url === '/api/can/monitor') {
            keypadBroadcast();
            return json({ ids: Object.keys(dash.tracker).map(k => Object.assign({}, dash.tracker[k])), capacity: 64 });
        }
        if (url === '/api/can/send') {
            const bytes = [];
            for (let i = 0; i + 1 < body.data.length; i += 2) bytes.push(parseInt(body.data.substr(i, 2), 16));
            log.tx.push({ t: now(), id: body.id, ext: !!body.extd, bytes: bytes });
            const reply = keypadHears(body.id, !!body.extd, bytes);
            if (reply) record(reply.id, false, reply.bytes);
            return json({ ok: true, id: body.id, dlc: 8 });
        }
        return json({ error: 'unhandled ' + method + ' ' + url }, 404);
    }

    return {
        fetch: fetchImpl, keypad: kpad, dash: dash, log: log,
        bindClock: (c) => { clockRef = c; },
        seedStale: (id, ext, bytes) => record(id, ext, bytes),
    };
}

function boot(o) {
    const rig = makeRig(o);
    const api = makeSandbox(rig);
    rig.bindClock(api.clock);
    return { rig, api };
}
/* Configure the design side — what the wizard is being asked to produce. */
function target(api, t) { Object.assign(api.kp, t); }

/* ======================================================================= */
(async function run() {

console.log('\nfinding a keypad nobody knows the speed of');
for (const k of [125, 250, 500, 1000]) {
    const { rig, api } = boot({ baud: k, node: 0x15, dashRate: 2 });
    await api.win.kpwFind(false);
    ok('finds a CANopen keypad sitting on ' + k + 'k',
       !!api.kpw.found && api.kpw.found.baud === k && api.kpw.found.node === 0x15,
       JSON.stringify(api.kpw.found));
}
{
    const { rig, api } = boot({ node: 0x20, baud: 500, dashRate: 2 });
    api.kp.curNode = 0x20;                      /* Studio remembers where it put it */
    await api.win.kpwFind(false);
    ok('finds one that was moved off the factory node',
       !!api.kpw.found && api.kpw.found.node === 0x20, JSON.stringify(api.kpw.found));
}
{
    const { rig, api } = boot({ present: false });
    await api.win.kpwFind(false);
    ok('reports nothing found when there is nothing there',
       api.kpw.found === null && api.kpw.result && !api.kpw.result.ok);
    ok('and does not blame the user for it',
       /CANopen/.test(api.kpw.result.msg), api.kpw.result.msg);
}

console.log('\na stale tracker entry is not a keypad');
{
    /* The exact false positive the count-not-age design exists to refuse: a
       real, well-formed SDO reply captured at a bit rate we have since left.
       It never updates again, so its count never moves. */
    const { rig, api } = boot({ present: false, dashRate: 2 });
    rig.seedStale(0x595, false, [0x4F, 0x13, 0x20, 0x00, 0x15, 0, 0, 0]);
    const before = rig.dash.tracker['s1429'] ? rig.dash.tracker['s1429'].count : 0;
    await api.win.kpwFind(false);
    ok('a leftover reply from another bit rate is not read as an answer',
       api.kpw.found === null,
       'found: ' + JSON.stringify(api.kpw.found) + ' (seeded count ' + before + ')');
}

console.log('\nit never talks over the keypad');
{
    const { rig, api } = boot({ baud: 500, dashRate: 2, quietMs: 400 });
    await api.win.kpwFind(false);
    const tx = rig.log.tx;
    ok('sent something at all', tx.length > 0, tx.length + ' frames');
    /* Structural, and exact: no two frames closer together than the settle
       time the wizard declares. This is the property the bench proved
       matters; the threshold itself was never measured, so the code's own
       number is what gets held to. */
    const settle = +/var KPW_SETTLE_MS\s*=\s*(\d+)/.exec(SRC)[1];
    let closest = Infinity;
    for (let i = 1; i < tx.length; i++) closest = Math.min(closest, tx[i].t - tx[i - 1].t);
    ok('no two frames are closer than KPW_SETTLE_MS (' + settle + ' ms)',
       closest >= settle, 'closest pair was ' + closest + ' ms apart');
    ok('the keypad never had to drop an overlapping request',
       rig.keypad.deaf === 0, rig.keypad.deaf + ' requests arrived too soon');
    /* And the dash's own rate cap is never provoked. */
    let worst = 0;
    for (let i = 0; i < tx.length; i++) {
        let n = 0;
        for (let j = i; j < tx.length && tx[j].t - tx[i].t < 1000; j++) n++;
        worst = Math.max(worst, n);
    }
    ok('never more than 24 frames in any one second (the gateway cap)', worst <= 24, worst + ' in a second');
}
{
    /* A keypad far fussier than the real one: five seconds of quiet or it
       says nothing at all. It answers the first probe — anything does, after
       a long silence — and then goes deaf for the rest of the conversation.
       Finding it is therefore correct. What must NOT happen is a cheerful
       report at the end: a write nobody acknowledged is a write that did not
       land, and the only dishonest outcome here is a green tick. */
    const { rig, api } = boot({ baud: 500, dashRate: 2, quietMs: 5000 });
    target(api, { proto: 'canopen', baud: 500, node: 0x15 });
    await api.win.kpwFind(false);
    ok('it still answers the first probe after a long silence', !!api.kpw.found);
    await api.win.kpwApplyClick();
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    const writes = api.kpw.steps.find(s => /Write the settings/.test(s.label));
    ok('unanswered writes are counted as unanswered, not as written',
       !!writes && writes.state === 'fail' && /refused or unanswered/.test(writes.detail),
       writes ? writes.state + ' — ' + writes.detail : 'no write step at all');
    ok('and the dash is handed back even so', rig.dash.live === 2 && rig.dash.promisc === false,
       'live ' + rig.dash.live);
}

console.log('\na dash without the gateway says so');
{
    /* Older firmware 404s all three gateway endpoints. Failing one bit rate at
       a time with "could not put the dash on 125k" points at the bus; the
       cause is the dash, and it should be said once, up front. */
    const { rig, api } = boot({ baud: 500, dashRate: 2 });
    const real = rig.fetch;
    rig.fetch = async (url, init) =>
        /promiscuous|can\/send|monitor\/reset/.test(url)
            ? { ok: false, status: 404, json: async () => ({}) }
            : real(url, init);
    const api2 = makeSandbox(rig); rig.bindClock(api2.clock);
    await api2.win.kpwFind(false);
    ok('an out-of-date dash is named as the problem',
       api2.kpw.result && /firmware/i.test(api2.kpw.result.msg), JSON.stringify(api2.kpw.result));
    ok('and it says what to do instead',
       /USB-CAN|setup file/i.test(api2.kpw.result.msg), api2.kpw.result.msg);
    ok('it gives up before walking every bit rate',
       rig.log.config.filter(c => !c.persist).length === 0,
       rig.log.config.length + ' rate changes attempted');
}

console.log('\nthe dash is always given back');
{
    const { rig, api } = boot({ baud: 125, dashRate: 2 });
    await api.win.kpwFind(false);
    ok('after a hunt the dash is back on the rate it was found on', rig.dash.live === 2, 'live ' + rig.dash.live);
    ok('and that rate is the persisted one too', rig.dash.saved === 2, 'saved ' + rig.dash.saved);
    ok('promiscuous mode is turned back off', rig.dash.promisc === false);
    const transient = rig.log.config.filter(c => c.persist);
    ok('the only persisted write is the restore', transient.length === 1 && transient[0].bitrate === 2,
       JSON.stringify(rig.log.config));
    /* One clear per rate it actually tried — it stops as soon as it finds
       something, so the count is "as many as it probed", not a fixed four.
       Without this the next rate inherits the last one's captured frames,
       which is the false positive tested above. */
    const hops = rig.log.config.filter(c => !c.persist).length;
    ok('the tracker was cleared once per bit rate tried',
       rig.log.resets >= hops, rig.log.resets + ' resets for ' + hops + ' rate changes');
}
{
    const { rig, api } = boot({ baud: 125, dashRate: 1 });
    api.kpw.cancel = false;
    const p = api.win.kpwFind(false);
    api.kpw.cancel = true;          /* stop it mid-hunt */
    await p;
    ok('a cancelled hunt still hands the dash back', rig.dash.live === 1 && rig.dash.promisc === false,
       'live ' + rig.dash.live + ' promisc ' + rig.dash.promisc);
}

console.log('\nswitching protocol — the one that cost an afternoon');
{
    /* Keypad is CANopen at 500k. The design wants J1939 at 500k. Switching
       drops it to 250k, J1939's OWN factory rate — not 500k, and not the
       125k a CANopen reader would guess. If the wizard assumes either, it
       loses the keypad here. */
    const { rig, api } = boot({ proto: 'canopen', baud: 500, dashRate: 2, keyHeld: true });
    api.kp.curNode = 0x15;
    await api.win.kpwFind(false);
    ok('found it on CANopen first', api.kpw.found && api.kpw.found.proto === 'canopen');
    target(api, { proto: 'j1939', baud: 500, sa: 0x21 });
    await api.win.kpwApplyClick();
    /* kpwApplyClick fires and forgets; wait for the flow to settle. */
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    ok('the keypad really did move to J1939', rig.keypad.proto === 'j1939', rig.keypad.proto);
    const sw = rig.log.tx.find(f => !f.ext && f.bytes[0] === 0x2B && f.bytes[1] === 0xFF && f.bytes[2] === 0x20);
    ok('it sent the documented switch frame', !!sw, JSON.stringify(rig.log.tx.slice(0, 3)));
    ok('it went looking again afterwards rather than assuming',
       rig.log.config.filter(c => c.t > sw.t).length > 1,
       'rate changes after the switch: ' + rig.log.config.filter(c => c.t > sw.t).length);
    ok('and it found it again at J1939’s own 250k',
       !!api.kpw.found && api.kpw.found.proto === 'j1939' && api.kpw.found.baud === 250,
       JSON.stringify(api.kpw.found));
    ok('the dash still goes back where it started', rig.dash.live === 2 && rig.dash.promisc === false,
       'live ' + rig.dash.live);
}
{
    /* And the other direction — a keypad that came off a MaxxECU. */
    const { rig, api } = boot({ proto: 'j1939', baud: 250, sa: 0x21, dashRate: 2, keyHeld: true });
    await api.win.kpwFind(true);
    ok('a J1939 keypad is found by listening for a key press',
       !!api.kpw.found && api.kpw.found.proto === 'j1939' && api.kpw.found.sa === 0x21,
       JSON.stringify(api.kpw.found));
    target(api, { proto: 'canopen', baud: 500, node: 0x15 });
    await api.win.kpwApplyClick();
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    ok('switching back lands it on CANopen', rig.keypad.proto === 'canopen', rig.keypad.proto);
    ok('and the wizard found it again at CANopen’s own 125k, then moved it',
       rig.keypad.baud === 500, 'keypad ended on ' + rig.keypad.baud + 'k');
}
{
    /* Nothing is pressed, so a J1939 keypad says nothing at all. Silence
       must not be reported as absence-of-keypad-shaped success. */
    const { rig, api } = boot({ proto: 'j1939', baud: 250, dashRate: 2, keyHeld: false });
    await api.win.kpwFind(true);
    ok('a J1939 keypad with no key pressed is honestly not found', api.kpw.found === null);
    ok('and the advice mentions power and wiring',
       /power/i.test(api.kpw.result.msg), api.kpw.result.msg);
}

console.log('\nprogramming one that is already in the right protocol');
{
    const { rig, api } = boot({ proto: 'canopen', baud: 125, node: 0x15, dashRate: 2 });
    target(api, { proto: 'canopen', baud: 500, node: 0x15, blColor: 'white', blBright: 63 });
    await api.win.kpwFind(false);
    await api.win.kpwApplyClick();
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    ok('the keypad ends up on the rate that was asked for', rig.keypad.baud === 500, rig.keypad.baud + 'k');
    ok('the backlight colour was actually written',
       rig.keypad.obj[0x2003] !== undefined || rig.log.tx.some(f => f.bytes[1] === 0x03 && f.bytes[2] === 0x20),
       'no 2003h write in ' + rig.log.tx.length + ' frames');
    ok('it reports success', api.kpw.result && api.kpw.result.ok, JSON.stringify(api.kpw.result));
    ok('and the dash is back on its own rate', rig.dash.live === 2, 'live ' + rig.dash.live);
}
{
    /* Same again, but this keypad obeys its manual: the new rate waits for a
       power-cycle. The wizard must notice and SAY so, not claim it is done. */
    const { rig, api } = boot({ proto: 'canopen', baud: 125, node: 0x15, dashRate: 2,
                                baudTakesEffectNow: false });
    target(api, { proto: 'canopen', baud: 500, node: 0x15 });
    await api.win.kpwFind(false);
    await api.win.kpwApplyClick();
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    ok('a rate that waits for a power-cycle is reported as pending, not done',
       api.kpw.result && api.kpw.result.ok && api.kpw.result.powerCycle === true,
       JSON.stringify(api.kpw.result));
    ok('and the wording tells the user to power-cycle',
       /power-cycle/i.test(api.kpw.result.msg), api.kpw.result.msg);
}
{
    /* Node ID change: every frame has to be addressed where the keypad IS,
       which is not where it is going. */
    const { rig, api } = boot({ proto: 'canopen', baud: 500, node: 0x20, dashRate: 2 });
    api.kp.curNode = 0x20;
    target(api, { proto: 'canopen', baud: 500, node: 0x15 });
    await api.win.kpwFind(false);
    await api.win.kpwApplyClick();
    while (api.kpw.busy) await new Promise(r => setImmediate(r));
    /* Up to and including the write that moves it, every frame has to go to
       0x620 — the node it still answers on. Only AFTER that is 0x615 the
       right place to look, and looking there is how the wizard finds out
       whether the move took effect now or waits for a power-cycle. */
    const sdo = rig.log.tx.filter(f => !f.ext && f.id >= 0x600 && f.id < 0x680);
    const moveAt = sdo.findIndex(f => f.bytes[1] === 0x13 && f.bytes[2] === 0x20 && f.bytes[0] === 0x2F);
    ok('the node-ID write was sent', moveAt >= 0, 'no 2013h write among ' + sdo.length + ' SDO frames');
    ok('every frame up to the move is addressed to the node it answers on',
       sdo.slice(0, moveAt + 1).every(f => f.id === 0x620),
       [...new Set(sdo.slice(0, moveAt + 1).map(f => '0x' + f.id.toString(16)))].join(' '));
    ok('and afterwards it goes and looks at the new node',
       sdo.slice(moveAt + 1).some(f => f.id === 0x615),
       [...new Set(sdo.slice(moveAt + 1).map(f => '0x' + f.id.toString(16)))].join(' '));
    ok('the keypad really moved to the new node', rig.keypad.node === 0x15, '0x' + rig.keypad.node.toString(16));
}

console.log('\nthe order the steps go out in');
{
    const { api } = boot({});
    target(api, { proto: 'canopen', baud: 500, node: 0x30, curNode: 0x15 });
    const steps = api.kpProvisionSteps({ proto: 'canopen', node: 0x15 });
    const kinds = steps.map(s => s.kind);
    ok('the bit rate is the very last thing sent',
       kinds[kinds.length - 1] === 'baud', kinds.join(','));
    ok('the address change comes just before it',
       kinds[kinds.length - 2] === 'addr', kinds.join(','));
    ok('every setting carries a way to read it back',
       steps.filter(s => s.kind === 'setting').every(s => s.verify && s.verify.idx),
       'unverifiable: ' + steps.filter(s => s.kind === 'setting' && !s.verify).map(s => s.note).join('; '));
    const j = api.kpProvisionSteps({ proto: 'j1939', sa: 0x21 });
    ok('J1939 puts the bit rate last too', j[j.length - 1].kind === 'baud', j.map(s => s.kind).join(','));
    ok('and claims no read-back, because J1939 has none',
       j.every(s => !s.verify), 'some J1939 step claims a verify');
}

console.log('\nthe frames themselves');
{
    const { api } = boot({});
    const toJ = api.kpSwitchToJ1939Frame(0x15);
    ok('CANopen→J1939 is 615h: 2B FF 20 01 01',
       toJ.id === 0x615 && !toJ.ext &&
       toJ.data.slice(0, 5).join(',') === [0x2B, 0xFF, 0x20, 0x01, 0x01].join(','),
       JSON.stringify(toJ));
    const toC = api.kpSwitchToCanopenFrame(0x21);
    ok('J1939→CANopen is 18EF2100h: 04 1B 80 00',
       toC.id === 0x18EF2100 && toC.ext &&
       toC.data.slice(0, 4).join(',') === [0x04, 0x1B, 0x80, 0x00].join(','),
       JSON.stringify(toC));
    /* The real broadcast caught on the bench, byte for byte. */
    const hit = api.kpwFindJ1939In({ x408959777: { id: 0x18EFFF21, ext: true, data: '041B010401 21FFFF'.replace(/ /g, ''), count: 1 } });
    ok('the bench’s own key-event frame is recognised', hit && hit.sa === 0x21, JSON.stringify(hit));
    const miss = api.kpwFindJ1939In({ x1: { id: 0x18FEF100, ext: true, data: '0011223344556677', count: 1 } });
    ok('an ordinary J1939 broadcast is not mistaken for one', miss === null, JSON.stringify(miss));
    ok('the bench’s abort code reads back in English',
       /does not exist/.test(api.kpwAbortText(0x06020000)), api.kpwAbortText(0x06020000));
}

console.log('\nwhat the user is shown before anything is written');
{
    const { api } = boot({});
    api.kpw.found = { proto: 'canopen', baud: 125, rateIdx: 0, node: 0x15, sa: 0x21, hw: 'V_03' };
    target(api, { proto: 'j1939', baud: 500, sa: 0x21 });
    const rows = api.kpwDiffRows();
    ok('the diff has a row for the protocol change', rows.some(r => /Protocol/.test(r.what)));
    ok('the protocol row warns that the rate gets reset',
       rows.find(r => /Protocol/.test(r.what)).why.indexOf('factory') > -1,
       rows.find(r => /Protocol/.test(r.what)).why);
    ok('it knows a change is needed', api.kpwNeedsChange() === true);
    api.kpw.found = { proto: 'j1939', baud: 500, rateIdx: 2, node: 0x15, sa: 0x21, hw: '' };
    ok('and knows when nothing has to move', api.kpwNeedsChange() === false);
}

console.log('\nthe exported file says the same thing the wizard does');
{
    /* A file and a wizard that disagree about what programming this keypad
       means is how the two paths quietly diverge. */
    const txt = SRC.slice(SRC.indexOf('function kpProvisionText'), SRC.indexOf('window._kpProvisionPreview'));
    ok('the file is written from the switch-frame constants, not literals',
       /_fmtSwitch\(/.test(txt) && /kpSwitchToJ1939Frame|kpSwitchToCanopenFrame/.test(txt));
    ok('it warns that the destination protocol has its OWN factory rate',
       /factory rate/.test(txt), 'no mention of the destination protocol rate');
    /* The header used to be a nine-line walkthrough that also pointed back at
       the wizard. The walkthrough belongs in the guide; what the file cannot be
       sent correctly WITHOUT has to stay in it, because the file travels on its
       own to a USB-CAN tool. */
    ok('it still says to send at the keypad’s current speed', /CURRENT speed/.test(txt));
    ok('...that order matters and the speed change is last', /Top to bottom/.test(txt) && /speed change is last/.test(txt));
    ok('...and that node and protocol changes need a power-cycle', /need a power-cycle/i.test(txt));
    const head = txt.slice(txt.indexOf('var out = ['), txt.indexOf('_fmtSwitch'));
    const comments = (head.match(/"#[^"]*"/g) || []).length;
    ok('but the header is facts, not a walkthrough', comments <= 8, comments + ' comment lines in the header');
}

/* ---- the redesign, and the clutter it removed ------------------------- */
/* This workspace was one screen carrying a model picker, an ECU picker, a
   connection panel, a lighting fold, a five-step progress strip, the keypad,
   a per-key inspector AND a five-paragraph ECU explainer repeated under every
   key. It is four sections now. None of that is expressible as a unit test,
   but the things that made it cluttered are countable, and counting them is
   what stops them coming back one reasonable-looking sentence at a time. */
/* Comments are where the reasoning lives, and this file's reasoning names the
   exact sentences it removed. Searching them alongside the code would make
   every "we no longer say X" check fail on its own explanation — so the prose
   checks below read the source with block comments blanked out, keeping line
   count intact. Same trick, and the same reason, as check_controls.js. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

console.log('\nthe workspace is sections, not one screen');
{
    const OVERLAY = CODE;
    const secs = /var KP_SECS = \[([\s\S]*?)\];/.exec(OVERLAY);
    ok('there is a section list', !!secs);
    const ids = [...secs[1].matchAll(/id:\s*"([a-z]+)"/g)].map(m => m[1]);
    /* Live stopped being a section: Design IS the live picture, so the tab that
       showed the same keypad with the simulator running — and locked the panel
       while you watched it — had nothing left to be. */
    ok('the four sections are design, boot, connection and ecu',
       ids.join(',') === 'design,show,connection,ecu', ids.join(','));
    ok('and there is no Live tab to switch to any more',
       !/label:\s*"Live"/.test(secs[1]) && !/configuration locked/.test(OVERLAY),
       'a Live section or its locked-panel message is still there');
    ok('the five-step flow strip is gone',
       !/kpFlowJump/.test(OVERLAY) && !/id="kpSteps"/.test(OVERLAY),
       'kpFlowJump or #kpSteps is still in the overlay');
    ok('Live is a section rather than a mode toggle in the chrome',
       !/id="kpBtnLive"/.test(OVERLAY), '#kpBtnLive still exists');
    ok('the workspace wears the brand bar', /class="kpb-bar"/.test(OVERLAY));
    /* Two bands now, not three: the page band was merged into the tab row, so
       the per-view head renders its meta and action straight into the nav. */
    ok('and a per-view head, rendered into the tab row',
       /function kpRenderPageHead/.test(OVERLAY) &&
       /<div id="kpPageHead"><\/div>/.test(OVERLAY) &&
       /#kpWorkspace \.kpb-nav #kpPageHead \{ display: contents; \}/.test(OVERLAY));
    ok('the page band is gone, not orphaned', !/kpb-page/.test(OVERLAY));
    ok('it re-binds the theme variables rather than restyling every rule',
       /#kpWorkspace \{[\s\S]{0,1600}--gpb-ink:/.test(OVERLAY),
       'no --gpb-* token block scoped to #kpWorkspace');
    /* The lap timer's chrome is deliberately scoped #gpWorkspace. If the
       keypad ever starts matching those selectors instead of carrying its
       own, restyling one workspace silently restyles the other.
       ONE shared block is legitimate — the Industry palette is defined once
       and worn by several scopes — so a selector list naming both is allowed
       only while everything it declares is a custom property. The moment it
       declares a real property, the two surfaces are sharing chrome. */
    const shared = [...OVERLAY.matchAll(/([^{}]*#gpWorkspace[^{}]*)\{([^}]*)\}/g)]
        .filter(m => /#kpWorkspace/.test(m[1]));
    const sharedChrome = shared.filter(m =>
        m[2].split(';').some(d => d.trim() && !d.trim().startsWith('--')));
    ok('anything shared with the lap timer declares tokens only',
       sharedChrome.length === 0,
       sharedChrome.map(m => m[1].trim().replace(/\s+/g, ' ')).join(' | '));
    ok('and it does not borrow the lap timer’s chrome classes',
       !/#kpWorkspace[^{]*\.gpb-(nav|secs|page)\b/.test(OVERLAY));
}

console.log('\nthe writing budget');
{
    /* Two modals mount inside the workspace so they inherit its light theme —
       on the body they were dark boxes over a white page. */
    ok('the wizard modal mounts inside the workspace',
       /\(document\.getElementById\("kpWorkspace"\) \|\| document\.body\)\.appendChild\(d\)/.test(SRC));
    ok('so does the ECU guide',
       /\(document\.getElementById\("kpWorkspace"\) \|\| document\.body\)\.appendChild\(m\)/.test(SRC));

    /* The per-key inspector is the worst place for prose: whatever it says is
       said again for every key on the pad. These five were its paragraphs. */
    const gone = [
        'Think of each button like a',            /* the doorbell metaphor  */
        'Tailored for',                           /* + "change in the sidebar" */
        '7 indicator colours',                    /* explaining a disabled swatch */
        'No warnings yet',                        /* an empty list, at length */
        'Each model keeps its own layout',        /* rail prose               */
        'Not sure? Most ECUs read a Blink keypad' /* rail prose               */
    ];
    gone.forEach(function (s) {
        ok('the inspector no longer says “' + s + '…”', CODE.indexOf(s) < 0);
    });
    /* And the facts those paragraphs carried did not just vanish — they are
       in the tables that replaced them. */
    ok('the frame and the bit are still stated, per key',
       /<tr><td class='k'>Frame<\/td>/.test(SRC) && /<tr><td class='k'>This key<\/td>/.test(SRC));
    ok('the stateless-keypad fact survives, once, on the ECU page',
       /State it keeps/.test(SRC) && /None (\\u2014|—) your ECU counts toggles and positions/.test(SRC));
    /* The panels say what a control IS and what it is SET TO. What it MEANS,
       and what to do about it, is a guide's job — it was sitting on the screen
       forever and being read once. */
    ok('the keypad panels do not explain themselves in prose',
       !/class='kpfx-blurb'/.test(CODE) &&
       !/Studio has to stay open to drive it/.test(CODE) &&
       !/Press a key on the picture to try it/.test(CODE));
    /* Deliberately NOT gone: what each effect does to a real ring is still one
       hover away, on the tile it belongs to. Quiet until asked is the pattern
       this workspace already used for the hardware facts. */
    ok('but what an effect does to a ring is still one hover away',
       /title='" \+ kpfxEsc\(d\.blurb \+ \(d\.hw \? "  ·  On the keypad: "/.test(SRC));
    ok('the backlight explanation survives as a tooltip',
       /Amber and lime light the legend only/.test(SRC));
}

console.log('\nthe gateway the wizard rides on');
{
    /* Firmware side, checked as text: these three are what make the wizard
       possible, and the wizard silently degrades to useless without them. */
    /* The checkout is RDM-7_Dash or "RDM-7 Dash" depending on the machine,
       with the firmware at its root or under Software/. */
    const dashRoot = ['RDM-7_Dash', 'RDM-7 Dash']
        .flatMap(n => [path.join(ROOT, '..', n), path.join(ROOT, '..', n, 'Software')])
        .find(d => fs.existsSync(path.join(d, 'main'))) || path.join(ROOT, '..', 'RDM-7_Dash');
    const canFile = path.join(dashRoot, 'main/net/web_server_can.c');
    if (!fs.existsSync(canFile)) {
        ok('the dash firmware exposes a CAN gateway', false, canFile + ' is missing');
    } else {
        const c = fs.readFileSync(canFile, 'utf8');
        ok('the dash has a raw-transmit endpoint', /\/api\/can\/send/.test(c));
        ok('it refuses the RDM device-bus block', /RDM_BUS_DISCOVERY_ID/.test(c) && /rdm_bus_get_base/.test(c));
        ok('it refuses OBD2 request IDs', /0x7DF/.test(c));
        ok('it caps how fast frames can go out', /TX_MAX_PER_SECOND/.test(c));
        ok('it can clear the tracker', /\/api\/can\/monitor\/reset/.test(c));
        ok('it can accept every ID', /\/api\/can\/promiscuous/.test(c));
        const sys = fs.readFileSync(path.join(dashRoot, 'main/net/web_server_system.c'), 'utf8');
        ok('a bitrate POST now actually applies the rate', /can_change_bitrate\(bitrate\)/.test(sys));
        ok('and can apply one without persisting it', /bool persist/.test(sys));
        const test = fs.readFileSync(path.join(dashRoot, 'main/net/web_server_test.c'), 'utf8');
        ok('the temporary bench endpoint is gone from the test file',
           !/can\/send/.test(test), 'web_server_test.c still registers /api/can/send');
    }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('\nharness threw: ' + (e && e.stack || e)); process.exit(1); });
