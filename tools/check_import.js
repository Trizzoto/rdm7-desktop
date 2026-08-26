/* Does importing a .rdm actually work?
 *
 * It did not, for twelve days. 0.7.0 and 0.7.1 could not import a bundle at
 * all — every attempt died on "Import failed: file is not defined" — and
 * nothing in this repo noticed, because nothing here had ever RUN the import.
 * The merge was clean, check_syntax passed, the offending line was valid
 * JavaScript. It just referenced a `file` that only exists in the firmware's
 * <input type=file> handler, not in the body the overlay extracts out of it
 * (ADR-0048).
 *
 * So this harness runs the real extracted body — sliced out of the BUILT
 * dist, not the overlay — against .rdm bundles it builds itself, with the
 * device and the DOM stubbed. Any ReferenceError the firmware sync introduces
 * into that body now fails here instead of at a customer.
 *
 *   node tools/check_import.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const DIST = path.join(ROOT, 'src/dist/index.html');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};

if (!fs.existsSync(DIST)) {
    console.log('src/dist/index.html — not built, skipped (run tools/merge_overlay.py)');
    process.exit(0);
}
const html = fs.readFileSync(DIST, 'utf8');

/* ── Lift the function out ────────────────────────────────────────────────
 * Brace-matching across a body full of template literals is its own bug
 * farm, so cut between two landmarks instead: the declaration, and the
 * `importRdm` that always follows it. If either moves, say so loudly rather
 * than testing nothing. */
const start = html.search(/\n\s*async function _processRdmBytes\s*\(/);
const end = html.search(/\n\s*function importRdm\s*\(\s*\)/);
if (start < 0 || end < 0 || end <= start) {
    console.log('  FAIL  cannot locate _processRdmBytes .. importRdm in the built dist');
    console.log('        (the overlay block import-rdm-head/tail changed shape — fix this harness)');
    process.exit(1);
}
const source = html.slice(start, end);

/* ── Build a .rdm ─────────────────────────────────────────────────────────
 * Header: "RDM1", u16 version, u16 entry count, flavour at byte 8, rest
 * reserved to 16. Entry: u8 type, u8 name length, name, u32 data length,
 * data. Types: 0 layout, 1 image, 2 font, 3 channel setup. */
function buildRdm(opts) {
    const entries = [];
    const enc = (s) => Buffer.from(s, 'utf8');
    const add = (type, name, data) => {
        const n = enc(name);
        const head = Buffer.alloc(2 + n.length + 4);
        head[0] = type; head[1] = n.length;
        n.copy(head, 2);
        head.writeUInt32LE(data.length, 2 + n.length);
        entries.push(Buffer.concat([head, data]));
    };
    add(0, opts.layoutName || 'Test', enc(JSON.stringify(opts.layout)));
    if (opts.image !== false) add(1, 'logo', Buffer.alloc(64, 7));
    if (opts.font !== false) add(2, 'Manrope Bold', Buffer.alloc(32, 9));
    if (opts.channels) add(3, 'channels.json', enc(opts.channels));

    const header = Buffer.alloc(16);
    enc('RDM1').copy(header, 0);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(entries.length, 6);
    header[8] = opts.flavour === undefined ? 0 : opts.flavour;
    return Buffer.concat([header, ...entries]);
}

const LAYOUT = { name: 'Test', widgets: [{ type: 'meter', x: 0, y: 0 }] };

/* ── Run it ───────────────────────────────────────────────────────────────
 * Every device call answers OK, every DOM call is a no-op, and both the
 * narration and the requests are recorded so a test can assert on either. */
async function run(bytes, o) {
    o = o || {};
    const said = [], asked = [], requested = [];
    const ctx = {
        TextDecoder, TextEncoder, DataView, Uint8Array, Set, JSON, Math, console, Error, Array, Promise,
        updateStatus: (m, isErr) => said.push((isErr ? 'ERR ' : '') + m),
        showToast: (m, kind) => said.push('TOAST:' + (kind || '') + ' ' + m),
        confirmAsync: async (title) => { asked.push(title); return !!o.answerYes; },
        fetch: async (url, init) => {
            requested.push((init && init.method || 'GET') + ' ' + url);
            const body = url.indexOf('/api/storage/info') === 0
                ? '{"total":9240576,"used":0,"free":8941568}'
                : url.indexOf('/api/font/list') === 0
                    ? (o.fontExists ? '["Manrope Bold"]' : '[]')
                    : '{}';
            return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
        },
        _refreshFontList: async () => { },
        pushHistory: () => { },
        firmwareToWebFormat: () => { },
        renderEditor: () => { }, renderSignals: () => { }, updateInspector: () => { },
        refreshStorageInfo: () => { },
        fetchLayoutsKeepCurrent: async () => { },
        localStorage: { removeItem: () => { } },
        currentLayout: null,
    };
    vm.createContext(ctx);
    vm.runInContext(source, ctx, { filename: 'dist:_processRdmBytes' });
    let threw = null;
    try {
        await ctx._processRdmBytes(new Uint8Array(bytes), o.fileName || 'Example.rdm');
    } catch (e) {
        /* The body catches its own failures and narrates them; anything that
           escapes is a harness problem, but record it either way. */
        threw = e;
    }
    return { said: said, asked: asked, requested: requested, threw: threw, layout: ctx.currentLayout };
}

/* A ReferenceError inside the body is swallowed by the body's own try and
   surfaces only as narration — which is exactly how this shipped. Grep the
   narration, not the exception. */
const brokeScope = (r) => r.said.some(s => /is not defined|Import failed/.test(s));

(async () => {
    console.log('\n.rdm import — the extracted body, run for real\n');

    /* 1. The customer's case: a layout-only bundle off the marketplace. */
    {
        const r = await run(buildRdm({ layout: LAYOUT, flavour: 1 }));
        ok('a layout bundle imports without a scope error',
            !brokeScope(r), r.said.filter(s => /not defined|failed/i.test(s)).join(' | '));
        ok('it says what arrived before touching anything',
            r.said.some(s => /Example\.rdm — layout only/.test(s)), r.said[0]);
        ok('it names the file it imported',
            r.said.some(s => /^TOAST:success Imported Example\.rdm/.test(s)),
            r.said[r.said.length - 1]);
        ok('the layout reaches the editor',
            r.layout && r.layout.widgets && r.layout.widgets.length === 1);
        ok('assets and layout go to the device',
            r.requested.some(s => /POST \/api\/image\/upload/.test(s)) &&
            r.requested.some(s => /POST \/api\/font\/upload/.test(s)) &&
            r.requested.some(s => /POST \/api\/layout\/save/.test(s)),
            r.requested.join(' | '));
        ok('a layout-only bundle never asks about channel setup',
            r.asked.length === 0, r.asked.join(' | '));
    }

    /* 2. A full dashboard (ADR-0042) — the flavour that carries channels.json
     *    and reboots the dash, so it must announce itself and must ask. */
    {
        const r = await run(buildRdm({ layout: LAYOUT, flavour: 2, channels: '{"channels":[]}' }));
        ok('a dashboard bundle imports without a scope error', !brokeScope(r));
        ok('it says "full dashboard" up front',
            r.said.some(s => /full dashboard \(includes channel setup\)/.test(s)), r.said[0]);
        ok('it asks before replacing the channel setup',
            r.asked.indexOf('Restore Channel Setup') >= 0, r.asked.join(' | '));
        ok('declining leaves the channel setup alone',
            !r.requested.some(s => /channels\/import/.test(s)), r.requested.join(' | '));
    }

    /* 3. An unmarked older bundle is judged by what it actually carries. */
    {
        const r = await run(buildRdm({ layout: LAYOUT, flavour: 0, channels: '{"channels":[]}' }));
        ok('an unstated bundle carrying channels reads as a dashboard',
            r.said.some(s => /full dashboard/.test(s)), r.said[0]);
        const r2 = await run(buildRdm({ layout: LAYOUT, flavour: 0 }));
        ok('an unstated bundle without them reads as layout only',
            r2.said.some(s => /layout only/.test(s)), r2.said[0]);
    }

    /* 4. Overwriting a font the dash already has is the user's call. */
    {
        const r = await run(buildRdm({ layout: LAYOUT, flavour: 1 }), { fontExists: true });
        ok('an existing font asks before it is overwritten',
            r.asked.indexOf('Font Already Exists') >= 0, r.asked.join(' | '));
        ok('declining skips the upload',
            !r.requested.some(s => /font\/upload/.test(s)), r.requested.join(' | '));
    }

    /* 5. Junk must fail on its own terms, not on a missing variable. */
    {
        const r = await run(Buffer.from('not an rdm file at all', 'utf8'));
        ok('a non-bundle is rejected as a bad file',
            r.said.some(s => /Not a valid \.rdm file/.test(s)) &&
            !r.said.some(s => /is not defined/.test(s)),
            r.said.join(' | '));

        const good = buildRdm({ layout: LAYOUT, flavour: 1 });
        const r2 = await run(good.slice(0, good.length - 20));
        ok('a truncated bundle is rejected as truncated',
            r2.said.some(s => /Truncated/.test(s)) &&
            !r2.said.some(s => /is not defined/.test(s)),
            r2.said.join(' | '));
    }

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
