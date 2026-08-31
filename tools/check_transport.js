/* Who drives the replay: the index ticker or the footage.
 *
 * With a synced video open and Follow on, the video is the better transport —
 * real frames at real speed, the timeline driven off the picture. But the
 * footage covers a STRETCH of the recording, not all of it, and the first cut
 * of the handover forgot that: gpPlayToggle clamped the seek into
 * [0, duration] and handed over regardless, so pressing play on any lap the
 * camera never saw snapped the whole replay to the one lap it did see. "Every
 * time I play any lap it auto goes to the video lap" — reported in exactly
 * those words, minus the patience.
 *
 * The rule now has three legs, and each is pinned here against the real
 * source of gpPlayToggle and the ticker:
 *
 *   - play INSIDE the footage      -> the video is the transport
 *   - play OUTSIDE the footage     -> the ticker is, and the playhead stays
 *                                     where the person put it
 *   - the ticker WALKS INTO the    -> the video takes over mid-replay
 *     footage
 *
 * (The fourth leg — footage runs out before the lap does — was already
 * handled by the 'ended' listener resuming the ticker.)
 *
 *   node tools/check_transport.js
 */
const fs = require('fs');
const path = require('path');

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

const FNS = ['gpPlayToggle', 'gpPlayResumeTicker', 'gpPlayAnchor', 'gpVideoTimeFor'];
const parts = [], missing = [];
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

/* 1000 samples at 25 Hz with real timestamps; the footage covers samples
   400..650 (t0 chosen so video time 0 lands on sample 400, duration 10 s). */
function makeEnv(opt) {
    opt = opt || {};
    const rows = [];
    for (let i = 0; i < 1000; i++) rows.push({ t: i * 40, kph: 80 });
    const recordedAt = 1000000;
    const video = { follow: opt.follow === undefined ? true : opt.follow,
                    t0: recordedAt + 400 * 40, offsetMs: 0 };
    const el = {
        duration: opt.duration === undefined ? 10 : opt.duration,
        currentTime: -1, playbackRate: 0, paused: true, played: 0,
        play() { this.played++; this.paused = false; return { catch(f) { el._catch = f; return this; } }; }
    };
    const timers = [];
    let ctxRef = null;
    const ctx = {
        console, isFinite, Math,
        gp: { trace: rows, playing: false, playIdx: opt.playIdx || 0, playRate: 1,
              playTimer: null, video: opt.video === undefined ? video : opt.video,
              selLap: 0, traceLaps: [{ from: 0, to: 999 }],
              _playAtS: 0, _playWallMs: 0, _playIdxSet: -1, playSub: 0, playSubIdx: 0 },
        document: { getElementById: id => (id === 'gpVideo' ? el : id === 'gpScrub' ? null : null) },
        setInterval(fn, ms) { const id = timers.length + 1; timers.push({ id, fn, ms }); ctx.gp.playTimer = id; return id; },
        clearInterval(id) { const k = timers.findIndex(t => t.id === id); if (k >= 0) timers.splice(k, 1); },
        gpLapRange() { return { from: 0, to: 999 }; },
        gpSampleUtc(i) { return 1000000 + i * 40; },
        gpSpanSecs() { return 40; },
        gpPlaySecs() { return (ctxRef.gp.playIdx) / 25; },
        gpLapPosAtSecs(rr, s) { return { i: Math.min(999, Math.round(s * 25)), f: 0 }; },
        gpPlayIcon() { }, gpPlayStop() { ctx.gp.playing = false; },
        gpPlayRollOver() { return false; },
        gpSyncScrub() { }, gpDrawPlayhead() { },
        window: null,
        performance: { now: () => ctx._now || 0 }
    };
    ctx.window = ctx;
    ctxRef = ctx;
    ctx.gpNow = () => ctx._now || 0;
    const body = parts.join('\n') +
        '\nreturn { toggle: gpPlayToggle, ticker: gpPlayResumeTicker, timeFor: gpVideoTimeFor };';
    const built = new Function(
        'gp', 'document', 'setInterval', 'clearInterval', 'gpLapRange', 'gpSampleUtc',
        'gpSpanSecs', 'gpPlaySecs', 'gpLapPosAtSecs', 'gpPlayIcon', 'gpPlayStop', 'gpPlayRollOver',
        'gpSyncScrub', 'gpDrawPlayhead', 'gpNow', 'window', 'isFinite', 'Math',
        body
    )(ctx.gp, ctx.document, ctx.setInterval, ctx.clearInterval, ctx.gpLapRange,
      ctx.gpSampleUtc, ctx.gpSpanSecs, ctx.gpPlaySecs, ctx.gpLapPosAtSecs, ctx.gpPlayIcon,
      ctx.gpPlayStop, ctx.gpPlayRollOver, ctx.gpSyncScrub, ctx.gpDrawPlayhead,
      ctx.gpNow, ctx, isFinite, Math);
    return { ctx, el, timers, rows, api: built,
             tick() { if (timers.length) timers[0].fn(); } };
}

console.log('play inside the footage: the video is the transport');
{
    const E = makeEnv({ playIdx: 500 });               /* video time 4.0 s */
    E.api.toggle();
    ok('the video is asked to play', E.el.played === 1);
    ok('…from the moment the playhead names', Math.abs(E.el.currentTime - 4.0) < 0.01,
       String(E.el.currentTime));
    ok('…and no ticker is started beside it', E.timers.length === 0);
    ok('the playhead was not moved', E.ctx.gp.playIdx === 500);
}

console.log('\nplay outside the footage: the ticker is, and nothing jumps');
{
    const E = makeEnv({ playIdx: 100 });               /* video time -12 s */
    E.api.toggle();
    ok('the video is left alone', E.el.played === 0);
    ok('the ticker runs the replay', E.timers.length === 1);
    ok('the playhead stays on the lap that was chosen', E.ctx.gp.playIdx === 100);
}
{
    const E = makeEnv({ playIdx: 900 });               /* video time 20 s > dur 10 */
    E.api.toggle();
    ok('after the footage ends it is also the ticker', E.el.played === 0 && E.timers.length === 1);
}
{
    const E = makeEnv({ playIdx: 100, follow: false });
    E.api.toggle();
    ok('with Follow off the video is never the transport', E.el.played === 0 && E.timers.length === 1);
}
{
    const E = makeEnv({ playIdx: 100, video: null });
    E.api.toggle();
    ok('with no video at all the ticker runs as it always has', E.timers.length === 1);
}

console.log('\nthe ticker hands over when the playhead walks into the footage');
{
    const E = makeEnv({ playIdx: 380 });               /* 0.8 s before coverage */
    E.api.toggle();
    ok('starts on the ticker', E.timers.length === 1 && E.el.played === 0);
    /* advance the wall clock until the playhead crosses sample 400 */
    E.ctx._now = 1000;                                  /* 1 s at 1x = 25 samples */
    E.tick();
    ok('crossing into coverage hands the clock to the video', E.el.played === 1);
    ok('…seeked to the playhead, not to the start of the footage',
       E.el.currentTime >= 0 && E.el.currentTime < 0.6, String(E.el.currentTime));
    ok('…and the ticker is gone', E.timers.length === 0);
}
{
    const E = makeEnv({ playIdx: 100 });
    E.api.toggle();
    E.ctx._now = 1000;                                  /* still ~11 s short */
    E.tick();
    ok('short of the footage the ticker keeps the clock', E.el.played === 0 && E.timers.length === 1);
}
{
    /* Follow off means the picture is on its own leash: the ticker must not
       hand it the clock even when the playhead is deep inside its footage. */
    const E = makeEnv({ playIdx: 380, follow: false });
    E.api.toggle();
    E.ctx._now = 2000;                                 /* well into coverage */
    E.tick();
    ok('with Follow off the walk-in never hands over either',
       E.el.played === 0 && E.timers.length === 1);
}
{
    /* the webview refuses play(): the replay must take the clock back */
    const E = makeEnv({ playIdx: 380 });
    E.api.toggle();
    E.ctx._now = 1000;
    E.tick();
    ok('(handover attempted)', E.el.played === 1);
    E.ctx.gp.playing = true;
    if (E.el._catch) E.el._catch(new Error('NotAllowedError'));
    ok('a refused play() falls back to the ticker instead of stranding the replay',
       E.timers.length === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
