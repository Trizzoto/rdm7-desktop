/* Offline, the app must not answer questions about a car it has never seen.
 *
 * Local (Offline) is a virtual dash: transport.js serves /api/layout/*,
 * /api/image|font/list, /api/channels and friends out of localStorage and
 * IndexedDB so the firmware editor works unchanged with nothing plugged in.
 * Everything it does NOT implement — CAN, OBD2, dimmer, fuel, gear, log,
 * odometer, replay, brightness, OTA, system health — fell through to one
 * line at the bottom: `return ok({ ok: true })`. A 200 carrying no data.
 *
 * The editor reads `ok` as "the dash answered", so it then reported a car it
 * had never spoken to. Measured offline, on the dev build:
 *
 *   Trouble Codes   "No codes 🎉", stamped "Last read: 9:27:16 am — stored"
 *   Vehicle Info    "(no response — not all ECUs support VIN)", timestamped
 *   ECU & CAN bus   "CAN bus is not running — The driver is stopped, check
 *                    the dash has power on its CAN pins"
 *
 * Nothing was read. The last one is advice about wiring on hardware that is
 * not plugged in. The route above /api/channels already made this argument
 * for collections — "a stub that says 'sure, fine' is a lie, and the next
 * caller to trust it gets bitten the same way" — and the fallback was that
 * lie for everything else.
 *
 * The fallback is a 503 now, carrying `offline: true` and a reason, which is
 * the branch every one of those callers already had.
 *
 * What is pinned here:
 *   - the fallback says no, and says why
 *   - the routes the offline editor actually needs still come BEFORE it, and
 *     still answer what they used to — measured by running the real router
 *   - screenshot and touch stay 404, because the editor's fallback to the SVG
 *     preview is keyed on that and not on 503
 *   - the three pages that stated car facts now name the state instead
 *
 *   node tools/check_offline.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const TRANSPORT = fs.readFileSync(path.join(ROOT, 'src/transport.js'), 'utf8');
const DIST = path.join(ROOT, 'src/dist/index.html');
const SRC = fs.existsSync(DIST) ? fs.readFileSync(DIST, 'utf8') : '';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}

/* ---- the router, lifted whole ------------------------------------------ */
function grabFn(src, head) {
    const i = src.indexOf(head);
    if (i < 0) throw new Error('not found: ' + head);
    let d = 0, j = src.indexOf('{', i);
    for (let k = j; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}') { d--; if (!d) { j = k + 1; break; } }
    }
    return src.slice(i, j);
}
const ROUTER = grabFn(TRANSPORT, 'async function _localRouteApiCall');

console.log('the fallback says no, and says why');
const tail = ROUTER.slice(ROUTER.lastIndexOf('return {'));
ok('the last thing the router does is refuse', /status:\s*503/.test(tail),
   'it used to be `return ok({ ok: true })` — a 200 with nothing in it');
ok('and it marks itself as the offline stub', /offline:\s*true/.test(tail));
ok('and it carries a sentence a page can print', /error:\s*'[^']{10,}'/.test(tail),
   'without one, every page has to invent its own explanation for silence, ' +
   'and the explanations were about the car');
ok('nothing after it can be reached', ROUTER.slice(ROUTER.lastIndexOf('return {')).indexOf('pathname ===') < 0);

console.log('\nthe routes offline editing needs still answer');

/* Run the real router. Five free names, all stubbed — no IndexedDB, no
   localStorage, no device. */
const store = {};
const LocalTransport = {
    listLayouts: async () => ['default', 'track'],
    listSplashes: async () => ['Boot'],
    loadLayout: async (n) => (n === 'missing' ? null : { name: n, widgets: [], signals: [] }),
    saveLayout: async () => {}, setActiveLayout: async () => {}, deleteLayout: async () => {},
    renameLayout: async () => {}, listImages: async () => [{ name: 'logo' }],
    listFonts: async () => [{ name: 'sora' }], listTracks: async () => [],
    /* One 4 KB image and one 100-character layout key — the numbers the
       storage checks below are written against. */
    getStorageInfo: async () => ({
        layouts: [{ name: 'default', size: 200 }],
        images: [{ name: 'logo', size: 4096 }], fonts: [{ name: 'sora' }],
        totalBytes: 200 + 4096, maxBytes: 5 * 1024 * 1024,
    }),
    getImageData: async () => null, getFontData: async () => null, getTrackData: async () => null,
    setImageData: async () => {}, setFontData: async () => {}, setTrackData: async () => {},
    addImageMeta: async () => {}, addFontMeta: async () => {}, deleteImage: async () => {},
    deleteFont: async () => {}, deleteTrack: async () => {},
    toggleSimulation: async () => {}, getSimulationStatus: async () => ({ enabled: false }),
};
const localStorageStub = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};
/* These are the router's whole outside world. If it grows a sixth name the
   sandbox throws by name rather than quietly testing less. */
const route = new Function('LocalTransport', 'localStorage', 'LOCAL_ACTIVE_KEY',
    'LOCAL_SPLASH_KEY', '_bytesToB64', '_b64ToBytes',
    ROUTER + '\n return _localRouteApiCall;')(
    LocalTransport, localStorageStub, 'rdm7_local_active', 'rdm7_local_splash',
    () => '', () => new Uint8Array());

const seen = [];
async function call(url, method, body) {
    const r = await route(url, method || 'GET', body || null, null);
    seen.push({ url, status: r.status, data: r.data });
    return r;
}

(async () => {
    /* The things the editor asks for on boot and while editing offline. */
    const layouts = await call('/api/layout/list');
    ok('layout list answers with the local store', layouts.status === 200 &&
       layouts.data.layouts.join() === 'default,track' && layouts.data.active === 'default',
       JSON.stringify(layouts));
    const raw = await call('/api/layout/raw?name=default');
    ok('a layout comes back whole', raw.status === 200 && raw.data.name === 'default');
    const missing = await call('/api/layout/raw?name=missing');
    ok('and a layout that is not there is a 404, not a stub',
       missing.status === 404, JSON.stringify(missing));

    const info = await call('/api/device/info');
    ok('device info still answers, and says it is not a dash',
       info.status === 200 && info.data.serial === 'LOCAL' && info.data.offline === true,
       JSON.stringify(info.data));
    ok('and it still carries a screen, so the canvas has a size',
       info.data.display && info.data.display.width === 800 && info.data.display.height === 480);

    const chans = await call('/api/channels');
    ok('channels is an empty collection, not a refusal', chans.status === 200 &&
       Array.isArray(chans.data.channels) && chans.data.channels.length === 0 &&
       chans.data.offline === true,
       'the channel page keys its offline mode off this (ADR-0030) — a 503 ' +
       'here would blank the saved copy');
    const sigs = await call('/api/signals/values');
    ok('so is the signal list', sigs.status === 200 && Array.isArray(sigs.data.signals));
    /* The Storage Manager's meter. It used to answer a fixed used: 0 against
       a made-up 8 MB ceiling, so the one number that page exists to show read
       "0 KB / 8.0 MB used" however much was saved — and every layout in the
       list under it read "0 B". */
    const store2 = await call('/api/storage/info');
    ok('storage reports a budget', store2.status === 200 && store2.data.total > 0);
    ok('and a real amount used, counting the images', store2.data.used === 200 + 4096,
       'stubbed as one 4 KB image plus 100 chars of layout key (×2 for UTF-16); ' +
       'got ' + JSON.stringify(store2.data));
    ok('and free is the difference, not the whole thing',
       store2.data.free === store2.data.total - store2.data.used);
    /* And the number the route hands on, computed for real. Images and fonts
       live in IndexedDB and only their metadata is in localStorage, so
       counting the loop alone made a 40 KB image weigh about sixty bytes. */
    {
        const backing = {
            rdm7_layout_default: 'x'.repeat(100),
            rdm7_images: '[{"name":"logo","size":40960}]',
        };
        const ls = {
            get length() { return Object.keys(backing).length; },
            key: (i) => Object.keys(backing)[i],
            getItem: (k) => (k in backing ? backing[k] : null),
        };
        const real = new Function('localStorage', 'return {\n' +
            grabFn(TRANSPORT, '        async getStorageInfo() {') + ',\n' +
            'listImages: async () => JSON.parse(localStorage.getItem("rdm7_images")),\n' +
            'listFonts: async () => ["sora"] };')(ls);
        const s = await real.getStorageInfo();
        const keysOnly = (100 + '[{"name":"logo","size":40960}]'.length) * 2;
        ok('the image bytes are counted, not just its metadata',
           s.totalBytes === keysOnly + 40960,
           'got ' + s.totalBytes + ', metadata alone would be ' + keysOnly);
        ok('and the layout is still listed with its own size',
           s.layouts.length === 1 && s.layouts[0].name === 'default' && s.layouts[0].size === 200);
    }

    const detailed = await call('/api/layout/list?details=1');
    ok('?details=1 answers with sizes, like the font list already did',
       detailed.status === 200 && detailed.data.layouts[0] &&
       detailed.data.layouts[0].name === 'default' && detailed.data.layouts[0].size === 200,
       JSON.stringify(detailed.data));
    ok('and without it the list is still bare names',
       typeof (await call('/api/layout/list')).data.layouts[0] === 'string');
    const imgs = await call('/api/image/list');
    const fnts = await call('/api/font/list');
    /* Both answer the shape the firmware answers: images as objects, fonts
       as bare family names unless ?details=1 is asked for. */
    ok('images and fonts still list', imgs.status === 200 && fnts.status === 200 &&
       imgs.data.length === 1 && fnts.data.length === 1 && fnts.data[0] === 'sora',
       JSON.stringify([imgs.data, fnts.data]));

    /* Splashes live in the same store, under a prefix. They had no route at
       all, so the picker was empty and the 503 turned that into a red
       "Error loading splash list" every time Splash mode was opened. */
    const spl = await call('/api/splash/list');
    ok('splashes list out of the local layouts', spl.status === 200 &&
       spl.data.splashes.join() === 'Boot' && spl.data.active === 'Boot',
       JSON.stringify(spl.data));
    await call('/api/splash/set', 'POST', { name: 'Boot' });

    /* The two that must stay 404. The editor's live-frame path falls back to
       the SVG preview on a 404; a 503 body is JSON where an image was
       promised, which is the bug the 404 was introduced to fix. */
    const shot = await call('/api/screenshot');
    const touch = await call('/api/touch');
    ok('screenshot and touch are still 404, not 503',
       shot.status === 404 && touch.status === 404,
       JSON.stringify([shot.status, touch.status]));
    const cur = await call('/api/layout/current');
    ok('and so is the live layout, so loadLayout uses /raw', cur.status === 404);

    /* And the device-only families now refuse, by name. */
    const deviceOnly = ['/api/obd2/dtcs', '/api/obd2/vin', '/api/obd2/ecuname',
                        '/api/can/status', '/api/can/config', '/api/canraw/status',
                        '/api/dimmer/config', '/api/brightness', '/api/fuel/status',
                        '/api/gear/config', '/api/log/status', '/api/odometer',
                        '/api/replay/status', '/api/ota/status', '/api/system/health'];
    const answers = [];
    for (const u of deviceOnly) answers.push(await call(u));
    const stillLying = deviceOnly.filter((u, i) =>
        answers[i].status !== 503 || answers[i].data.ok !== false || !answers[i].data.offline);
    ok('every dash-only endpoint refuses instead of agreeing', stillLying.length === 0,
       stillLying.join(', '));
    ok('and every refusal carries the same sentence',
       new Set(answers.map(a => a.data.error)).size === 1 &&
       /no dash/i.test(answers[0].data.error),
       'got ' + JSON.stringify([...new Set(answers.map(a => a.data.error))]));

    /* The old answer, put back through the branch that read it — the two
       lines out of _dtcRefresh that turned "sure, fine" into a clean bill of
       health for a car that was never asked. */
    const oldAnswer = { ok: true };
    const oldCodes = Array.isArray(oldAnswer.codes) ? oldAnswer.codes : [];
    ok('doing it the old way still reads as a clean bill of health',
       oldAnswer.ok === true && oldCodes.length === 0,
       'the fallback was `return ok({ ok: true })`, and an empty list is ' +
       'how Trouble Codes says "No codes 🎉"');

    console.log('\nand the pages that used to speak for the car');
    if (!SRC) {
        console.log('  -- src/dist/index.html is not built, skipping the page half');
    } else {
        const can = grabFn(SRC, 'async function _refreshCanSetup');
        ok('the CAN page stops before it reads a bus that is not there',
           /if \(!info \|\| info\.offline\)/.test(can),
           'it printed "check the dash has power on its CAN pins" with no dash attached');
        /* An en dash: the firmware's placeholders follow the no-em-dash voice rule. */
        ok('and clears the arriving count with it', /set\('canSetupSignals', '–'\)/.test(can));

        const veh = grabFn(SRC, 'async function _vehInfoRefresh');
        ok('Vehicle Info names the state instead of blaming the ECU',
           /vinR && vinR\.offline/.test(veh) && /ecuR && ecuR\.offline/.test(veh));
        ok('and does not stamp a time on a reading it never took',
           /timeEl\.textContent = 'not read'/.test(veh),
           'it printed the current clock time next to two dashes');
        ok('while the on-device wording is untouched',
           /not all ECUs support VIN/.test(veh) && /Mode 09 PID 0x0A unsupported/.test(veh),
           'a real dash never sets offline, so its answers must read as before');

        const dtc = grabFn(SRC, 'async function _dtcRefresh');
        ok('Trouble Codes tells offline apart from broken',
           /data\.offline\s*\n?\s*\?/.test(dtc) || /data\.offline \?/.test(dtc),
           '"Error: Offline" reads like something failed');
        ok('and "No codes" is still only reachable through a real answer',
           dtc.indexOf('No codes') > dtc.indexOf('if (!data.ok)'),
           'the empty-list branch has to sit AFTER the refusal branch');
    }

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
