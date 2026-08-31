/* The video element's origin, and the export step that used to hang on it.
 *
 * Under Tauri a video opened by PATH is served from `asset.localhost`, a
 * different origin from the page. Draw it into a canvas and the canvas is
 * tainted; a tainted canvas hands frames to neither MediaRecorder nor
 * WebCodecs, so the export produces nothing at all.
 *
 * The old answer was to re-read the whole file into a blob first. That is the
 * one step in the export that must hold an entire video in memory, and it had
 * no cancel, no timeout and no error path — so "Preparing the footage… /
 * Reading the file…" was a modal you could not leave. Measured in the real
 * webview on a 127,816,945-byte iPhone clip: 49.6 s, because a command
 * returning Vec<u8> is serialised as a JSON array of numbers. (Raw bytes:
 * 3.1 s. See read_binary_file in lib.rs.)
 *
 * The answer now is to not be tainted: `gpVideoSetSrc` asks for the file as a
 * CORS resource, which the asset protocol allows. Verified in the real webview
 * — same file, same URL, `crossorigin` off → SecurityError out of
 * getImageData, `crossorigin="anonymous"` → real pixels read back.
 *
 * What is checked here is everything around that which node CAN see: that the
 * attribute is set before the src and only for a path video, that a failed
 * CORS load falls back rather than leaving a dead element, and that every way
 * the fallback read can go wrong ENDS — because a promise that never settles
 * is exactly the bug this replaced.
 *
 *   node tools/check_untaint.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');

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
function grabVar(s, name) {
    const one = new RegExp('^        var ' + name + ' = ([^;]+);', 'm').exec(s);
    if (!one) throw new Error('not found: var ' + name);
    return 'var ' + name + ' = ' + one[1] + ';';
}

const VARS = ['GP_UNTAINT_MAX', 'GP_UNTAINT_LOAD_MS'];
const FNS = ['gpVideoSetSrc', 'gpCanvasTainted', 'gpUntaintVideo'];
const parts = [], missing = [];
for (const v of VARS) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
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

/* A promise that never settles is THE bug under test, and `await` on one is
   silent: node drains its queue and exits 0 with the assertion never reached.
   So nothing here awaits the function directly — a hang comes back as the
   string 'HUNG' and reads as a failure, which is what it is. */
function settled(p) {
    return Promise.race([p, new Promise(r => setImmediate(() => setImmediate(() => setImmediate(() => r('HUNG')))))]);
}

/* ---- the stand-in element -------------------------------------------------
   A <video> reflects `crossOrigin` onto the `crossorigin` attribute, and the
   browser decides whether the response taints the canvas from what that
   attribute said AT LOAD TIME. Both halves matter: setting the property after
   the src is a no-op in a real browser, and a test that only read the property
   afterwards would call that a pass. So each load is recorded with the
   attribute as it stood when the src was assigned. */
function makeVideo() {
    const loads = [];
    const ls = {};
    let pending = null;
    const el = {
        currentTime: 0,
        loads: loads,
        _attrs: {},
        _tainted: false,
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
        removeAttribute(k) { delete this._attrs[k]; },
        addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
        removeEventListener(t, f) {
            if (!ls[t]) return;
            const i = ls[t].indexOf(f);
            if (i >= 0) ls[t].splice(i, 1);
        },
        listeners(t) { return (ls[t] || []).length; },
        fire(t) { (ls[t] || []).slice().forEach(f => f()); },
        /* An asset URL loaded without the attribute is what taints a canvas;
           the same URL loaded with it does not, and a blob is same-origin
           either way. */
        finish(how) {
            if (!pending) return;
            const l = pending;
            pending = null;
            if (how === 'error') { el.fire('error'); return; }
            el._tainted = l.url.indexOf('asset.localhost') >= 0 && l.cors !== 'anonymous';
            el.fire('loadedmetadata');
        }
    };
    Object.defineProperty(el, 'crossOrigin', {
        get() { return this.getAttribute('crossorigin'); },
        set(v) { if (v === null) this.removeAttribute('crossorigin'); else this.setAttribute('crossorigin', v); }
    });
    Object.defineProperty(el, 'src', {
        get() { return this._src; },
        set(v) {
            this._src = v;
            pending = { url: String(v), cors: this.getAttribute('crossorigin') };
            loads.push(pending);
        }
    });
    return el;
}

/* The clock is virtual so the 30 s guard can be asserted by its real value
   rather than waited out. */
function makeEnv(opt) {
    opt = opt || {};
    const el = opt.el || makeVideo();
    const timers = [];
    let nextId = 1;
    const reads = [];
    const revoked = [], created = [];
    const ctx = {
        console,
        Promise, Blob: class { constructor(p, o) { this.parts = p; this.type = o && o.type; } },
        URL: {
            createObjectURL(b) { const u = 'blob:fake/' + created.length; created.push(b); return u; },
            revokeObjectURL(u) { revoked.push(u); }
        },
        setTimeout(fn, ms) { const id = nextId++; timers.push({ id, fn, ms }); return id; },
        clearTimeout(id) { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
        document: {
            getElementById: id => (id === 'gpVideo' ? el : null),
            createElement(tag) {
                if (tag !== 'canvas') return {};
                return {
                    width: 0, height: 0,
                    getContext() {
                        return {
                            drawImage() { },
                            getImageData() {
                                if (el._tainted) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
                                return { data: new Uint8Array(4) };
                            }
                        };
                    }
                };
            }
        },
        RDM: {
            readFile(p) {
                reads.push(p);
                if (opt.readRejects) return Promise.reject(new Error('nope'));
                return new Promise(res => { ctx.__resolveRead = () => res(new Uint8Array(4)); });
            }
        },
        gp: { video: opt.video === undefined ? { path: 'C:/f.mov', size: 1024, url: 'http://asset.localhost/f', blob: false } : opt.video }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(parts.join('\n'), ctx);
    return {
        ctx, el, reads, timers, revoked,
        timerDelays: () => timers.map(t => t.ms),
        fireTimers() { timers.splice(0).forEach(t => t.fn()); },
        flush: () => new Promise(r => setImmediate(r))
    };
}

(async () => {

console.log('the attribute that keeps the canvas clean');
{
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/f.mov', true);
    ok('a video opened by path asks for CORS', E.el.getAttribute('crossorigin') === 'anonymous');
    ok('…and asked for it BEFORE the src, which is the only time it counts',
       E.el.loads.length === 1 && E.el.loads[0].cors === 'anonymous');
}
{
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'blob:fake/1', false);
    ok('a file chosen through the picker is same-origin and asks for nothing',
       E.el.getAttribute('crossorigin') === null && E.el.loads[0].cors === null);
}
{
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/f.mov', true);
    E.el.finish('meta');
    ok('a CORS load that works leaves the canvas readable', E.el._tainted === false);
    ok('…and lets both of its listeners go',
       E.el.listeners('error') === 0 && E.el.listeners('loadedmetadata') === 0);
}

console.log('\nwhat happens when CORS is refused — it must still play');
{
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/f.mov', true);
    E.el.finish('error');
    ok('a refused CORS load is retried', E.el.loads.length === 2);
    ok('…without the attribute this time', E.el.loads[1].cors === null);
    ok('…at the same url', E.el.loads[1].url === E.el.loads[0].url);
    E.el.finish('meta');
    ok('…and the picture that comes back is tainted, which is the trade',
       E.el._tainted === true);
    E.el.fire('error');
    ok('the retry happens once, not in a loop', E.el.loads.length === 2);
}
{
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/a.mov', true);
    E.el.finish('meta');
    E.el.fire('error');
    ok('an error long after a good load does not silently drop CORS',
       E.el.getAttribute('crossorigin') === 'anonymous' && E.el.loads.length === 1);
}
{
    /* Opening a second video before the first has answered used to leave the
       first video's retry listener attached to the shared element. */
    const E = makeEnv();
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/a.mov', true);
    E.ctx.gpVideoSetSrc(E.el, 'http://asset.localhost/b.mov', true);
    E.el.fire('error');
    ok('replacing the video before it loads leaves no stale retry behind',
       E.el.loads.length === 3 && E.el.loads[2].url.indexOf('b.mov') >= 0);
}

console.log('\nthe fallback read — every way out has to END');
{
    const E = makeEnv();
    E.el._tainted = false;
    const r = await settled(E.ctx.gpUntaintVideo());
    ok('a clean canvas needs no preparing at all', r === true);
    ok('…and reads nothing', E.reads.length === 0);
}
{
    const E = makeEnv({ video: { path: 'C:/f.mov', size: 0, url: 'http://asset.localhost/f' } });
    E.el._tainted = true;
    const r = await settled(E.ctx.gpUntaintVideo());
    ok('a file of unknown size is refused rather than read blind', r === false);
    ok('…and reads nothing', E.reads.length === 0);
}
{
    const cap = vm.runInContext('GP_UNTAINT_MAX', E0().ctx);
    const E = makeEnv({ video: { path: 'C:/f.mov', size: cap + 1, url: 'http://asset.localhost/f' } });
    E.el._tainted = true;
    const r = await settled(E.ctx.gpUntaintVideo());
    ok('a file over the cap is refused, because this step holds it all in memory',
       r === false, 'cap ' + cap);
    ok('…and reads nothing', E.reads.length === 0);
}
{
    const E = makeEnv();
    E.el._tainted = true;
    const p = E.ctx.gpUntaintVideo();
    await E.flush();
    E.ctx.__resolveRead();
    await E.flush();
    ok('the blob is loaded without asking for CORS — it is already same-origin',
       E.el.loads.length === 1 && E.el.loads[0].cors === null);
    E.el.finish('meta');
    ok('a blob that loads gives a clean canvas', (await settled(p)) === true);
    ok('…having read the file once', E.reads.length === 1);
}
{
    const E = makeEnv();
    E.el._tainted = true;
    const p = E.ctx.gpUntaintVideo();
    await E.flush();
    E.ctx.__resolveRead();
    await E.flush();
    E.el.finish('error');
    ok('a blob the element refuses ends the wait instead of hanging', (await settled(p)) === false);
}
{
    const E = makeEnv();
    E.el._tainted = true;
    const p = E.ctx.gpUntaintVideo();
    await E.flush();
    E.ctx.__resolveRead();
    await E.flush();
    const delays = E.timerDelays();
    ok('the wait is guarded by a timer', delays.length === 1);
    ok('…set to the stated guard, not something invented',
       delays[0] === vm.runInContext('GP_UNTAINT_LOAD_MS', E.ctx), String(delays[0]));
    E.fireTimers();
    ok('a blob that never answers ends the wait too', (await settled(p)) === false);
}
{
    const E = makeEnv();
    E.el._tainted = true;
    const p = E.ctx.gpUntaintVideo();
    await E.flush();
    E.ctx.__resolveRead();
    await E.flush();
    E.el.finish('meta');
    await settled(p);
    ok('the guard is cleared once the answer arrives', E.timers.length === 0);
    ok('…and both listeners are let go', E.el.listeners('loadedmetadata') === 0 &&
                                          E.el.listeners('error') === 0);
}
{
    const E = makeEnv();
    E.el._tainted = true;
    let quit = false;
    const p = E.ctx.gpUntaintVideo(() => quit);
    await E.flush();
    quit = true;                       /* Stop pressed while Rust is reading */
    E.ctx.__resolveRead();
    ok('giving up ends the wait', (await settled(p)) === false);
    ok('…and the element is left alone rather than swapped for a blob',
       E.el.loads.length === 0);
}
{
    const E = makeEnv({ readRejects: true });
    E.el._tainted = true;
    ok('a read that fails is an answer, not a hang', (await settled(E.ctx.gpUntaintVideo())) === false);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

})();

/* Only used to read the constants out of a throwaway context. */
function E0() { return makeEnv(); }
