/* "History at this track" — the trend, and the sweep that fills it in.
 *
 * The feature was written and starving. It reads session METADATA only and
 * filters on trackId, but trackId is assigned ONCE at save from whatever track
 * was active, and only when the car came within 300 m of that track's line. So
 * every recording saved before its circuit was added, every .rdmsession from
 * another PC and every sim stint carries trackId: null and is invisible to the
 * trend — recognised, timed and analysed perfectly well, and not counted.
 *
 * There was already a heal for it, and it only ran when you OPENED a session.
 *
 * What is worth catching here is a sweep that does too much: overwriting a
 * filing somebody made, demoting a card that had laps, growing the track
 * library uninvited, or re-reading the whole library every time it is run.
 *
 *   node tools/check_history.js
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

const FNS = ['gpHistoryFor', 'gpCornerTrend', 'gpHistSpark', 'gpSesDay',
             'gpHistoryBackfillable', 'gpHistoryBackfill', 'gpTrackHistoryHtml'];
const parts = [], missing = [];
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

function env(opt) {
    opt = opt || {};
    const store = {};
    (opt.rowsById || {}) && Object.keys(opt.rowsById || {}).forEach(k => { store[k] = opt.rowsById[k]; });
    const gp = {
        sessions: opt.sessions || [],
        tracks: { active: opt.active === undefined ? 'keep' : opt.active,
                  tracks: opt.tracks || [] },
        sessionId: opt.sessionId || null,
        view: 'tracks'
    };
    const log = { msgs: [], putMeta: [], splitWith: [] };
    const shim = `
        var gp = ARGgp, LOG = ARGlog, STORE = ARGstore, HIT = ARGhit;
        function gpN(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }
        function gpEsc(s) { return String(s == null ? '' : s); }
        function gpSigned(v, dp, u) { return (v >= 0 ? '+' : '') + v.toFixed(dp) + (u || ''); }
        function gpLapTime(s) { return s === null || s === undefined ? '—' : s.toFixed(2); }
        function gpMetres(a, b) {
            var dy = (a.lat - b.lat) * 111320, dx = (a.lon - b.lon) * 91000;
            return Math.sqrt(dx * dx + dy * dy);
        }
        function gpSetMsg(id, t, tone) { LOG.msgs.push({ id: id, t: t, tone: tone }); }
        function gpBuildRail() { } function gpRenderInspector() { } function gpRenderSessions() { }
        function gpIsTrial(t) { return !!(t && t.trial); }
        function gpTrackReach(t) { return t && t.reach === false ? null : { lat: 0, lon: 0, spanKm: 1 }; }
        /* The geometry has its own harnesses (check_autotrack, check_runsplit).
           What is under test here is WHICH recordings the sweep touches and
           what it writes, so the match is a lookup the test controls. */
        function gpRowsAtTrack(rows, t) { return HIT[rows.id] === t.id; }
        function gpNearTrack(rows, t) { return HIT[rows.id] === t.id; }
        function gpRowsUnpack(pk) { return pk; }
        function gpSplitRows(rows) {
            LOG.splitWith.push(gp.tracks.active);
            return (rows.laps || []).map(function (l) { return l; });
        }
        function gpSpanSecs(rows, l) { return l.secs; }
        function gpSecs() { return 1; }
        function gpFindCorners() { return []; }
        var gpStore = {
            rows: function (id) { return Promise.resolve(STORE[id] || null); },
            putMeta: function (m) { LOG.putMeta.push(m.id); return Promise.resolve(); }
        };
        ${parts.join('\n')}
        return { gp: gp, log: log0(), forTrack: gpHistoryFor, trend: gpCornerTrend,
                 spark: gpHistSpark, pending: gpHistoryBackfillable,
                 sweep: gpHistoryBackfill, html: gpTrackHistoryHtml };
        function log0() { return LOG; }
    `;
    return new Function('ARGgp', 'ARGlog', 'ARGstore', 'ARGhit', shim)(
        gp, log, opt.rowsById || {}, opt.hit || {});
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
const S = (id, o) => Object.assign({ id: id, name: id, recordedAt: 1000, bestLapS: 60,
                                     lapTimesS: [60, 61], corners: [] }, o || {});

/* ══ the trend itself ════════════════════════════════════════════════════ */
console.log('the trend reads metadata and nothing else');
{
    const E = env({ sessions: [
        S('c', { trackId: 't1', recordedAt: 3000, bestLapS: 59 }),
        S('a', { trackId: 't1', recordedAt: 1000, bestLapS: 62 }),
        S('b', { trackId: 't1', recordedAt: 2000, bestLapS: 60 }),
        S('x', { trackId: 't2' }),
        S('n', { trackId: 't1', bestLapS: null })
    ] });
    const h = E.forTrack('t1');
    ok('only this track', h.every(s => s.trackId === 't1'));
    ok('…oldest first', h.map(s => s.id).join('') === 'abc', h.map(s => s.id).join(''));
    ok('…and a session with no lap time is not on a lap-time trend',
       !h.some(s => s.id === 'n'));
    ok('no track id, no trend', E.forTrack(null).length === 0);
}
{
    const E = env();
    ok('one session draws no sparkline — a line needs two points',
       E.spark([S('a')], null) === '');
    const flat = [S('a', { recordedAt: 1 }), S('b', { recordedAt: 2 })];
    ok('two identical times do not divide by zero', /polyline/.test(E.spark(flat, null)));
    const sameDay = [S('a', { recordedAt: 5, bestLapS: 60 }), S('b', { recordedAt: 5, bestLapS: 61 })];
    ok('two sessions at the same instant do not either', /polyline/.test(E.spark(sameDay, null)));
    ok('the current session is marked when there is one',
       /#d2232a/.test(E.spark([S('a', { recordedAt: 1 }), S('b', { recordedAt: 2 })], 'b')));
    ok('…and nothing is marked when there is not',
       !/#d2232a/.test(E.spark([S('a', { recordedAt: 1 }), S('b', { recordedAt: 2 })], null)));
}
{
    const E = env();
    const cur = [{ lat: 0, lon: 0, s: 5 }];
    ok('a corner 39 m away is the same corner',
       E.trend(cur, [{ lat: 39 / 111320, lon: 0, s: 6 }]).length === 1);
    ok('…and 41 m away is a different one',
       E.trend(cur, [{ lat: 41 / 111320, lon: 0, s: 6 }]).length === 0);
}

/* ══ which recordings the sweep will touch ═══════════════════════════════ */
console.log('\nthe sweep is careful about what it picks up');
{
    const base = {
        tracks: [{ id: 't1', name: 'Mallala' }],
        sessions: [
            S('none', { trackId: null }),
            S('filed', { trackId: 't1' }),
            S('said-no', { trackId: null, noTrack: true }),
            S('tried', { trackId: null, trackTried: 1 })
        ]
    };
    const E = env(base);
    const p = E.pending().map(m => m.id);
    ok('an unfiled recording is picked up', p.indexOf('none') >= 0);
    ok('one already filed is left alone', p.indexOf('filed') < 0);
    ok('a deliberate "no track" is left alone', p.indexOf('said-no') < 0);
    ok('one already tried against this library is not re-read', p.indexOf('tried') < 0);

    /* Adding a circuit is exactly what makes a second sweep worth running. */
    const G = env(Object.assign({}, base, {
        tracks: [{ id: 't1', name: 'Mallala' }, { id: 't2', name: 'The Bend' }]
    }));
    ok('…until the library grows, and then it is',
       G.pending().map(m => m.id).indexOf('tried') >= 0);

    ok('an empty library sweeps nothing at all',
       env({ tracks: [], sessions: base.sessions }).pending().length === 0);
}

/* ══ what it writes ══════════════════════════════════════════════════════ */
console.log('\nand careful about what it writes');
function sweepEnv(extra) {
    return env(Object.assign({
        active: 'keep',
        tracks: [{ id: 't1', name: 'Mallala' }],
        sessions: [S('m', { trackId: null, lapTimesS: [], bestLapS: null, lapCount: 0 })],
        /* An ARRAY with properties hung off it: the sweep checks rows.length
           before doing anything, exactly as it should, and a plain object
           fixture sailed straight past every assertion below by looking like
           an unreadable recording. */
        rowsById: { m: Object.assign([{}, {}], { id: 'm',
            laps: [{ from: 0, to: 9, secs: 61 }, { from: 10, to: 19, secs: 60 }] }) },
        hit: { m: 't1' }
    }, extra || {}));
}
{
    const E = sweepEnv();
    E.sweep().then(function () {
        const m = E.gp.sessions[0];
        ok('a match files the recording', m.trackId === 't1' && m.trackName === 'Mallala');
        ok('…with the laps that track cuts', m.lapCount === 2 && m.bestLapS === 60,
           JSON.stringify({ n: m.lapCount, best: m.bestLapS }));
        ok('…marked gate-timed', m.lapsBy === 'gate');
        ok('…and written through to the store', E.log.putMeta.indexOf('m') >= 0);
        ok('the active track is borrowed and given straight back',
           E.gp.tracks.active === 'keep', String(E.gp.tracks.active));
        ok('…and it really was borrowed while splitting',
           E.log.splitWith.join() === 't1', E.log.splitWith.join());
        ok('it says what it did', /Filed 1 recording/.test((E.log.msgs.slice(-1)[0] || {}).t || ''),
           (E.log.msgs.slice(-1)[0] || {}).t);
        run2();
    });
}
function run2() {
    /* A match that cuts no clean lap says where the car was and nothing about
       its times. Writing "0 laps" over a card is churn, and over a card that
       HAD laps it is the demotion the heal has always refused. */
    const E = sweepEnv({
        sessions: [S('m', { trackId: null, lapCount: 7, bestLapS: 58, lapTimesS: [58, 59] })],
        rowsById: { m: Object.assign([{}, {}], { id: 'm', laps: [] }) }
    });
    E.sweep().then(function () {
        const m = E.gp.sessions[0];
        ok('a match with no clean lap still files it', m.trackId === 't1');
        ok('…but never demotes the card it found', m.lapCount === 7 && m.bestLapS === 58,
           JSON.stringify({ n: m.lapCount, best: m.bestLapS }));
        run3();
    });
}
function run3() {
    const E = sweepEnv({ hit: {} });          /* nothing matches */
    E.sweep().then(function () {
        const m = E.gp.sessions[0];
        ok('no match leaves the filing null', m.trackId === null || m.trackId === undefined,
           String(m.trackId));
        ok('…but records that it was tried, so a second run does no work',
           m.trackTried === 1, String(m.trackTried));
        ok('…and says the recordings can still be recognised by opening them',
           /open one/.test((E.log.msgs.slice(-1)[0] || {}).t || ''),
           (E.log.msgs.slice(-1)[0] || {}).t);
        ok('running it again picks nothing up', E.pending().length === 0);
        run4();
    });
}
function run4() {
    /* The library is not grown by a sweep. gpMatchTrack would happily mint a
       track from its world list; that is a different feature from this one. */
    const E = sweepEnv({ hit: {} });
    const before = E.gp.tracks.tracks.length;
    E.sweep().then(function () {
        ok('the track library is never grown by a sweep',
           E.gp.tracks.tracks.length === before, String(E.gp.tracks.tracks.length));
        run5();
    });
}
function run5() {
    console.log('\nthe track’s own history panel');
    const E = env({
        tracks: [{ id: 't1', name: 'Mallala' }],
        sessions: [S('a', { trackId: 't1', recordedAt: 1000, bestLapS: 62 }),
                   S('b', { trackId: 't1', recordedAt: 2000, bestLapS: 59 })]
    });
    const h = E.html('t1', 'Mallala');
    ok('it names the place', /History at Mallala/.test(h));
    ok('it shows the personal best', /Personal best/.test(h));
    ok('…and how many days it is over', /over 1 day|over \d+ days/.test(h), h.slice(0, 200));
    ok('it needs no open session to say any of it', !/This session/.test(h));

    const empty = env({ tracks: [{ id: 't1', name: 'Mallala' }], sessions: [] });
    ok('a track with nothing saved says so plainly',
       /No saved recording here has a lap time yet/.test(empty.html('t1', 'Mallala')));

    ok('the offer to go and find them appears only when there are some',
       !/Match them to tracks/.test(h));
    const pend = env({
        tracks: [{ id: 't1', name: 'Mallala' }],
        sessions: [S('a', { trackId: 't1' }), S('u', { trackId: null })]
    });
    ok('…and does when there are', /Match them to tracks/.test(pend.html('t1', 'Mallala')));
    ok('…saying how many are missing from every trend',
       /1 saved recording is not filed/.test(pend.html('t1', 'Mallala')));

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
}
