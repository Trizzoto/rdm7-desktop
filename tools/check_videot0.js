/* Where the footage sits in the recording, and the two ways it went missing.
 *
 * `gp.video.t0` is the UTC moment the video's first frame happened. Everything
 * that puts the two together needs it: the playhead follow, the HUD's choice of
 * sample per frame, and the export, which refuses outright without one.
 *
 * The failure it produces is the nastiest kind — it looks like success. The
 * file loads, plays, seeks, reports its duration, the panel shows the nudge
 * that was saved with it and the tick beside "Link". Only Export disagrees,
 * with "Line the footage up with the recording first", and nothing on screen
 * says which part is missing.
 *
 * Two independent routes got there, both seen on a real session:
 *
 *   1. `gpCurSessionMeta()` returned null for a recording that WAS open.
 *      The sessions list and the recording load separately, and `gpSessOpen`
 *      right after a page load wins that race — so for a second or two
 *      `gp.sessionId` names a session the list does not contain. `gpVideoBegin`
 *      reads the meta to compute t0, gets null, and stores null.
 *   2. The remembered sync source could not be honoured this time — no camera
 *      clock in the file, or no log anchor on the recording — and
 *      `gpVideoSyncSet` refused SILENTLY, leaving t0 exactly as it was.
 *
 * So: the meta lookup falls back to the meta the loader is holding, the sync
 * setter reports whether it worked, and the restore falls back to the start of
 * the recording rather than leaving the footage unplaced. The remembered
 * source is NOT overwritten by that fallback — it is used again the moment it
 * becomes available, which is what the last two checks are about.
 *
 *   node tools/check_videot0.js
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

const FNS = ['gpCurSessionMeta', 'gpVideoSyncSet', 'gpVideoLinkSync'];
const parts = [], missing = [];
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

/* The restore is four lines in the middle of gpVideoBegin and cannot be
   extracted on its own, so it is read as TEXT and re-run here. Checking the
   source rather than a copy of it is the point: a copy would go on passing
   after someone changed the real one. */
const beginSrc = grabFn(src, 'gpVideoBegin');
function grabBlock(s, head) {
    const i = s.indexOf(head);
    if (i < 0) return null;
    let j = s.indexOf('{', i), depth = 0, k = j;
    for (; k < s.length; k++) {
        if (s[k] === '{') depth++;
        else if (s[k] === '}') { depth--; if (depth === 0) break; }
    }
    return s.slice(j + 1, k);                       /* the body, braces off */
}
const RESTORE = grabBlock(beginSrc, 'if (restore && restore.src) {');
const restoreMatch = !!RESTORE && RESTORE.indexOf('gpVideoSyncSet(restore.src)') >= 0;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

function env(opt) {
    opt = opt || {};
    const puts = [];
    const ctx = {
        console,
        gp: {
            sessionId: opt.sessionId === undefined ? 'ses_a' : opt.sessionId,
            sessions: opt.sessions === undefined ? [] : opt.sessions,
            sessionMeta: opt.sessionMeta === undefined ? null : opt.sessionMeta,
            video: opt.video === undefined
                ? { path: 'C:/f.mov', t0: null, src: 'start', offsetMs: 0,
                    autoT0: null, autoTz: false, fileT0: null }
                : opt.video
        },
        gpStore: { putMeta(m) { puts.push(m); } },
        gpVideoTzFix: (ms, rec) => ({ t0: ms, hours: 0 }),
        gpVideoFollowSeek() { }, gpVideoDrawOverlay() { }, gpRenderGridSoft() { },
        gpVideoOffset(v) {
            /* the real one nudges and then syncs the link, which is the part
               that matters here */
            ctx.gp.video.offsetMs = Math.round((parseFloat(v) || 0) * 1000);
            ctx.gpVideoLinkSync();
        }
    };
    ctx.window = ctx;
    ctx.puts = puts;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    return ctx;
}

const META = (over) => Object.assign({
    id: 'ses_a', recordedAt: 1000000, videoPath: 'C:/f.mov',
    videoSrc: 'cam', videoOffsetMs: 4000
}, over || {});

console.log('finding the open recording');
{
    const m = META();
    const E = env({ sessions: [m] });
    ok('the list is used when it has the session', E.gpCurSessionMeta() === m);
}
{
    const m = META();
    const E = env({ sessions: [], sessionMeta: m });
    ok('the loader\'s own copy answers while the list is still loading',
       E.gpCurSessionMeta() === m);
}
{
    const listed = META(), held = META();
    const E = env({ sessions: [listed], sessionMeta: held });
    ok('once the list arrives it wins — that is the object every screen edits',
       E.gpCurSessionMeta() === listed);
}
{
    const E = env({ sessions: [], sessionMeta: META({ id: 'ses_OTHER' }) });
    ok('a held meta for a DIFFERENT recording is not offered', E.gpCurSessionMeta() === null);
}
{
    const E = env({ sessionId: null, sessions: [], sessionMeta: META() });
    ok('nothing open, nothing returned', E.gpCurSessionMeta() === null);
}

console.log('\nthe sync setter says whether it worked');
{
    const E = env({ sessions: [META()] });
    ok('started together always works', E.gpVideoSyncSet('start') === true);
    ok('…and places the footage at the first sample', E.gp.video.t0 === 1000000);
}
{
    const E = env({ sessions: [META({ videoAnchorMs: 250 })] });
    ok('the log anchor works when the recording carries one', E.gpVideoSyncSet('log') === true);
    ok('…and t0 is the anchor backed off the start', E.gp.video.t0 === 1000000 - 250);
}
{
    const E = env({ sessions: [META()] });
    ok('a recording with no anchor refuses "log"', E.gpVideoSyncSet('log') === false);
    ok('…and leaves t0 alone rather than half-setting it', E.gp.video.t0 === null);
}
{
    const E = env({ sessions: [META()] });
    ok('no camera clock refuses "cam"', E.gpVideoSyncSet('cam') === false);
}
{
    const E = env({ sessions: [META()],
                    video: { path: 'C:/f.mov', t0: null, autoT0: 999, autoTz: false } });
    ok('a camera clock is honoured', E.gpVideoSyncSet('cam') === true);
    ok('…and t0 comes from it', E.gp.video.t0 === 999);
}
{
    const E = env({ sessions: [] });
    ok('no recording open, no sync', E.gpVideoSyncSet('start') === false);
}

console.log('\ncoming back to a linked video');
if (!restoreMatch) {
    fail++;
    console.log('  FAIL  the restore in gpVideoBegin is not in the shape this checks');
} else {
    const run = (E, restore) => {
        E.restore = restore;
        vm.runInContext('(function (restore) {\n' + RESTORE + '\n})(restore)', E);
    };
    {
        /* the whole bug, start to finish: list not there yet, remembered
           camera clock that the probe did not find this time */
        const m = META();
        const E = env({ sessions: [], sessionMeta: m });
        run(E, { src: 'cam', offsetMs: 4000 });
        ok('a video whose remembered sync cannot be honoured still gets a t0',
           E.gp.video.t0 === 1000000, String(E.gp.video.t0));
        ok('…and it says "start", because that is what was actually applied',
           E.gp.video.src === 'start');
        ok('…the nudge that was saved with it survives', E.gp.video.offsetMs === 4000);
        ok('…and the remembered source is kept, not overwritten by the fallback',
           m.videoSrc === 'cam', m.videoSrc);
    }
    {
        const m = META();
        const E = env({ sessions: [m],
                        video: { path: 'C:/f.mov', t0: null, autoT0: 777, autoTz: false } });
        run(E, { src: 'cam', offsetMs: 4000 });
        ok('a camera clock that IS there is used, and nothing falls back',
           E.gp.video.t0 === 777 && E.gp.video.src === 'cam');
        ok('…so the meta still says cam', m.videoSrc === 'cam');
        ok('…with the nudge restored', E.gp.video.offsetMs === 4000);
    }
    {
        const m = META({ videoSrc: 'start', videoOffsetMs: 0 });
        const E = env({ sessions: [m] });
        run(E, { src: 'start', offsetMs: 0 });
        ok('the ordinary case is untouched', E.gp.video.t0 === 1000000 && E.gp.video.src === 'start');
    }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
