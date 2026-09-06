/* The bottom bar and the footage timeline, in the shapes you chose (ADR-0064).
 *
 * Three transports could be on screen at once before this, and which one you
 * were looking at depended on what you had last clicked. What replaced them is
 * a choice — a bar shape and a panel shape, both stored on this PC — and the
 * parts worth checking without a screen are the ones that are invisible until
 * they are wrong:
 *
 *   - a saved choice this build does not have must fall back, not blank the
 *     bar. A settings key is a string from disk; it can say anything.
 *   - each surface states its own WINDOW. The panel zooms, the bottom bar is
 *     the whole day and never does, the jog is centre-locked on the playhead.
 *     They shared one window before, so Close-up on the panel turned the bar
 *     into a twenty-second strip.
 *   - the gutter's rows must line up with the rows on the right, which means
 *     one row per lane plus the spare — count them.
 *   - a lap band carries data-gp-tllap, which is the attribute the drag
 *     handler steps over. Without it, clicking "lap 4" both jumps to lap 4 and
 *     seeks to the pixel you hit.
 *   - the bar shapes that draw the day must not ALSO print lap and position as
 *     readouts, and the dock's menu must stop offering them.
 *
 *   node tools/check_lookbar.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
/* A multi-line `var NAME = [ … ];` — the two registries are lists of shapes,
   and the point of reading them from the source is that adding a shape to the
   app adds it to this check. */
function grabList(s, name) {
    const re = new RegExp('^        var ' + name + ' = \\[', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    let i = s.indexOf('[', m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === '[') depth++;
        else if (s[j] === ']') { depth--; if (depth === 0) { j += 2; break; } }
    }
    return s.slice(m.index, j);
}

const FNS = ['gpLook', 'gpFilmState', 'gpBarDrawsTime', 'gpTlWinOf', 'gpTlViewOf',
             'gpJog', 'gpTlLanes', 'gpTlLaneName', 'gpTlClipBlockHtml', 'gpTlLapCellHtml',
             'gpTlPanelHtml', 'gpTlInspHtml', 'gpBarTransportHtml', 'gpBarRateHtml',
             'gpBarFootageHtml', 'gpBarClockHtml', 'gpBarOneHtml',
             'gpBarJogHtml', 'gpBarHtml',
             'gpClips', 'gpClipStart', 'gpClipDur', 'gpClipById', 'gpClipCovers',
             'gpClipAtUtc', 'gpTl', 'gpTlSec', 'gpTlUtcAt', 'gpTlSessDur', 'gpTlExtent',
             'gpTlView', 'gpTlStep', 'gpTlClock', 'gpTlCoverage', 'gpTlReadout',
             'gpTlClipTip', 'gpFilmTileAt'];

/* Single-line consts that live beside the functions that read them — taken
   from the source too, so a value edited in the app is the value checked. */
function grabVar(s, name) {
    /* The whole line, trailing comment and all — several of these carry the
       one-line explanation of what the number is, and that is still valid JS. */
    const re = new RegExp('^        var ' + name + ' = [^\n]*$', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const parts = [], missing = [];
for (const v of ['GP_TL_CLOSE_S', 'GP_TL_STEPS',
                 'GP_SVG_START', 'GP_SVG_BACK', 'GP_SVG_FWD', 'GP_SVG_END']) {
    try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); }
}
/* GP_BARS and GP_TLS were registries you picked a shape from. They are gone —
   the recording decides — so there is nothing to lift and grabList is unused
   by this file now. */
try { parts.push(grabFn(src, 'gpNudgeBtn')); } catch (e) { missing.push('gpNudgeBtn'); }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

const REC = 1000000, HZ = 25;

function env(opt) {
    opt = opt || {};
    const secs = opt.secs === undefined ? 600 : opt.secs;
    const rows = [];
    for (let i = 0; i < secs * HZ; i++) rows.push({ t: i * (1000 / HZ), kph: 60 });
    const meta = { id: 'ses_a', recordedAt: REC, dated: 'gps' };
    const store = {};
    const ctx = {
        console, isFinite, Math, Infinity, JSON, String, Array, Object, Number, parseInt, parseFloat,
        gp: {
            clips: [], clipPin: null, video: null,
            trace: rows, traceLaps: opt.laps || [{ from: 0, to: rows.length - 1 }],
            selLap: 0, cmpLap: -1, playIdx: 0, ghostFence: null, tl: null,
            playRate: 1, playing: false, view: 'session',
            sessionId: 'ses_a', sessions: [meta], sessionMeta: meta,
            look: opt.look || null
        },
        window: null,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = v; }
        },
        gpCurSessionMeta: () => meta,
        gpSampleUtc(i) { const r = ctx.gp.trace[i]; return r ? REC + r.t : null; },
        gpLapRange: () => ({ from: 0, to: ctx.gp.trace.length - 1 }),
        gpEsc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;'),
        gpRunWord: (cap) => (cap ? 'Lap' : 'lap'),
        gpTcFmt: (s) => String(Math.round(s)),
        gpPlaySecs: () => 0,
        gpSpanSecs: (rowsA, l) => (l.to - l.from) / HZ,
        gpVideoSources: () => ['start'],
        GP_VSRC_LBL: { log: 'Log', cam: 'Camera', start: 'Together' },
        GP_VSRC_TIP: { log: '', cam: '', start: '' },
        GP_SVG_PLAY: '<svg id=play></svg>', GP_SVG_PAUSE: '<svg id=pause></svg>',
        document: { querySelector: () => null, querySelectorAll: () => [] },
        gpRenderGridSoft() { }, gpRenderDock() { }, gpRenderSetup() { }
    };
    ctx.window = ctx;
    ctx.store = store;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    ctx.add = (o) => {
        const c = Object.assign({
            id: 'c' + (ctx.gp.clips.length + 1), name: 'clip' + (ctx.gp.clips.length + 1),
            path: 'C:/' + (ctx.gp.clips.length + 1) + '.mp4', url: 'file:///x.mp4',
            t0: REC, offsetMs: 0, lane: 0, dur: 60, src: 'start', el: null
        }, o || {});
        ctx.gp.clips.push(c);
        return c;
    };
    return ctx;
}

/* ══ the setting ═════════════════════════════════════════════════════════ */
/* This used to check that a shape read off disk could not empty the bar: the
   settings key was a string an older or newer build had written, and it could
   say anything. There is no key. The bar's shape is read off the RECORDING —
   no film, no ribbon — so the failure mode this section guarded against is
   gone along with the thing that caused it, and what is checked instead is
   that the three states map to the two shapes and nothing else can. */
console.log('what the recording has, and therefore what the bar is');
{
    const E = env();
    E.gp.clips = [];
    E.gp.video = null;
    ok('no footage: readouts, and the day is not drawn',
       E.gpFilmState() === 'none' && E.gpLook().bar === 'classic' &&
       E.gpBarDrawsTime() === false,
       E.gpFilmState() + ' / ' + JSON.stringify(E.gpLook()));
}
{
    const E = env();
    E.add({ t0: REC, dur: 60, synced: false });
    ok('footage nobody has agreed to yet: still readouts',
       E.gpFilmState() === 'unaligned' && E.gpLook().bar === 'classic',
       'auto-placement from the camera clock is a proposal — that clock has ' +
       'been wrong by 2212 days');
}
{
    const E = env();
    E.add({ t0: REC, dur: 60, synced: true });
    ok('footage that has been lined up: the bar carries it',
       E.gpFilmState() === 'ready' && E.gpLook().bar === 'one' &&
       E.gpBarDrawsTime() === true, JSON.stringify(E.gpLook()));
}
{
    const E = env();
    E.add({ t0: REC, dur: 60, synced: true });
    E.add({ t0: REC + 90000, dur: 30, synced: false });
    ok('one section short of agreed holds the whole recording back',
       E.gpFilmState() === 'unaligned',
       'the ask names them together, so it must not disappear on the first yes');
}
{
    const E = env();
    E.add({ t0: REC, dur: 60, synced: true });
    ok('the panel has one shape and the bar has one that draws the day',
       E.gpLook().tl === 'sheet' && E.gpBarHtml('one').length > 20);
}

/* ══ windows ═════════════════════════════════════════════════════════════ */
console.log('\neach surface on its own scale');
{
    const E = env();
    E.gp.tl = { from: 10, to: 20, close: false, snap: true };
    const panel = E.gpTlWinOf({ getAttribute: () => null });
    const bar = E.gpTlWinOf({ getAttribute: (k) => (k === 'data-gp-tlwin' ? 'all' : null) });
    ok('the panel shows the window it was zoomed to',
       panel.from === 10 && panel.to === 20, JSON.stringify(panel));
    ok('the bottom bar shows the whole day whatever the panel is doing',
       bar.from < 1 && bar.to > 590, JSON.stringify(bar));
}
{
    /* This is the bug the split was made for: Close-up follows the playhead
       with a ten-second window. Before ADR-0064 the bar inherited it. */
    const E = env();
    E.gp.tl = { from: null, to: null, close: true, snap: true };
    E.gp.playIdx = 300 * HZ;
    const panel = E.gpTlWinOf({ getAttribute: () => null });
    const bar = E.gpTlWinOf({ getAttribute: (k) => (k === 'data-gp-tlwin' ? 'all' : null) });
    ok('Close-up narrows the panel to twenty seconds', (panel.to - panel.from) === 20,
       (panel.to - panel.from) + ' s');
    ok('…and does not narrow the bar with it', (bar.to - bar.from) > 500,
       (bar.to - bar.from) + ' s');
}
{
    const E = env();
    E.gp.playIdx = 200 * HZ;
    E.gpJog().half = 6;
    const w = E.gpTlWinOf({ getAttribute: (k) => (k === 'data-gp-tlwin' ? 'jog' : null) });
    ok('the jog is centred on the playhead, half its span either side',
       Math.abs(w.from - 194) < 0.01 && Math.abs(w.to - 206) < 0.01, JSON.stringify(w));
}

/* ══ the track sheet ═════════════════════════════════════════════════════ */
console.log('\nthe track sheet');
{
    const E = env({ secs: 100 });
    E.gp.tl = { from: 0, to: 100, snap: true };
    E.add({ t0: REC + 25000, dur: 25, name: 'A' });
    E.add({ t0: REC + 60000, dur: 10, name: 'B', lane: 2 });
    E.gp.video = E.gp.clips[0];
    const h = E.gpTlPanelHtml('sheet');
    ok('a section a quarter of the way in is drawn a quarter of the way across',
       /left:25\.0000%;width:25\.0000%/.test(h));
    ok('lane 2 is drawn two 34 px lanes down', /top:70px/.test(h), '34 px lanes, 2 px of padding');
    ok('the gutter names one row per lane, plus the spare to drop onto',
       (h.match(/class='r lane/g) || []).length === 4,
       'three used lanes and one spare');
    ok('a lane holding one file is named by that file, not by a number',
       /class='n'>A</.test(h), 'lane 0 holds A alone');
    ok('the empty lane says what to do with it', /\+ drop a file/.test(h));
    ok('the recording gets a row of its own with the waveform in it',
       /gp-tl-rec/.test(h) && /data-gp-tldata/.test(h));
    ok('every section carries a canvas for its thumbnails',
       (h.match(/data-gp-tlfilm/g) || []).length === 2);
    ok('the playhead runs down the whole right-hand column',
       /gp-tl-right[\s\S]*data-gp-tlhead/.test(h));
    ok('the inspector names the section it is pointed at',
       /gp-tl-insp[\s\S]*class='nm'[^>]*>A</.test(h),
       (h.slice(h.indexOf('gp-tl-insp')).match(/class='nm'[^<]*<?[^<]*/) || [''])[0]);
    ok('…and the nudge lives there, not in the toolbar',
       h.indexOf('gp-tl-nudge') > h.indexOf('gp-tl-insp'));
    const bar = h.slice(h.indexOf('gp-tl-bar'), h.indexOf('gp-tl-body'));
    ok('the toolbar is down to what acts on the whole panel',
       !/gp-tl-nudge/.test(bar) && /\+ Footage/.test(bar) && /snap/.test(bar));
}
{
    const E = env({ secs: 100 });
    const h = E.gpTlPanelHtml('sheet');
    ok('with nothing open it says what to do rather than nothing at all',
       /gp-tl-empty/.test(h) && /Footage/.test(h));
    ok('and the inspector says there is nothing to point at',
       /No section to line up yet/.test(h));
}
{
    /* A section that will not decode still has a place on the sheet — and no
       thumbnail canvas, because there are no frames to put in it. */
    const E = env({ secs: 100 });
    E.add({ t0: REC, dur: 30, dead: true });
    const h = E.gpTlPanelHtml('sheet');
    ok('a file that will not decode is drawn, and asked for no thumbnails',
       /gp-tl-clip[^']*dead/.test(h) && !/data-gp-tlfilm/.test(h));
}

/* ══ one bar ═════════════════════════════════════════════════════════════ */
console.log('\none bar');
{
    const E = env({ secs: 300, laps: [
        { from: 0, to: 150 * HZ }, { from: 150 * HZ, to: 300 * HZ - 1 }
    ] });
    E.add({ t0: REC + 30000, dur: 60, name: 'A' });
    E.add({ t0: REC + 120000, dur: 40, name: 'B', lane: 1 });
    const h = E.gpBarOneHtml();
    ok('it states that its window is the whole day', /data-gp-tlwin='all'/.test(h));
    ok('laps across the top', (h.match(/data-gp-tllap=/g) || []).length === 2);
    ok('the recording under them', /ob-trace/.test(h) && /data-gp-tldata/.test(h));
    ok('a ribbon per section along the bottom',
       (h.match(/data-gp-tlclip=/g) || []).length === 2);
    ok('the second camera sits on the lane below the first',
       /top:2px/.test(h) && /top:7px/.test(h), '5 px lanes');
    ok('it is a drag surface, so gpTlBind can drive it',
       /data-gp-tlview/.test(h) && /data-gp-tllane/.test(h));
    ok('and it carries the playhead', /data-gp-tlhead/.test(h));
}
{
    const E = env({ secs: 300 });
    const h = E.gpBarOneHtml();
    ok('with no footage it says so rather than showing an empty band',
       /no footage on this recording/.test(h));
}

/* ══ what the bar says about the film ════════════════════════════════════ */
console.log('\nthe three words under the playhead');
{
    const E = env({ secs: 300 });
    E.add({ t0: REC + 60000, dur: 60, name: 'A' });
    E.gp.playIdx = 90 * HZ;
    ok('inside a section it names it and says how far in',
       /^A &middot; 0:30 in$/.test(E.gpBarFootageHtml()), E.gpBarFootageHtml());
    E.gp.playIdx = 30 * HZ;
    ok('before it, how long until it starts',
       /next in 0:30/.test(E.gpBarFootageHtml()), E.gpBarFootageHtml());
    E.gp.playIdx = 200 * HZ;
    ok('past the last one, that there is none here',
       /no footage here/.test(E.gpBarFootageHtml()), E.gpBarFootageHtml());
}
{
    const E = env({ secs: 300 });
    ok('and with no film at all it does not pretend there is a gap',
       /no footage yet/.test(E.gpBarFootageHtml()), E.gpBarFootageHtml());
}

/* ══ one transport ═══════════════════════════════════════════════════════ */
console.log('\none transport');
{
    const E = env();
    const h = E.gpBarTransportHtml(true);
    ok('five buttons, once', (h.match(/<button class='gp-tbtn/g) || []).length === 5,
       String((h.match(/<button class='gp-tbtn/g) || []).length));
    ok('the play button wears the class gpPlayIcon writes into',
       /gp-tbtn gp-tbtn-play/.test(h));
    ok('it takes its glyph from the same constant every other copy uses',
       h.indexOf('<svg id=play></svg>') > 0);
    E.gp.playing = true;
    ok('…and shows pause when it is playing',
       E.gpBarTransportHtml(true).indexOf('<svg id=pause></svg>') > 0);
    ok('with no recording open, nothing is pressable',
       (E.gpBarTransportHtml(false).match(/ disabled/g) || []).length === 5);
}

/* ══ thumbnails ══════════════════════════════════════════════════════════ */
console.log('\nthe thumbnail cache');
{
    const E = env();
    ok('a cache with nothing in it yet answers "no tile"',
       E.gpFilmTileAt(null, 0.5) === -1 && E.gpFilmTileAt({ cv: null, n: 0 }, 0.5) === -1);
    const f = { cv: {}, n: 10, want: 28 };
    ok('a half-built cache never points past what it has built',
       E.gpFilmTileAt(f, 0.99) === 9, String(E.gpFilmTileAt(f, 0.99)));
    ok('and the start of the file is the first tile',
       E.gpFilmTileAt(f, 0) === 0);
    const full = { cv: {}, n: 28, want: 28 };
    ok('a full cache spreads across all of it',
       E.gpFilmTileAt(full, 0.5) === 14, String(E.gpFilmTileAt(full, 0.5)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
