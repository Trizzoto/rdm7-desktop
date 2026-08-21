/* Does the node get read without being asked, and read only when it should?
 *
 * The node has no logs — one ring, a tape rather than a folder — so "has it
 * got anything new" used to mean "download the whole thing and see", which is
 * minutes over a serial link. That is why a drive can sit on a node until the
 * ring wraps over the top of it.
 *
 * trace.info answers it for free: `session` counts up on every clear,
 * `used_samples` counts up as the ring fills. Together they say WHICH tape
 * this is and how far into it we have read. Studio has always been told both
 * and had never looked at `session`.
 *
 * The safety case is the stronger one: trace.channels.set CLEARS THE RING, so
 * fetching what is new the moment a node is plugged in means the drive is home
 * before anyone changes a channel.
 *
 * What must hold — every one of these is a way to lose a drive:
 *   - the node is marked read only AFTER the samples are stored
 *   - a cleared-and-refilled ring is NEW even when it holds fewer samples
 *   - two nodes are two tapes and never share a bookmark
 *   - it fires once per link, not once every five seconds
 *
 *   node tools/check_autodl.js
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
function grabVar(src, name) {
    const re = new RegExp('^[ \\t]*var ' + name + '\\s*=\\s*', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    const at = m.index + m[0].length, end = src.indexOf(';', at);
    return 'var ' + name + ' = ' + src.slice(at, end) + ';';
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const VARS = ['GP_NODESEEN_LS', 'GP_AUTODL_LS', 'GP_TRACE_HZ', 'GP_RING_SETTLE_MS'];
const WANT = ['gpN', 'gpNodeKey', 'gpNodeSeen', 'gpNodeSeenSave', 'gpNodeMark',
              'gpNodeNew', 'gpAutoDlOn', 'gpAutoDlSet', 'gpAutoDownloadCheck'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};

const parts = [], missing = [];
for (const n of VARS) { try { parts.push(grabVar(src, n)); } catch (e) { missing.push('var ' + n); } }
for (const n of WANT) { try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); } }

const STORE = {}, LOG = [];
const F = new Function(`
    var STORE = arguments[0], LOG = arguments[1];
    var window = { localStorage: {
        getItem: function (k) { return (k in STORE) ? STORE[k] : null; },
        setItem: function (k, v) { STORE[k] = String(v); },
    } };
    var gp = { info: null, nodeSeen: null, traceBusy: false, _autoDlArmed: undefined,
               _dlAuto: false, linked: true };
    function gpLinked() { return gp.linked; }
    function showToast(m, t) { LOG.push({ toast: m, type: t }); }
    function gpRenderInspector() {}
    window.gpTraceDownload = function () { LOG.push({ download: true }); };
    ${parts.join('\n')}
    return {
        gp: gp, STORE: STORE, LOG: LOG,
        key: gpNodeKey, seen: gpNodeSeen, mark: gpNodeMark, isNew: gpNodeNew,
        on: gpAutoDlOn, set: gpAutoDlSet, check: gpAutoDownloadCheck, SETTLE: GP_RING_SETTLE_MS,
        reset: function () {
            gp.info = null; gp.nodeSeen = null; gp.traceBusy = false;
            gp._autoDlArmed = undefined; gp._dlAuto = false; gp.linked = true;
            gp._ringUsed = undefined; gp._ringGrew = false;
            LOG.length = 0;
            for (var k in STORE) delete STORE[k];
        },
    };
`)(STORE, LOG);

ok('every function and constant under test was found', missing.length === 0,
   'missing: ' + missing.join(', '));

const info = (session, used) => ({ session: session, used_samples: used, recording: true });

/* ── is there anything new ────────────────────────────────────────────── */
console.log('\nis there anything on it we have not read');
{
    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };

    ok('an empty ring is not news', F.isNew(info(1, 0)).any === false);
    ok('a node never read before is entirely new', F.isNew(info(1, 5000)).any === true);
    ok('and all of it counts as new', F.isNew(info(1, 5000)).samples === 5000);

    F.mark(info(1, 5000));
    ok('after a download, the same ring is not new', F.isNew(info(1, 5000)).any === false);
    ok('a ring that has grown is new', F.isNew(info(1, 8000)).any === true);
    ok('and only the growth counts', F.isNew(info(1, 8000)).samples === 3000);

    /* THE case a used_samples check on its own gets wrong: clear the ring,
       drive LESS than you had before, and "used is smaller than last time"
       reads as nothing new — so the drive is never fetched, and the next
       channel change wipes it. `session` is the only thing that catches it. */
    const cleared = F.isNew(info(2, 900));
    ok('a cleared ring holding LESS than before is still new',
       cleared.any === true, JSON.stringify(cleared));
    ok('and all of it is new, not the difference', cleared.samples === 900, cleared.samples);
    ok('and it says why', cleared.why === 'cleared', cleared.why);

    /* Missing counters must not be read as "nothing to do". */
    ok('a node that reports no session at all still offers its samples',
       F.isNew({ used_samples: 4000 }).any === true);
}

/* ── two nodes are two tapes ──────────────────────────────────────────── */
console.log('\ntwo nodes never share a bookmark');
{
    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.mark(info(1, 5000));
    ok('the first node is up to date', F.isNew(info(1, 5000)).any === false);

    F.gp.info = { serial: 'RDM-BBBB-0002' };
    F.gp.nodeSeen = null;                       /* re-read from storage */
    ok('a DIFFERENT node with the same counters is still new',
       F.isNew(info(1, 5000)).any === true,
       'one bookmark shared between two pucks means the second one never gets read');

    F.mark(info(1, 5000));
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.gp.nodeSeen = null;
    ok('and marking the second did not disturb the first',
       F.isNew(info(1, 5000)).any === false);

    F.gp.info = null;
    ok('an unknown node falls back to one shared slot rather than throwing',
       typeof F.key() === 'string' && F.key().length > 0, F.key());
}

/* ── the setting ──────────────────────────────────────────────────────── */
console.log('\nthe setting');
{
    F.reset();
    ok('it is on out of the box', F.on() === true,
       'the ring is the only other copy of a drive, and changing a channel wipes it');
    F.set(false);
    ok('turning it off sticks', F.on() === false);
    F.set(true);
    ok('and back on again', F.on() === true);
    F.STORE[F.STORE && 'rdm7_gp_autodl'] = 'nonsense';
    ok('anything that is not an explicit off counts as on', F.on() === true);
}

/* ── when it fires ────────────────────────────────────────────────────── */
console.log('\nwhen it fires');
{
    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };

    F.check(info(1, 5000));
    ok('a fresh link with new data starts a download',
       F.LOG.filter(l => l.download).length === 1, JSON.stringify(F.LOG));

    /* The poll runs every five seconds forever. Firing on every tick would
       be a download loop. */
    F.check(info(1, 5000));
    F.check(info(1, 5000));
    ok('and does NOT fire again on the same link',
       F.LOG.filter(l => l.download).length === 1,
       F.LOG.filter(l => l.download).length + ' downloads — the 5 s poll became a loop');

    /* Unplug, plug back in: that is a new link and a fresh question. */
    F.gp.linked = false;
    F.check(info(1, 5000));
    F.gp.linked = true;
    F.check(info(1, 9000));
    ok('unplugging re-arms it', F.LOG.filter(l => l.download).length === 2);

    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.mark(info(1, 5000));
    F.check(info(1, 5000));
    ok('nothing new means nothing happens at all — no download, no toast',
       F.LOG.length === 0, JSON.stringify(F.LOG));

    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.gp.traceBusy = true;
    F.check(info(1, 5000));
    ok('it never starts a second download over a running one',
       F.LOG.filter(l => l.download).length === 0);

    /* THE case this exists for. The laptop rides in the car on USB, so the
       link never drops — "once per link" would mean the one drive it was
       built to fetch is the one drive it never fetches. The end of a drive is
       the ring going quiet: it grew, then it stopped. */
    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.mark(info(1, 1000));
    F.check(info(1, 1000));
    ok('plugged in with nothing new, it stays quiet', F.LOG.length === 0);

    F.check(info(1, 4000));                       /* driving */
    F.check(info(1, 9000));
    ok('and stays quiet WHILE the ring is still growing',
       F.LOG.filter(l => l.download).length === 0,
       'downloading mid-drive would hog the port and grab half a run');

    F.check(info(1, 9000));                       /* stopped, but only just */
    ok('a brief stop is not the end of a drive',
       F.LOG.filter(l => l.download).length === 0);

    F.gp._ringGrewAt = Date.now() - 3 * 60 * 1000;   /* three minutes still */
    F.check(info(1, 9000));
    ok('but a ring that has gone quiet IS, and it fetches without a replug',
       F.LOG.filter(l => l.download).length === 1,
       'the laptop never disconnected, so nothing else would ever have asked');

    F.check(info(1, 9000));
    F.gp._ringGrewAt = Date.now() - 3 * 60 * 1000;
    F.check(info(1, 9000));
    ok('and having settled once it does not keep re-firing',
       F.LOG.filter(l => l.download).length === 1,
       F.LOG.filter(l => l.download).length + ' downloads from one quiet ring');

    ok('the settle window is long enough for traffic lights',
       F.SETTLE >= 60000, F.SETTLE + ' ms');

    F.reset();
    F.gp.info = { serial: 'RDM-AAAA-0001' };
    F.set(false);
    F.check(info(1, 30000));
    ok('with the setting off it offers rather than fetches',
       F.LOG.filter(l => l.download).length === 0 && F.LOG.filter(l => l.toast).length === 1,
       JSON.stringify(F.LOG));
    ok('and the offer says how much is waiting, in minutes',
       /\d+ min/.test(F.LOG.filter(l => l.toast)[0].toast),
       F.LOG.filter(l => l.toast)[0].toast);
}

/* ── the download path ────────────────────────────────────────────────── */
console.log('\nwhat the download does with it');
{
    const dl = grabFrom(src, 'gpTraceDownload');
    const markAt = dl.indexOf('gpNodeMark');
    const saveAt = dl.indexOf('gpSaveStints');
    ok('the node is marked read only after the samples are stored',
       markAt > 0 && saveAt > 0 && markAt > saveAt,
       'marking on the attempt loses a whole drive to one failed read, and the ' +
       'ring is the only other copy');
    ok('an empty download does not mark it read',
       /if \(!gp\._dlEmpty\) gpNodeMark/.test(dl),
       'an empty read would bookmark a ring nobody has taken anything off');
    ok('a failed download leaves it unmarked so the next connect retries',
       dl.lastIndexOf('gpNodeMark') < dl.indexOf('.catch('),
       'marking in the catch would swallow the drive silently');
    ok('an automatic download does not yank the view',
       /if \(!auto\) window\.gpSetView\("session"\)/.test(dl),
       'being thrown out of Setup mid-sentence is how people learn to turn a ' +
       'feature off');
    ok('but it does say out loud when it fails',
       /if \(auto\) showToast\("Automatic download failed/.test(dl),
       'silently failing to fetch something is worse than never offering');

    const chk = grabFrom(src, 'gpAutoDownloadCheck');
    ok('the check itself opens no RPC — it reads the poll\'s own answer',
       !/traceInfo\(\)/.test(chk), 'a second RPC per tick on a link doing ten a second');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
