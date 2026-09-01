/* Shared machinery for the golden-recording tests (ADR-0050).
 *
 * `tools/make_expected.js` writes an answer sheet with this; `check_golden.js`
 * checks against one with it. One copy, so the thing that blesses a number and
 * the thing that guards it cannot drift apart — if they did, the guard would
 * be measuring a different chain from the one a human signed off.
 *
 * Every function below is lifted VERBATIM out of src/tauri-overlay.html. A
 * copy would pass while the app failed, which is the whole reason the harness
 * style in this directory works the way it does.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');
const FIXTURES = path.join(__dirname, 'fixtures');

/* ---- lifting ----------------------------------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}
function varBlock(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1, d = 0, j = i;
    for (; j < SRC.length; j++) {
        const c = SRC[j];
        if (c === '[' || c === '{' || c === '(') d++;
        else if (c === ']' || c === '}' || c === ')') d--;
        else if (c === ';' && d === 0) { j++; break; }
    }
    return SRC.slice(m.index, j);
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const CONSTS = ['GP_DRIFT_MIN_KPH', 'GP_DRIFT_ON', 'GP_DRIFT_OFF',
    'GP_DRIFT_HOLD_S', 'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G',
    'GP_DRIFT_STAR_DEG', 'GP_DRIFT_STAR_SETTLE', 'GP_DRIFT_RHO_MIN_KPH',
    'GP_DRIFT_SPIN', 'GP_DRIFT_SPIN_DROP', 'GP_DRIFT_SCORE_VER',
    'GP_DRIFT_ROUGH', 'GP_MAX_STEP_S', 'GP_CHAN_STALE', 'GP_NO_T',
    'GP_BREAK_SLACK', 'GP_BREAK_FLOOR_M', 'GP_BREAK_QUIET_M',
    'GP_BREAK_QUIET_K', 'GP_BREAK_MAX_FRAC',
    'GP_COAST_G', 'GP_BRAKE_G', 'GP_CORNER_PAD',
    'GP_TURN_DPS', 'GP_TURN_MIN_S', 'GP_TURN_MIN_DEG', 'GP_TURN_SAME_S',
    'GP_RUN_STOP_KPH', 'GP_RUN_STOP_S', 'GP_RUN_MIN_S'];

const FNS = [
    'gpN', 'gpMetres', 'gpMetresPerDeg', 'gpHaversineM', 'gpSecs', 'gpStep', 'gpHz',
    'gpChanDefsById', 'gpChanFixes', 'gpChanFixApply', 'gpChanFixFor', 'gpChanRawRange',
    'gpChanWouldRead', 'gpChanDef', 'gpChanValue', 'gpChanDefsFor', 'gpDashChansCached',
    'gpChanQuiet',
    'gpSignedDist', 'gpCrossAt', 'gpSpanSecs', 'gpGateHits', 'gpMainDir',
    'gpChannels', 'gpComputeG', 'gpHeadingAt',
    'gpArcLength', 'gpCornerScan', 'gpFindCorners', 'gpCornerPhases', 'gpNearestIndex',
    'gpDeadMs', 'gpRunsFromCrossings', 'gpRunGapMs', 'gpRunBreakM', 'gpGradeRuns',
    'gpSplitRows', 'gpCleanRuns', 'gpMoveRuns', 'gpOrientGates',
    'gpNominalStep', 'gpMarkBreaks', 'gpGapS',
    'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess',
    'gpDriftSrcPrefs', 'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle',
    'gpDriftSeek', 'gpDriftSwitches', 'gpDriftSegments', 'gpDriftStats',
    'gpDriftForget',
    'gpVboClockMs', 'gpVboSpeedScale', 'gpVboParse',
    'gpB64', 'gpB64Dec', 'gpRowsUnpack', 'gpSessionFileParse'
];

/* A sandbox with one recording in it. `track` is the active track for the
   whole run — lap splitting needs one, and a golden fixture brings its own so
   the answers never depend on what is in anybody's library. */
function sandbox(track) {
    const gp = { tracks: { active: null, tracks: track ? [track] : [] } };
    const win = { localStorage: { getItem: () => null, setItem: () => { } } };
    const K = {};
    CONSTS.forEach(n => { K[n] = constOf(n); });
    K.GP_DRIFT_STAR_W = eval('(' + /var GP_DRIFT_STAR_W = (\{[^}]*\})/.exec(SRC)[1] + ')');

    const stubs = [
        'function gpEsc(s) { return String(s == null ? "" : s); }',
        'function gpSesUid() { return "ses_golden"; }',
        'function gpRowsPack(rows) { return { n: rows.length }; }',
        'function gpTracksSave() { }',
        'function gpAllChans() { return []; }',
        'function gpActiveTrack() { return ARGtrack; }'
    ].join('\n');

    const names = Object.keys(K);
    const args = ['gp', 'window', 'GP_DT', 'GP_TRACE_HZ', 'ARGtrack'].concat(names);
    const body = varBlock('GP_VBO_ROLE') + '\n' + varBlock('GP_PLACES') + '\n' +
        stubs + '\n' + FNS.map(grab).join('\n') +
        '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};';
    const API = new Function(...args, body)(
        gp, win, 1 / 25, 25, track || null, ...names.map(n => K[n]));
    return { API, gp };
}

/* ---- reading a fixture -------------------------------------------------- */
/* Three shapes, because the three recordings worth pinning arrived three
   different ways and converting them would risk moving the very numbers the
   sheet exists to hold still. */
function readFixture(spec) {
    const file = path.join(FIXTURES, spec.file);
    if (!fs.existsSync(file)) return null;
    const raw = /\.gz$/.test(file)
        ? zlib.gunzipSync(fs.readFileSync(file))
        : fs.readFileSync(file);

    if (spec.kind === 'ring') {
        /* The puck's own ring, one JSON object per sample. `ch` is the raw
           channel row and `yaw` is the gyro — the same two names the download
           maps into `can` and `gyroz`. */
        const rows = raw.toString('utf8').trim().split('\n').map(function (l) {
            const r = JSON.parse(l);
            return { lat: r.lat, lon: r.lon, kph: r.kph, hdg: r.hdg, t: r.t,
                     g: 0, can: r.ch || null,
                     gyroz: (r.yaw === undefined || r.yaw === null) ? undefined : r.yaw };
        });
        const side = path.join(FIXTURES, spec.meta || '');
        const meta = spec.meta && fs.existsSync(side)
            ? JSON.parse(fs.readFileSync(side, 'utf8')) : null;
        return { rows: rows, meta: meta,
                 track: (meta && meta.track) || null,
                 chanIds: null, chanDefs: null };
    }
    if (spec.kind === 'vbo') {
        const S = sandbox(null);
        const parsed = S.API.gpVboParse(raw.toString('utf8'), spec.file.replace(/\.gz$/, ''));
        const defs = parsed.meta.chanDefs;
        /* Storage parity: gpVboParse hands back the file's own floats, and a
           LOADED session carries u16 that every reader decodes with these
           defs. Encoding here exactly as saving does is not optional — skip it
           and the harness exercises a path the app never takes. */
        const rows = parsed.rows.map(function (r) {
            return { lat: r.lat, lon: r.lon, kph: r.kph, hdg: r.hdg, g: 0, t: r.ms,
                     can: r.cv && r.cv.map(function (v, k) {
                         return (v === null || v === undefined) ? null
                             : Math.max(0, Math.min(65535,
                                 Math.round((v - defs[k].offset) / defs[k].scale)));
                     }) };
        });
        return { rows: rows, meta: parsed.meta, track: null,
                 chanIds: parsed.meta.chanIds, chanDefs: defs, gates: parsed.gates };
    }
    if (spec.kind === 'rdmsession') {
        const S = sandbox(null);
        const parsed = S.API.gpSessionFileParse(raw.toString('utf8'));
        return { rows: S.API.gpRowsUnpack(parsed.pk), meta: parsed.meta, track: null,
                 chanIds: parsed.meta.chanIds, chanDefs: parsed.meta.chanDefs };
    }
    throw new Error('unknown fixture kind: ' + spec.kind);
}

/* ---- the chain, in the order gpSessionLoad runs it ---------------------- */
function analyse(spec) {
    const fx = readFixture(spec);
    if (!fx) return null;
    const track = fx.track || spec.track || null;
    const S = sandbox(track);
    const API = S.API, gp = S.gp;

    gp.trace = fx.rows;
    gp.traceChanIds = fx.chanIds || null;
    gp.traceChanDefs = fx.chanDefs || null;
    gp.ghostFence = null;
    gp.chan = null; gp.chanKey = '';
    gp.driftSrcPref = null; gp.driftUnit = 0;
    if (track) { gp.tracks.active = track.id || 't'; if (!track.id) track.id = 't'; }

    API.gpComputeG(gp.trace);
    const breaks = [];
    gp.trace.forEach(function (r, i) {
        if (r.brk) breaks.push({ i: i, m: Math.round(r.brkM), clockWrong: !!r.brkTime });
    });

    API.gpDriftForget();
    const diag = {};
    gp.traceLaps = track ? API.gpSplitRows(gp.trace, diag) : [];
    gp.selLap = gp.traceLaps.length ? 0 : -1;
    gp.cmpLap = -1;
    gp.lapsFrom = gp.traceLaps.length ? 'gate' : null;

    /* Why the gate did or did not cut it. On a recording that never reaches
       its own configured line this IS the answer, and pinning the distance
       stops a change to gate hit-testing from quietly turning a road drive
       into a timed session (or the reverse). */
    const gate = diag.start ? {
        nearestM: round(diag.start.nearestM, 1),
        samplesInBand: diag.start.samplesInBand,
        hits: (diag.start.hits || []).length,
        wrongWay: diag.startWrongWay || 0
    } : null;

    /* And what the app falls back to when nothing timed it. */
    let runs = null;
    if (!gp.traceLaps.length) {
        try {
            const mv = API.gpMoveRuns(gp.trace);
            runs = { count: mv.length,
                     secs: mv.map(function (r) { return round(API.gpSpanSecs(gp.trace, r), 1); }) };
            if (mv.length >= 2) { gp.traceLaps = mv; gp.lapsFrom = 'stops'; }
        } catch (e) { }
    }

    const clean = API.gpCleanRuns();
    const times = clean.map(function (l) { return API.gpSpanSecs(gp.trace, l); });
    const best = times.length ? Math.min.apply(null, times) : null;

    /* Corners on the best clean lap only — the same lap the session card is
       advertised by, so a change to corner detection shows up here. */
    let corners = null;
    if (times.length) {
        const bi = times.indexOf(best);
        corners = API.gpFindCorners(gp.trace, clean[bi].from, clean[bi].to).length;
    }

    let angle = null;
    try {
        const d = API.gpDriftAngle();
        if (d) {
            const confs = [];
            for (let i = 0; i < d.ok.length; i += Math.max(1, Math.floor(d.ok.length / 4000)))
                if (d.ok[i] && d.conf) confs.push(d.conf[i]);
            confs.sort(function (a, b) { return a - b; });
            let peak = 0, okN = 0;
            for (let i = 0; i < d.ok.length; i++)
                if (d.ok[i]) { okN++; if (Math.abs(d.beta[i]) > peak) peak = Math.abs(d.beta[i]); }
            angle = {
                src: d.src || null, weak: !!d.weak, anchors: d.anchors,
                fitN: d.fitN, okSamples: okN,
                scale: round(d.scale, 4), bias: round(d.bias, 4),
                peakDeg: round(peak, 1),
                typicalDeg: confs.length ? round(confs[Math.floor(confs.length / 2)], 2) : null,
                worstDeg: round(d.worst, 2)
            };
        }
    } catch (e) { angle = { error: String(e && e.message || e) }; }

    let quiet = null;
    try {
        const q = API.gpChanQuiet();
        if (q) quiet = q.reduce(function (a, b) { return a + (b ? 1 : 0); }, 0);
    } catch (e) { }

    /* Returned as the SHEET's own shape, not as live objects. gpDriftSource
       hands back a descriptor carrying a function, which survives here and
       vanishes through JSON — so a fresh run and a stored sheet compared
       unequal on a field neither of them really has. Normalise once, here,
       rather than teaching every caller about it. */
    return JSON.parse(JSON.stringify({
        samples: gp.trace.length,
        /* The MEDIAN cadence, not the end-to-end average: this ring spans a
           16-hour overnight park, and averaging across that reported 2.6 Hz
           for a 25 Hz recording. gpNominalStep is what gpMarkBreaks itself
           uses, for the same reason. */
        hz: round(1 / API.gpNominalStep(gp.trace), 3),
        breaks: { count: breaks.length,
                  atIndices: breaks.map(function (b) { return b.i; }),
                  metres: breaks.map(function (b) { return b.m; }),
                  clockWrongAt: breaks.filter(function (b) { return b.clockWrong; })
                                      .map(function (b) { return b.i; }) },
        gate: gate,
        runs: runs,
        laps: { by: gp.lapsFrom, all: gp.traceLaps.length, clean: clean.length,
                timesS: times.map(function (t) { return round(t, 3); }),
                bestS: best === null ? null : round(best, 3) },
        corners: corners,
        channels: { count: (fx.chanIds || (fx.rows[0] && fx.rows[0].can) || []).length,
                    silent: quiet },
        angle: angle
    }));
}

function round(v, dp) {
    if (typeof v !== 'number' || !isFinite(v)) return null;
    const k = Math.pow(10, dp);
    return Math.round(v * k) / k;
}

module.exports = { sandbox, readFixture, analyse, round, FIXTURES, ROOT };
