/* Footage in sections, and where each of them sits (ADR-0053).
 *
 * A day is rarely one file. The app used to hold exactly one video per
 * recording, so opening the second threw the first away — and a lap the
 * second card covered simply had no picture, with nothing on screen to say
 * why. The model that replaced it is an editor's: clips on lanes, lane 0
 * covering the lanes beneath it, dragged along one axis that is measured in
 * seconds from the first sample.
 *
 * Everything here is arithmetic and precedence, which is exactly the part
 * that is invisible on screen until it is wrong:
 *
 *   - a clip's span is t0 + nudge .. + duration, and a clip with no duration
 *     yet covers NOTHING (it must not win a lookup while it is still loading)
 *   - lane 0 wins; inside a lane the later clip wins; a PICKED clip wins over
 *     both, and goes on winning for one that has been dragged off the end of
 *     the recording, which is the only way to get hold of it and drag it back
 *   - a section with no clock of its own butts onto the end of the last one,
 *     not onto the start of the day, which is where every section would
 *     otherwise be stacked
 *   - the stored form carries every section AND mirrors the first onto the
 *     three keys that existed before sections did, because a ghost lap from
 *     another day reads those directly
 *
 *   node tools/check_clips.js
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

const FNS = ['gpTlBind', 'gpClips', 'gpClipStart', 'gpClipDur', 'gpClipEnd', 'gpClipById',
             'gpClipCovers', 'gpClipAtUtc', 'gpClipAt', 'gpClipReaches',
             'gpClipSyncFor', 'gpClipButt', 'gpClipLaneFree', 'gpClipsSave',
             'gpClipTether', 'gpTl', 'gpTlSec', 'gpTlSessDur', 'gpTlExtent',
             'gpTlView', 'gpTlStep', 'gpTlClock', 'gpTlCoverage', 'gpTlReadout',
             'gpTlClipTip', 'gpTlHtml'];
/* The tick ladder is a const beside the function that reads it — taken from
   the source too, so a ladder edited in the app is the ladder checked here. */
function grabVar(s, name) {
    const re = new RegExp('^        var ' + name + ' = [^\\n]*;$', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const parts = [], missing = [];
try { parts.push(grabVar(src, 'GP_TL_STEPS')); } catch (e) { missing.push('GP_TL_STEPS'); }
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

const REC = 1000000;              /* the recording's first sample, in UTC ms */
const HZ = 25;

/* A recording of `secs` seconds at 25 Hz, and whatever clips are asked for. */
function env(opt) {
    opt = opt || {};
    const secs = opt.secs === undefined ? 600 : opt.secs;
    const rows = [];
    for (let i = 0; i < secs * HZ; i++) rows.push({ t: i * (1000 / HZ), kph: 60 });
    const meta = Object.assign({ id: 'ses_a', recordedAt: REC, dated: 'gps' }, opt.meta || {});
    const puts = [];
    const activated = [];
    const ctx = {
        console, isFinite, Math, Infinity, JSON, String, Array, Object,
        gp: {
            clips: [], clipSeq: 0, clipPin: null, video: null,
            trace: rows, traceLaps: opt.laps || [{ from: 0, to: rows.length - 1 }],
            selLap: 0, playIdx: 0, ghostFence: null, tl: null, _tlLive: true,
            sessionId: 'ses_a', sessions: [meta], sessionMeta: meta, view: 'session'
        },
        gpStore: { putMeta(m) { puts.push(JSON.parse(JSON.stringify(m))); } },
        gpCurSessionMeta: () => meta,
        gpSampleUtc(i) {
            const r = ctx.gp.trace[i];
            return r ? REC + r.t : null;
        },
        gpLapRange: () => ({ from: 0, to: ctx.gp.trace.length - 1 }),
        gpClipActivate(c) {
            if (ctx.gp.video === c) return false;
            activated.push(c ? c.id : null);
            ctx.gp.video = c;
            return true;
        },
        gpClipEl: () => null,
        gpClipAutoAlign() { },
        gpVideoFollowSeek() { }, gpVideoDrawOverlay() { }, gpRenderGridSoft() { },
        gpVideoLinked: (m) => !!(m && m.videoPath),
        gpVideoTzFix: (camMs) => ({ t0: camMs, hours: 0 }),
        gpEsc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;'),
        GP_VSRC_LBL: { log: 'Log', cam: 'Camera', start: 'Together' },
        gpVideoPick() { }
    };
    ctx.window = ctx;
    ctx.meta = meta; ctx.puts = puts; ctx.activated = activated;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);

    /* Clips are declared the way the app holds them: a t0 in UTC, a nudge, a
       lane, and a duration the element reported. */
    ctx.add = (o) => {
        const c = Object.assign({
            id: 'c' + (ctx.gp.clips.length + 1), name: 'clip' + (ctx.gp.clips.length + 1),
            path: 'C:/' + (ctx.gp.clips.length + 1) + '.mp4',
            t0: REC, offsetMs: 0, lane: 0, dur: 60, src: 'start',
            autoT0: null, autoTz: false, fileT0: null, el: null, follow: true
        }, o || {});
        ctx.gp.clips.push(c);
        return c;
    };
    return ctx;
}

/* ══ a clip's own span ═══════════════════════════════════════════════════ */
console.log('what a section covers');
{
    const E = env();
    const c = E.add({ t0: REC + 10000, offsetMs: 2000, dur: 30 });
    ok('start is the clock plus the nudge', E.gpClipStart(c) === REC + 12000);
    ok('end is the start plus the film', E.gpClipEnd(c) === REC + 12000 + 30000);
    ok('the first frame is inside it', E.gpClipCovers(c, REC + 12000));
    ok('the last instant is not', !E.gpClipCovers(c, REC + 42000));
    ok('a moment before it is not', !E.gpClipCovers(c, REC + 11999));
}
{
    const E = env();
    const c = E.add({ dur: 0 });
    ok('a section whose duration has not arrived covers nothing',
       !E.gpClipCovers(c, REC), 'a loading clip must never win a lookup');
    ok('…and gpClipAtUtc does not return it', E.gpClipAtUtc(REC) === null);
}
{
    const E = env();
    const c = E.add({ t0: null });
    ok('a section with no alignment at all has no start', E.gpClipStart(c) === null);
    ok('…and covers nothing', !E.gpClipCovers(c, REC));
}

/* ══ which one is on screen ══════════════════════════════════════════════ */
console.log('\nwhich section wins');
{
    const E = env();
    const low = E.add({ lane: 1, dur: 120 });
    const top = E.add({ lane: 0, dur: 120 });
    ok('lane 0 covers the lane beneath it', E.gpClipAtUtc(REC + 5000) === top);
    ok('…and outside the top one the lower is still there',
       E.gpClipAtUtc(REC + 5000) === top && low.lane === 1);
}
{
    const E = env();
    const first = E.add({ lane: 0, t0: REC, dur: 120 });
    const later = E.add({ lane: 0, t0: REC + 30000, dur: 120 });
    ok('inside one lane the later section covers the earlier',
       E.gpClipAtUtc(REC + 40000) === later);
    ok('…and before it the earlier one still shows',
       E.gpClipAtUtc(REC + 10000) === first);
}
{
    const E = env();
    E.add({ lane: 0, dur: 120 });
    const under = E.add({ lane: 1, dur: 120 });
    E.gp.clipPin = under.id;
    ok('a picked section outranks the lane order', E.gpClipAtUtc(REC + 5000) === under);
    E.gp.clipPin = 'nope';
    ok('a pin naming nothing is ignored rather than blanking the picture',
       E.gpClipAtUtc(REC + 5000) !== null);
}
{
    const E = env();
    const a = E.add({ dur: 60 });
    ok('between the sections there is no picture, and that is an answer',
       E.gpClipAtUtc(REC + 90000) === null, 'a gap is null, not the nearest clip');
}

/* ══ the switch as the playhead moves ════════════════════════════════════ */
console.log('\nfollowing the playhead from section to section');
{
    const E = env();
    const a = E.add({ t0: REC, dur: 60 });
    const b = E.add({ t0: REC + 60000, dur: 60 });
    E.gp.video = a;
    E.gp.playIdx = 10;
    ok('inside the section it is already showing, nothing happens',
       E.gpClipSyncFor(10) === false && E.activated.length === 0);
    E.gp.playIdx = 70 * HZ;
    ok('walking into the next section switches to it',
       E.gpClipSyncFor(70 * HZ) === true && E.gp.video === b);
}
{
    const E = env();
    const a = E.add({ t0: REC, dur: 60 });
    const b = E.add({ t0: REC + 60000, dur: 60 });
    E.gp.video = a;
    a.follow = false;
    ok('off the leash the picture is never taken away',
       E.gpClipSyncFor(70 * HZ) === false && E.gp.video === a,
       'somebody is lining this clip up by hand');
}
{
    const E = env();
    const a = E.add({ t0: REC, dur: 60 });
    E.gp.video = a;
    ok('one section on its own never costs a lookup', E.gpClipSyncFor(5000) === false);
}
{
    const E = env();
    const a = E.add({ t0: REC, dur: 60 });
    const b = E.add({ t0: REC + 60000, dur: 60 });
    E.gp.video = a;
    E.gp.clipPin = a.id;
    E.gpClipSyncFor(70 * HZ);
    ok('a pin is dropped once the playhead leaves the section it named',
       E.gp.clipPin === null && E.gp.video === b);
}
{
    /* the clip somebody has just dragged past the end of the day */
    const E = env({ secs: 60 });
    const a = E.add({ t0: REC, dur: 30 });
    const off = E.add({ t0: REC + 900000, dur: 30 });
    E.gp.video = off;
    E.gp.clipPin = off.id;
    ok('a section off the end of the recording cannot be reached', !E.gpClipReaches(off));
    ok('…so picking it survives the playhead being elsewhere',
       E.gpClipSyncFor(0) === false && E.gp.video === off,
       'otherwise the controls come off the very clip being dragged back');
}

/* ══ where a new section lands ═══════════════════════════════════════════ */
console.log('\nplacing a section with no clock of its own');
{
    const E = env();
    const a = E.add({ t0: REC, offsetMs: 0, dur: 60 });
    const b = E.add({ t0: REC, offsetMs: 0, dur: 45 });
    E.gpClipButt(b);
    ok('the second section starts where the first one ends',
       E.gpClipStart(b) === REC + 60000, String(E.gpClipStart(b) - REC));
    const c = E.add({ t0: REC, offsetMs: 0, dur: 20 });
    E.gpClipButt(c);
    ok('and the third after the second', E.gpClipStart(c) === REC + 105000,
       String(E.gpClipStart(c) - REC));
}
{
    const E = env();
    const only = E.add({ t0: REC, offsetMs: 0, dur: 60 });
    E.gpClipButt(only);
    ok('the first section is left where it is', only.offsetMs === 0);
}
{
    const E = env();
    const a = E.add({ t0: REC, dur: 60, lane: 0 });
    const b = E.add({ t0: REC + 10000, dur: 60, lane: 0 });
    E.gpClipLaneFree(b);
    ok('two sections of the same moment go on two lanes', b.lane === 1,
       'stacked on one, the lower one is unreachable');
    const c = E.add({ t0: REC + 200000, dur: 60, lane: 0 });
    E.gpClipLaneFree(c);
    ok('one that clashes with nothing stays on the top lane', c.lane === 0);
}

/* ══ what is written down ════════════════════════════════════════════════ */
console.log('\nwhat comes back next time');
{
    const E = env();
    E.add({ path: 'C:/b.mp4', t0: REC + 60000, offsetMs: 0, dur: 60, src: 'cam', lane: 1 });
    E.add({ path: 'C:/a.mp4', t0: REC, offsetMs: 250, dur: 60, src: 'start', lane: 0 });
    E.gpClipsSave(E.meta);
    const m = E.puts[E.puts.length - 1];
    ok('every section is stored', m.videoClips.length === 2);
    ok('…in the order they play, not the order they were opened',
       m.videoClips[0].path === 'C:/a.mp4', JSON.stringify(m.videoClips.map(c => c.path)));
    ok('…with the lane and the nudge each was left on',
       m.videoClips[0].offsetMs === 250 && m.videoClips[1].lane === 1);
    ok('the first is mirrored onto the one-video keys', m.videoPath === 'C:/a.mp4' &&
       m.videoSrc === 'start' && m.videoOffsetMs === 250,
       'a ghost lap from another day reads those directly');
}
{
    const E = env();
    E.meta.videoPath = 'C:/gone.mp4';
    E.meta.videoClips = [{ path: 'C:/gone.mp4' }];
    E.gpClipsSave(E.meta);
    const m = E.puts[E.puts.length - 1];
    ok('with nothing open the link is dropped entirely',
       !m.videoPath && !m.videoClips && !m.videoSrc && !m.videoOffsetMs);
}
{
    const E = env();
    E.add({ path: null, t0: REC, dur: 60 });
    E.gpClipsSave(E.meta);
    const m = E.puts[E.puts.length - 1];
    ok('a file with no path on disk is not remembered', !m.videoPath,
       'an <input> handle dies with the page — there would be nothing to come back to');
}

/* ══ tethering to a recording opened afterwards ══════════════════════════ */
console.log('\ntethering when the recording opens after the footage');
{
    const E = env();
    const c = E.add({ t0: null, autoT0: REC + 5000, offsetMs: 9999 });
    E.gpClipTether(c, E.meta);
    ok('a camera clock is believed, through the timezone fix',
       c.t0 === REC + 5000 && c.offsetMs === 0);
}
{
    const E = env();
    const c = E.add({ t0: null, autoT0: null, offsetMs: 9999 });
    E.gpClipTether(c, E.meta);
    ok('no clock means the start of the recording', c.t0 === REC && c.offsetMs === 0);
}
{
    const E = env();
    const c = E.add({ t0: 12345, probing: true });
    E.gpClipTether(c, E.meta);
    ok('a section still reading its own clock is left alone', c.t0 === 12345);
}

/* ══ the axis everything is drawn on ═════════════════════════════════════ */
console.log('\nthe timeline window');
{
    const E = env({ secs: 100 });
    ok('the recording is as long as its samples say',
       Math.abs(E.gpTlSessDur() - (100 - 1 / HZ)) < 0.05, String(E.gpTlSessDur()));
    const ex = E.gpTlExtent();
    ok('nothing open, and the whole recording fits', ex.from < 0 && ex.to > 99);
}
{
    const E = env({ secs: 100 });
    E.add({ t0: REC - 30000, dur: 20 });        /* filmed before the logger started */
    const ex = E.gpTlExtent();
    ok('a section filmed before the recording started still fits', ex.from <= -30,
       String(ex.from));
}
{
    const E = env({ secs: 100 });
    E.add({ t0: REC + 200000, dur: 30 });       /* dragged past the end */
    const ex = E.gpTlExtent();
    ok('and one dragged past the end of it too', ex.to >= 230, String(ex.to));
}
{
    const E = env({ secs: 100 });
    E.gp.tl = { from: 10, to: 20, snap: true };
    const v = E.gpTlView();
    ok('a window that has been zoomed is honoured',
       Math.abs(v.from - 10) < 0.001 && Math.abs(v.to - 20) < 0.001);
    E.gp.tl = { from: 10, to: 10.01, snap: true };
    ok('…but never zoomed past half a second, which is one frame twelve times over',
       E.gpTlView().to - E.gpTlView().from >= 0.5);
}
{
    const E = env({ secs: 100 });
    for (const span of [3, 30, 120, 900, 5400]) {
        const st = E.gpTlStep(span);
        const n = span / st;
        ok('a ' + span + ' s window gets a readable number of ticks (' +
           n.toFixed(1) + ')', n <= 12 && n >= 1.5, 'step ' + st);
    }
}

/* ══ how much of the day has film ════════════════════════════════════════ */
console.log('\ncoverage');
{
    const E = env({ secs: 100 });
    E.add({ t0: REC, dur: 25 });
    ok('a quarter of the recording reads as a quarter',
       Math.abs(E.gpTlCoverage() - 0.25) < 0.02, String(E.gpTlCoverage()));
}
{
    const E = env({ secs: 100 });
    E.add({ t0: REC, dur: 50, lane: 0 });
    E.add({ t0: REC + 10000, dur: 50, lane: 1 });   /* a second camera, overlapping */
    ok('two cameras over the same stretch count once',
       Math.abs(E.gpTlCoverage() - 0.6) < 0.02, String(E.gpTlCoverage()));
}
{
    const E = env({ secs: 100 });
    E.add({ t0: REC - 60000, dur: 70 });            /* mostly before the recording */
    ok('film from before the recording started does not count as coverage of it',
       Math.abs(E.gpTlCoverage() - 0.1) < 0.02, String(E.gpTlCoverage()));
}

/* ══ what it says about where you are ════════════════════════════════════ */
console.log('\nthe readout');
{
    const E = env({ secs: 300 });
    E.add({ t0: REC, dur: 60, name: 'GX010023.MP4' });
    E.gp.playIdx = 30 * HZ;
    ok('inside a section it names it and says how far in',
       /GX010023/.test(E.gpTlReadout()) && /0:30/.test(E.gpTlReadout()), E.gpTlReadout());
}
{
    const E = env({ secs: 300 });
    E.add({ t0: REC, dur: 60 });
    E.add({ t0: REC + 120000, dur: 60 });
    E.gp.playIdx = 90 * HZ;
    ok('in a gap it says how long until the next section',
       /next section in 0:30/.test(E.gpTlReadout()), E.gpTlReadout());
}
{
    const E = env({ secs: 300 });
    E.add({ t0: REC, dur: 60 });
    E.gp.playIdx = 200 * HZ;
    ok('past the last one it just says there is none here',
       E.gpTlReadout() === 'no footage here', E.gpTlReadout());
}

/* ══ the geometry that ends up on screen ═════════════════════════════════ */
console.log('\nthe markup the drag is measured against');
{
    const E = env({ secs: 100 });
    E.gp.tl = { from: 0, to: 100, snap: true };
    const a = E.add({ t0: REC + 25000, dur: 25, name: 'A' });
    E.add({ t0: REC + 60000, dur: 10, name: 'B', lane: 2 });
    const h = E.gpTlHtml(false);
    ok('a section a quarter of the way in is drawn a quarter of the way across',
       /left:25\.0000%;width:25\.0000%/.test(h), h.match(/left:[\d.]+%;width:[\d.]+%/g).join(' '));
    ok('lane 2 is drawn two lane-heights down', /top:62px/.test(h),
       '30 px lanes, 2 px of padding');
    ok('the recording gets a band of its own', /gp-tl-sess/.test(h));
    ok('and the playhead a line', /gp-tl-head/.test(h));
    ok('an empty lane is always offered to drop onto',
       (h.match(/data-gp-tllane=/g) || []).length === 4,
       'three used lanes plus one spare');
}
{
    const E = env({ secs: 100 });
    const h = E.gpTlHtml(false);
    ok('with nothing open it says what to do rather than nothing at all',
       /gp-tl-empty/.test(h) && /Footage/.test(h));
}
{
    const E = env({ secs: 100 });
    E.add({ t0: REC, dur: 10 });
    const h = E.gpTlHtml(true);
    ok('the compact strip is the same renderer at a smaller lane height',
       /gp-tl compact/.test(h) && /--tl-lane:16px/.test(h));
    ok('…without a second copy of the buttons already in the row above it',
       !/gp-tl-bar/.test(h));
    ok('…and stating its own height, because nothing gives it one',
       /gp-tl-view[^>]*height:\d+px;flex:none/.test(h),
       (h.match(/gp-tl-view[^>]*/) || [''])[0]);
    const p = E.gpTlHtml(false);
    ok('the panel keeps its bar and fills what it is given',
       /gp-tl-bar/.test(p) && !/height:\d+px;flex:none/.test(p));
}

/* ══ the scale a drag is measured against ════════════════════════════════ */
console.log('\nhow far a drag moves a section');
{
    /* `pxPerSec` is a local inside gpTlBind, so it is lifted out of the source
       and run on its own. Worth the trouble: this is the number every drag is
       divided by, and when it was allowed to be zero a 140 px drag moved a
       section fourteen days. */
    const bind = grabFn(src, 'gpTlBind');
    const m = /var pxPerSec = function \(view\) \{[\s\S]*?\n            \};/.exec(bind);
    ok('pxPerSec is still where this can reach it', !!m);
    if (m) {
        const ctx = { gpTlView: () => ({ from: 0, to: 100 }) };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(m[0] + '\nthis.f = pxPerSec;', ctx);
        const view = w => ({ getBoundingClientRect: () => ({ width: w, left: 0 }) });
        ok('a 1000 px surface over a 100 s window is 10 px a second',
           ctx.f(view(1000)) === 10, String(ctx.f(view(1000))));
        ok('a surface with NO width refuses to give a scale at all',
           ctx.f(view(0)) === null,
           'a panel measured mid-layout is 0 px wide; dividing by it flings the clip off the end of time');
        ok('…and so does one too narrow to drag against', ctx.f(view(8)) === null);
    }
    /* Comments stripped first — the one explaining this bug names the thing
       it warns about, and a check that fails on its own explanation is a check
       that gets deleted. */
    const code = bind.replace(/\/\*[\s\S]*?\*\//g, '');
    ok('nothing in the drag divides by a floored zero',
       code.indexOf('Math.max(0.0001') < 0,
       'that floor is what turned a 140 px drag into a shift of fourteen days');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
