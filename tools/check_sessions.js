/* Downloading the node's ring twice must not stack two copies of the same
 * drive into the library.
 *
 * The node does NOT clear its ring when you read it, so re-reading is the
 * ordinary thing to do: download at lunch, drive again, download at the end of
 * the day. Every save used to mint a fresh id, so the second read added a
 * complete duplicate of the morning. That is what fills the Sessions list with
 * identical rows -- the recordings were not failing to save, they were saving
 * too many times.
 *
 * Functions come verbatim out of src/tauri-overlay.html; gpStore is replaced
 * with an in-memory map so the real save path runs without IndexedDB.
 *
 *   node tools/check_sessions.js
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

/* A module-level object literal, brace-matched — grabFrom only finds
   functions, and a `[^;]+;` regex stops at the first semicolon inside the
   thing. The sort keys have to come out of the file like everything else, or
   the harness is checking a copy of them. */
function grabVar(src, name) {
    const re = new RegExp('^        var ' + name + ' = \\{', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j) + ';';
}

const WANT = ['gpN', 'gpSecs', 'gpSpanSecs', 'gpSesUid', 'gpSesDate', 'gpSampleDate',
              'gpTraceAnchor', 'gpIsTrial', 'gpFindCorners', 'gpSessionMeta',
              'gpSessionPrior', 'gpSessionSave', 'gpSessionSaveNow', 'gpStints',
              'gpSessAvg', 'gpSessSort', 'gpSessFiltered', 'gpSessSortBy',
              'gpSessPick', 'gpSessPicked', 'gpSessPickToggle', 'gpSessPickRange',
              'gpSessPickAll', 'gpSessPickClear'];

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [];
const missing = [];
for (const n of WANT) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}
try { parts.unshift(grabVar(src, 'GP_SESS_SORTS')); } catch (e) { missing.push('GP_SESS_SORTS'); }
/* The two numbers that decide where a download gets cut into recordings.
   Extracted, not restated: a harness that carries its own copy of a
   threshold agrees with itself and with nothing else. */
for (const c of ['GP_STINT_GAP_S', 'GP_STINT_MIN_S']) {
    const m = new RegExp('^ +var ' + c + ' = [0-9]+;', 'm').exec(src);
    if (m) parts.unshift(m[0].trim()); else missing.push(c);
}

const prelude = `
    var STORE = {};            /* id -> meta */
    var DATA = {};             /* id -> packed */
    var gp = { sessions: null, traceLaps: [], trace: [], sessionId: null,
               info: null, traceChanIds: null, sessionUpdated: 0 };
    var GP_DT = 0.04;
    var putCalls = 0;
    var gpStore = {
        put: function (meta, packed) {
            putCalls++;
            STORE[meta.id] = JSON.parse(JSON.stringify(meta));
            if (packed) DATA[meta.id] = packed;
            return Promise.resolve();
        }
    };
    function gpRowsPack(rows) { return { n: rows.length }; }
    function gpBuildRail() {}
    function gpSetMsg() {}
    function gpComputeG() {}
    function gpActiveTrack() { return { id: 'trk1', name: 'Winton', start_finish: {} }; }
    function gpRenderSessions() {}
    function gpSyncExportBtn() {}
    var window = {};
    function gpSessionsRefresh() {
        gp.sessions = Object.keys(STORE).map(function (k) { return STORE[k]; });
        return Promise.resolve(gp.sessions);
    }
`;

/* Tolerate a revision that predates the dedupe so this harness FAILS with a
   readable "library now holds 2" instead of exploding on a missing name — a
   harness that cannot run is worse than one that fails (see check_all.js). */
const build = new Function(prelude + parts.join('\n') + `
    /* The extracted code calls its own window.* exports by name — the shift
       range hands off to the plain toggle that way. Wired here, where the
       declarations exist. */
    ['gpSessPickToggle','gpSessPickRange','gpSessPickAll','gpSessPickClear','gpSessSortBy']
        .forEach(function (n) { try { window[n] = eval(n); } catch (e) {} });
    return { gpSessionMeta: gpSessionMeta, gpSessionSave: gpSessionSave,
             gpSessFiltered: (typeof gpSessFiltered === 'function') ? gpSessFiltered : null,
             gpSessSortBy: (typeof gpSessSortBy === 'function') ? gpSessSortBy : null,
             gpSessPicked: (typeof gpSessPicked === 'function') ? gpSessPicked : null,
             gpSessPickToggle: (typeof gpSessPickToggle === 'function') ? gpSessPickToggle : null,
             gpSessPickRange: (typeof gpSessPickRange === 'function') ? gpSessPickRange : null,
             gpSessPickAll: (typeof gpSessPickAll === 'function') ? gpSessPickAll : null,
             gpSessPickClear: (typeof gpSessPickClear === 'function') ? gpSessPickClear : null,
             gpSessionPrior: (typeof gpSessionPrior === 'function') ? gpSessionPrior : null,
             gpStints: gpStints,
             GAP: (typeof GP_STINT_GAP_S === 'number') ? GP_STINT_GAP_S : null,
             MIN: (typeof GP_STINT_MIN_S === 'number') ? GP_STINT_MIN_S : null,
             gp: gp, store: STORE,
             count: function () { return Object.keys(STORE).length; },
             puts: function () { return putCalls; },
             reset: function () {
                 for (var k in STORE) delete STORE[k];
                 gp.sessions = null; gp.sessionUpdated = 0; putCalls = 0;
             } };
`);
const F = build();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* A run of samples with a real GPS clock, the way a download arrives. */
function makeRows(startMs, n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
        rows.push({
            lat: -37.0 + i * 1e-5, lon: 145.0 + i * 1e-5,
            kph: 80, hdg: 90, t: startMs + i * 40, g: 0,
        });
    }
    return rows;
}

if (missing.length) console.log('(not in this revision: ' + missing.join(', ') + ')\n');

console.log('a recording knows when it started');
const T0 = Date.UTC(2026, 7, 16, 4, 30, 0);
const rowsA = makeRows(T0, 500);
let metaA = F.gpSessionMeta(rowsA, null);
ok('meta carries the first sample timestamp as startT', metaA.startT === T0,
   'got ' + metaA.startT + ', want ' + T0);
ok('a recording with no clock at all has startT null',
   F.gpSessionMeta([{ lat: 1, lon: 1, kph: 0, hdg: 0 }], null).startT === null);

console.log('\ndownloading the same ring twice');
F.reset();
(async () => {
    await F.gpSessionSave(rowsA);
    const afterFirst = F.count();
    ok('the first download saves one recording', afterFirst === 1, 'got ' + afterFirst);
    const firstId = Object.keys(F.store)[0];

    await F.gpSessionSave(rowsA);
    ok('downloading the very same ring again does NOT add a second copy',
       F.count() === 1, 'library now holds ' + F.count());
    ok('and it kept the same id rather than minting a new one',
       Object.keys(F.store)[0] === firstId);
    ok('the save was still written (samples replaced, not skipped)', F.puts() === 2,
       'put called ' + F.puts() + ' times');

    console.log('\nthe driver drives more and downloads again');
    const rowsAgrown = makeRows(T0, 900);      /* same start, more samples */
    await F.gpSessionSave(rowsAgrown);
    ok('a grown stint updates the same recording', F.count() === 1,
       'library now holds ' + F.count());
    ok('and the recording now has the longer sample count',
       F.store[firstId].samples === 900, 'got ' + F.store[firstId].samples);

    console.log('\nwhat the driver typed survives a re-download');
    F.store[firstId].name = 'Sunday morning';
    F.store[firstId].car = 'Evora';
    F.store[firstId].driver = 'Gareth';
    F.gp.sessions = null;                      /* force a reload from the store */
    await F.gpSessionSave(rowsAgrown);
    ok('a name the driver chose is kept', F.store[firstId].name === 'Sunday morning',
       'got ' + F.store[firstId].name);
    ok('the car is kept', F.store[firstId].car === 'Evora');
    ok('the driver is kept', F.store[firstId].driver === 'Gareth');

    console.log('\na genuinely different drive is still its own recording');
    const rowsB = makeRows(T0 + 3600 * 1000, 400);
    await F.gpSessionSave(rowsB);
    ok('a different start time saves as a new recording', F.count() === 2,
       'library holds ' + F.count());

    console.log('\na cold start must not duplicate');
    F.gp.sessions = null;                      /* the list is lazy; null = not loaded */
    await F.gpSessionSave(rowsA);
    ok('the first save after a cold start still finds the prior recording',
       F.count() === 2, 'library holds ' + F.count());

    console.log('\nan undateable recording cannot be matched, so it saves as new');
    const bare = [{ lat: 1, lon: 1, kph: 0, hdg: 0 }, { lat: 1, lon: 1, kph: 0, hdg: 0 }];
    const before = F.count();
    await F.gpSessionSave(bare);
    await F.gpSessionSave(bare);
    ok('two undateable saves stay two recordings, not silently merged',
       F.count() === before + 2, 'library holds ' + F.count());

    /* ---- the order they come back in -----------------------------------
     * There wasn't one. The table printed whatever the object store handed
     * back, which is insertion order — so on a track day six recordings from
     * one afternoon landed in whatever sequence they were imported or
     * downloaded in, under a date column that said the same thing on every
     * row.
     */
    if (!F.gpSessFiltered) {
        console.log('\n(gpSessFiltered not in this revision)');
    } else {
        const mk = (id, at, laps, best) => ({
            id: id, recordedAt: at, lapCount: laps, bestLapS: best,
            lapTimesS: best ? [best, best + 1] : [], name: id,
            trackName: 'Mallala', car: 'S13', driver: 'Tommy',
        });
        const ids = () => F.gpSessFiltered().map(s2 => s2.id).join('');
        /* Deliberately out of order going in. */
        const fixture = () => [
            mk('c', 4000, 6, 61.5), mk('a', 1000, 8, 62.4), mk('e', 500, 3, null),
            mk('d', 2000, 14, 63.0), mk('b', 3000, 11, 61.9),
        ];
        F.gp.sessions = fixture();
        F.gp.sessFilter = { q: '', track: null };
        F.gp.sessSort = null;

        console.log('\nsessions come back newest first');
        ok('the drive you just did is at the top', ids() === 'cbdae', ids());
        ok('and the library itself is left in the order it was in',
           F.gp.sessions.map(s2 => s2.id).join('') === 'caedb',
           F.gp.sessions.map(s2 => s2.id).join(''));

        console.log('\nthe header picks the column; picking it again reverses it');
        F.gpSessSortBy('when');
        ok('oldest first on the second press', ids() === 'eadbc', ids());
        F.gpSessSortBy('when');
        ok('and back again', ids() === 'cbdae', ids());

        F.gpSessSortBy('best');
        ok('best opens with the quickest, not the slowest', ids() === 'cbade', ids());
        ok('a session with no timed lap sorts to the END of it',
           ids().slice(-1) === 'e', ids());
        F.gpSessSortBy('best');
        ok('reversed, the untimed one leads instead', ids().charAt(0) === 'e', ids());

        F.gpSessSortBy('laps');
        ok('laps opens with the most', ids() === 'dbace', ids());

        console.log('\nties do not shuffle between renders');
        /* Two recordings can share a stamp — an import and the download it came
           from. Without a tiebreak they swap places on every render, which
           looks like the list reordering itself while you read it. */
        F.gp.sessions = [mk('z', 1000, 1, 60), mk('y', 1000, 1, 60), mk('x', 1000, 1, 60)];
        F.gp.sessSort = { by: 'when', dir: -1 };
        const first = ids();
        ok('the same stamp gives the same order every time',
           first === ids() && first === ids(), first);
        ok('and it is by id, so it survives a reload', first === 'xyz', first);

        console.log('\nthe filter still filters, and the sort still sorts');
        F.gp.sessions = fixture();
        F.gp.sessions[0].trackName = 'Winton';        /* c */
        F.gp.sessSort = { by: 'when', dir: -1 };
        F.gp.sessFilter = { q: '', track: 'Mallala' };
        ok('a track filter narrows it and keeps the order', ids() === 'bdae', ids());
        F.gp.sessFilter = { q: 'winton', track: null };
        ok('and so does the search box', ids() === 'c', ids());
        F.gp.sessFilter = { q: '', track: null };
    }

    /* ---- one download, however many outings are in it -------------------
     * A DRIFT day is not a circuit day. You queue two to six minutes with the
     * car stopped — the recorder writes nothing under 8 km/h, so that is a
     * hole in the clock — then take a run of twenty to sixty seconds, then
     * queue again. Both thresholds were written for a circuit and both cut it
     * in the wrong place.
     */
    console.log('\na drift day, through the stint splitter');
    const outing = (runSecs, queueSecs) => {
        const rows = [];
        let t = Date.UTC(2026, 7, 21, 9, 0, 0);
        runSecs.forEach((secs, k) => {
            const n = Math.round(secs * 25);
            for (let i = 0; i < n; i++) {
                rows.push({ lat: -34.7 + i * 1e-5, lon: 138.5 + i * 1e-5, kph: 60, hdg: 90, t: t });
                t += 40;
            }
            t += (queueSecs[k] || 0) * 1000;
        });
        return rows;
    };
    const kept = (rows) => {
        const all = F.gpStints(rows);
        const k = all.filter(s2 => s2.secs >= F.MIN);
        return { all: all, keep: k.length ? k : all };   /* mirrors gpSaveStints */
    };

    /* Eight runs, queued three to five minutes apart, plus a five-second
       shuffle in the paddock. */
    const DAY = outing([42, 38, 51, 5, 47, 33, 55, 29],
                       [200, 240, 190, 300, 210, 260, 220, 0]);
    let r = kept(DAY);
    ok('a whole drift day stays ONE recording, so its runs can be compared',
       r.keep.length === 1, r.keep.length + ' recordings: ' +
       r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));
    /* This is the feature: the Drift board rates each corner across the LAPS
       inside one recording ("your best here was lap 3"). Seven one-run
       recordings can be looked at but not compared. */

    console.log('\nand a real break still ends it');
    r = kept(outing([600, 600], [40 * 60, 0]));       /* lunch */
    ok('forty minutes stopped is two outings', r.keep.length === 2,
       r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));
    r = kept(outing([600, 600], [8 * 60, 0]));        /* a quick turnaround */
    ok('eight minutes is still the same outing', r.keep.length === 1,
       r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));

    console.log('\nnothing a person drove is thrown away');
    /* The old floor was 90 s. Not one run of a drift day reaches it, so the
       filter came back empty and the fallback kept the LAST run and binned
       the other seven — silently, and there is no getting them back. */
    r = kept(outing([42, 38, 51, 47], [20 * 60, 20 * 60, 20 * 60, 0]));
    ok('four short runs, properly separated, are four recordings — not one',
       r.keep.length === 4, r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));
    ok('a twenty-second run counts as a run',
       kept(outing([22], [0])).keep.length === 1);
    r = kept(outing([5, 40], [20 * 60, 0]));
    ok('a five-second paddock shuffle does not', r.keep.length === 1 &&
       Math.round(r.keep[0].secs) === 40, r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));
    /* Worst case: everything in the ring is a scrap. Keeping only the last
       one was a guess about which scrap mattered; keeping them all is not. */
    r = kept(outing([6, 7, 8], [20 * 60, 20 * 60, 0]));
    ok('when NOTHING clears the bar, all of it is kept rather than the last',
       r.keep.length === 3, r.keep.map(s2 => Math.round(s2.secs) + 's').join(' '));

    console.log('\nthe thresholds themselves');
    ok('a run is 20 s or more', F.MIN === 20, String(F.MIN));
    ok('an outing ends after 10 minutes stopped', F.GAP === 600, String(F.GAP));
    ok('and the gap is comfortably longer than any queue', F.GAP > 6 * 60);

        /* ---- picking several recordings at once --------------------------------
     * One row at a time was fine while a download was one recording. It is not:
     * a track day now arrives as an outing per session and a drift day as a
     * handful of runs, so clearing out the practice meant the same four clicks
     * over and over, each with its own confirm.
     */
    if (!F.gpSessPickToggle) {
        console.log('\n(session multi-select not in this revision)');
    } else {
        console.log('\nticks are kept by id, so a re-sort does not scatter them');
        const mkS = (id, at) => ({ id: id, name: id, recordedAt: at, lapCount: 1, bestLapS: 60,
                                   lapTimesS: [60], trackName: 'Mallala' });
        F.gp.sessions = [mkS('a', 1000), mkS('b', 2000), mkS('c', 3000), mkS('d', 4000)];
        F.gp.sessFilter = { q: '', track: null };
        F.gp.sessSort = { by: 'when', dir: -1 };
        F.gp.sessPick = {};
        const ids = () => F.gpSessPicked().map(s2 => s2.id).join('');

        F.gpSessPickToggle('b');
        F.gpSessPickToggle('d');
        ok('two ticked', ids() === 'bd', ids());
        F.gpSessSortBy('name');                       /* re-sort under them */
        ok('and they are still the same two after sorting', ids() === 'bd', ids());
        F.gpSessPickToggle('b');
        ok('ticking again unticks', ids() === 'd', ids());

        console.log('\nshift extends over the rows as they are shown');
        F.gp.sessPick = {};
        F.gp.sessSort = { by: 'when', dir: -1 };       /* d c b a */
        F.gpSessPickToggle('d');
        F.gp.sessPickLast = 'd';
        F.gpSessPickRange('b');
        ok('d through b takes c with it', ids() === 'bcd', ids());
        /* Order of the ARGUMENTS must not matter — dragging up a list is as
           ordinary as dragging down it. */
        F.gp.sessPick = {};
        F.gp.sessPickLast = 'b';
        F.gpSessPickRange('d');
        ok('and it works the other way round too', ids() === 'bcd', ids());
        /* An anchor that is no longer on screen is not a range. */
        F.gp.sessPick = {};
        F.gp.sessPickLast = 'zzz';
        F.gpSessPickRange('c');
        ok('a stale anchor just ticks the one you clicked', ids() === 'c', ids());

        console.log('\nselect-all means the rows you can SEE');
        F.gp.sessPick = {};
        F.gp.sessFilter = { q: '', track: null };
        F.gpSessPickAll(true);
        ok('with no filter that is everything', ids() === 'abcd', ids());
        F.gp.sessPick = {};
        F.gp.sessions[0].trackName = 'Winton';
        F.gp.sessFilter = { q: '', track: 'Winton' };
        F.gpSessPickAll(true);
        ok('with a filter up it is only the filtered ones', ids() === 'a', ids());
        /* Otherwise "tick all, delete" while a search box is up is a trap. */
        F.gp.sessFilter = { q: '', track: null };
        ok('and the ones off screen were never ticked', ids() === 'a', ids());

        console.log('\na tick can never outlive the recording it points at');
        F.gp.sessPick = { a: 1, b: 1, ghost: 1 };
        ok('an id that is gone is dropped', ids() === 'ab', ids());
        ok('and dropped from the set, not just from the answer',
           !F.gp.sessPick.ghost, JSON.stringify(F.gp.sessPick));

        F.gpSessPickClear();
        ok('clear empties it', F.gpSessPicked().length === 0);
    }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
