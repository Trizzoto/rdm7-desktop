/* Does the drift angle the app draws match the angle the car actually held?
 *
 * Pulls the real engine out of src/tauri-overlay.html — no copies, because a
 * copy drifts and then passes while the app fails — and runs it against a
 * drive whose true slip angle is known by construction: the path and the
 * angle are both analytic, so the body's yaw rate is exactly the sum of the
 * path's turn rate and the angle's rate of change, with no approximation
 * anywhere in the ground truth.
 *
 * The gyro is corrupted the way a real one is: a scale error of about a
 * percent (the sleeper term — a percent of 50 deg/s held for ten seconds is
 * five degrees), a fixed zero offset, and white noise. Position gets receiver
 * noise; heading does not, for the reason check_line.js explains.
 *
 * What is checked, in one sentence each:
 *   - a known angle comes back, to within the error bar the engine claims
 *   - a gripping car does NOT come back with a drift in it
 *   - with nothing measuring angle, the engine returns nothing at all
 *   - the error bar is honest: it is not smaller than the real error
 *
 *   node tools/check_drift.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

/* ---- extract named functions verbatim ---------------------------------- */
function grab(src, name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: function ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j);
}
function constOf(name) {
    const m = new RegExp('var ' + name + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (m && m[1].indexOf('0x') === 0) return parseInt(m[1], 16);
    if (!m) throw new Error('not found: var ' + name);
    return parseFloat(m[1]);
}

const WANT = [
    'gpN', 'gpMetres', 'gpMetresPerDeg', 'gpSecs', 'gpStep', 'gpChanDefsById',
    'gpSignedDist', 'gpGateHits', 'gpMainDir', 'gpChannels',
    'gpGapS', 'gpDriftRuns', 'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess',
    'gpDriftSrcPrefs', 'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle',
    'gpDriftSeek', 'gpDriftSwitches', 'gpDriftSegments', 'gpDriftStats',
    'gpCourses', 'gpCourseActive', 'gpCourseStamp', 'gpCourseClean',
    'gpZoneGeom', 'gpZoneNear', 'gpDriftCard', 'gpDriftBest', 'gpDriftForget',
    'gpRowsPack', 'gpRowsUnpack'
];
const K = {};
['GP_DRIFT_MIN_KPH', 'GP_DRIFT_GAP_S', 'GP_DRIFT_MIN_S', 'GP_DRIFT_ON', 'GP_DRIFT_OFF',
 'GP_DRIFT_HOLD_S', 'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G', 'GP_DRIFT_CLIP_FADE_M',
 'GP_DRIFT_MIN_SHAPE_M', 'GP_DRIFT_SCORE_VER', 'GP_DRIFT_ROUGH', 'GP_MAX_STEP_S',
 'GP_NO_T', 'GP_CHAN_STALE'].forEach(n => K[n] = constOf(n));
const GP_DT = 1 / 25;

const gp = {};
const win = { localStorage: { getItem: () => null, setItem: () => {} } };
/* gpZoneGeom's projection cache — an implementation detail of the app's
   module scope, supplied here so the extracted function runs. It lives in a
   WeakMap rather than on the element so it never reaches localStorage. */
const ARGN = ['gp', 'window', 'GP_DT', 'gpActiveTrack', 'GP_ZONE_GEO', 'gpAllChans', ...Object.keys(K)];
/* The one shell function the engine reaches for. Stubbed rather than
   extracted: it walks the whole track library, which is not what is under
   test here. */
const fakeTrack = { id: 't', name: 'Test', courses: [] };
/* The channel LIBRARY — what was picked off the dash or typed in. A puck
   download's channel ids are described here and nowhere else, which is the
   path the Drift view used to miss entirely. */
let libChans = [];
const API = new Function(...ARGN,
    WANT.map(n => grab(SRC, n)).join('\n') +
    '\n;return {' + WANT.map(n => n + ':' + n).join(',') + '};'
)(gp, win, GP_DT, () => fakeTrack, new WeakMap(), () => libChans, ...Object.keys(K).map(n => K[n]));

/* ---- ground truth ------------------------------------------------------- */
const CLAT = -36.5266, CLON = 146.0899;
const MLAT = 111320, MLON = 111320 * Math.cos(CLAT * Math.PI / 180);
const D2R = Math.PI / 180;

let _s = 987654321;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/* smoothstep, so the angle has a continuous derivative and the ground truth
   is differentiable everywhere the engine looks at it */
const ss = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/* a plateau: rises over `up` seconds from t0, holds, falls over `dn` */
function bump(t, t0, up, hold, dn, amp) {
    if (t < t0 || t > t0 + up + hold + dn) return 0;
    if (t < t0 + up) return amp * ss((t - t0) / up);
    if (t < t0 + up + hold) return amp;
    return amp * (1 - ss((t - t0 - up - hold) / dn));
}

/* The drive: two long straights with two drifted corners between them, then a
   flick from one side to the other. Straights are what the engine anchors on,
   so a course with none would be testing a case the app calls soft anyway. */
const V = 60 / 3.6;                       /* m/s, held */
function chiOf(t) {                        /* course over ground, degrees */
    /* Two left corners and a right-left flick, all drifted — then two more
       corners driven on the GRIP, with no angle in them at all.
       Those last two are not decoration. The scale fit calibrates the gyro
       against cornering the car is not sideways in, and a drive that drifts
       every corner it has gives it nothing to work with: it then correctly
       refuses to fit, which is honest but tests none of the arithmetic. Real
       recordings have grip in them — you drive to the drift section. */
    return 90 * ss((t - 12) / 6) + 90 * ss((t - 34) / 6)
         - 70 * ss((t - 56) / 4) + 70 * ss((t - 63) / 4)
         + 85 * ss((t - 74) / 5) - 85 * ss((t - 86) / 5);
}
function betaOf(t) {                       /* true slip angle, degrees */
    return bump(t, 11, 1.6, 5.0, 2.2, 38)      /* first corner, one way */
         + bump(t, 33, 1.6, 5.0, 2.2, 34)      /* second corner, same way */
         - bump(t, 55, 1.2, 2.4, 1.0, 30)      /* flick: the other way */
         + bump(t, 62, 1.2, 2.4, 1.0, 30);     /* and back */
}
const dOf = (f, t) => (f(t + 1e-4) - f(t - 1e-4)) / 2e-4;

const GYRO_SCALE = 1.008, GYRO_BIAS = 0.42, GYRO_NOISE = 0.35;
const CH_SCALE = 0.01, CH_OFF = -327.68;

function makeRun(opt) {
    opt = opt || {};
    const T = opt.T === undefined ? 98 : opt.T;
    const beta = opt.beta || betaOf;
    const chi = opt.chi || chiOf;
    const n = Math.round(T / GP_DT);
    const rows = [];
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
        const t = i * GP_DT;
        /* integrate position in ten substeps so the path is the path, not a
           polygon approximating it */
        if (i) for (let k = 0; k < 10; k++) {
            const tt = t - GP_DT + GP_DT * (k + 0.5) / 10, c = chi(tt) * D2R;
            x += V * Math.sin(c) * GP_DT / 10;
            y += V * Math.cos(c) * GP_DT / 10;
        }
        const v = opt.kphAt ? opt.kphAt(t) : V * 3.6;
        const rBody = dOf(chi, t) + dOf(beta, t);
        const meas = rBody * (opt.gyroScale === undefined ? GYRO_SCALE : opt.gyroScale)
                   + (opt.gyroBias === undefined ? GYRO_BIAS : opt.gyroBias)
                   + gauss() * GYRO_NOISE;
        const raw = Math.max(0, Math.min(65535, Math.round((meas - CH_OFF) / CH_SCALE)));
        /* Heading carries noise too. It is far cleaner than position — a
           receiver derives it from Doppler — but it is NOT exact, and giving
           it zero error hid a real bias: the scale fit regresses the gyro on
           the course rate, differentiating heading over 0.24 s amplifies its
           noise to a couple of deg/s, and noise in the REGRESSOR pulls an
           ordinary least-squares slope toward zero by about the same 1% the
           fit exists to measure. */
        const hdgN = opt.hdgNoise === undefined ? 0.3 : opt.hdgNoise;
        rows.push({
            lat: CLAT + (y + gauss() * 0.35) / MLAT,
            lon: CLON + (x + gauss() * 0.35) / MLON,
            kph: v,
            hdg: ((chi(t) + gauss() * hdgN) % 360 + 360) % 360,
            g: 0, t: Math.round(t * 1000),
            can: opt.noChan ? null : [raw]
        });
    }
    return rows;
}

function load(rows, defs, ids, lib) {
    libChans = lib || [];
    gp.trace = rows;
    gp.ghostFence = null;
    gp.sessionId = null;
    gp.traceChanIds = ids === undefined ? ['gyroz'] : ids;
    gp.traceChanDefs = defs === undefined
        ? [{ id: 'gyroz', name: 'Yaw rate', unit: 'deg/s', scale: CH_SCALE, offset: CH_OFF, decimals: 2 }]
        : defs;
    gp.chan = null; gp.chanKey = '';
    gp.selLap = -1; gp.driftSel = 0;
    gp.driftSrcPref = null;
    fakeTrack.courses = [];
    gp.courseId = null;
    API.gpDriftForget();
}

/* ---- checks ------------------------------------------------------------- */
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
function head(s) { console.log('\n' + s); }

head('A known angle, recovered');
{
    const rows = makeRun();
    load(rows);
    const d = API.gpDriftAngle();
    ok('an angle source is found', !!d);
    ok('it is worked out, not passed through', d && !d.direct);

    let sum = 0, cnt = 0, worstErr = 0, truePeak = 0, estPeak = 0;
    for (let i = 0; i < rows.length; i++) {
        const tb = betaOf(i * GP_DT);
        if (Math.abs(tb) > truePeak) truePeak = Math.abs(tb);
        if (!d.ok[i]) continue;
        if (Math.abs(d.beta[i]) > estPeak) estPeak = Math.abs(d.beta[i]);
        const e = Math.abs(d.beta[i] - tb);
        sum += e * e; cnt++;
        if (e > worstErr) worstErr = e;
    }
    const rms = Math.sqrt(sum / cnt);
    ok('RMS error under 3 deg', rms < 3, 'rms ' + rms.toFixed(2) + ' deg over ' + cnt + ' samples');
    ok('worst sample under 6 deg', worstErr < 6, 'worst ' + worstErr.toFixed(2) + ' deg');
    ok('peak angle within 3 deg of true', Math.abs(estPeak - truePeak) < 3,
       'true ' + truePeak.toFixed(1) + ', drawn ' + estPeak.toFixed(1));

    ok('gyro scale error is found', Math.abs(d.scale - GYRO_SCALE) < 0.004,
       'true ' + GYRO_SCALE + ', fitted ' + d.scale.toFixed(4));
    ok('gyro zero offset is found', Math.abs(d.bias - GYRO_BIAS) < 0.25,
       'true ' + GYRO_BIAS + ', fitted ' + d.bias.toFixed(3));
    ok('the fit is not flagged weak', !d.weak);
    ok('it found straights to anchor on', d.anchors > 2, d.anchors + ' anchors');

    /* The error bar has one job: never to be smaller than the error. */
    let over = 0, tot = 0;
    for (let i = 0; i < rows.length; i++) {
        if (!d.ok[i]) continue;
        tot++;
        if (Math.abs(d.beta[i] - betaOf(i * GP_DT)) > d.conf[i]) over++;
    }
    ok('the claimed +/- covers the real error', over / tot < 0.05,
       (100 * over / tot).toFixed(1) + '% of samples outside their own error bar');
}

head('A gripping car does not come back with a drift in it');
{
    const rows = makeRun({ beta: () => 0 });
    load(rows);
    const d = API.gpDriftAngle();
    let peak = 0;
    for (let i = 0; i < rows.length; i++) if (d.ok[i] && Math.abs(d.beta[i]) > peak) peak = Math.abs(d.beta[i]);
    ok('phantom angle stays under the drift threshold', peak < K.GP_DRIFT_ON,
       'peak ' + peak.toFixed(2) + ' deg vs ' + K.GP_DRIFT_ON + ' deg threshold');
    ok('no drift segments are invented', API.gpDriftSegments().length === 0,
       API.gpDriftSegments().length + ' segments');
}

head('Nothing measured it, so nothing is drawn');
{
    const rows = makeRun({ noChan: true });
    load(rows, [], []);
    ok('no channels: no angle at all', API.gpDriftAngle() === null);
    ok('and no segments', API.gpDriftSegments().length === 0);
    /* ...but the geometry still works */
    const sw = API.gpDriftSwitches();
    ok('switches still found from the path alone', sw.length >= 2, sw.length + ' switches');

    /* a channel that is neither a rate nor an angle must not be pressed into service */
    const rows2 = makeRun();
    load(rows2, [{ id: 'rpm', name: 'Engine speed', unit: 'rpm', scale: 1, offset: 0, decimals: 0 }], ['rpm']);
    ok('an rpm channel is not mistaken for a gyro', API.gpDriftAngle() === null);

    /* a steering-wheel RATE is deg/s and is still not the car's yaw */
    load(rows2, [{ id: 'sw', name: 'Steering wheel rate', unit: 'deg/s', scale: 1, offset: 0, decimals: 0 }], ['sw']);
    ok('a steering rate is not mistaken for yaw', API.gpDriftAngle() === null);
}

head("The puck's own gyro, logged in the record");
{
    /* No CAN channels at all. The yaw rate arrives as a first-class field of
       the 14-byte record, quantised the way the firmware quantises it —
       0.02 deg/s per LSB, saturated one short of the sentinel. This is the
       tier that works on a car with nothing on its bus. */
    const rows = makeRun();
    rows.forEach((r, i) => {
        const t = i * GP_DT;
        const meas = (dOf(chiOf, t) + dOf(betaOf, t)) * GYRO_SCALE + GYRO_BIAS + gauss() * GYRO_NOISE;
        r.gyroz = Math.max(-32767, Math.min(32767, Math.round(meas * 50))) / 50;
        r.can = null;
    });
    load(rows, [], []);
    ok('the recording knows it has one', API.gpHaveGyro());
    const chans = API.gpDriftChans();
    ok('it offers itself as a source', chans.length === 1 && chans[0].id === 'puck:gyroz',
       chans.map(c => c.id).join(','));
    const d = API.gpDriftAngle();
    ok('and the angle is worked out from it, unprompted',
       !!d && !d.direct && d.src.id === 'puck:gyroz');
    ok('the scale is still recovered', d && Math.abs(d.scale - GYRO_SCALE) < 0.01,
       d ? 'fitted ' + d.scale.toFixed(4) : '');
    let worst = 0;
    for (let i = 0; i < rows.length; i++)
        if (d && d.ok[i]) worst = Math.max(worst, Math.abs(d.beta[i] - betaOf(i * GP_DT)));
    ok('to the same accuracy as a bus channel', worst < 3, 'worst ' + worst.toFixed(2) + ' deg');

    /* Storage round trip: the field has to survive being saved and reopened,
       and 0 deg/s must never be confused with "no reading". */
    const pk = API.gpRowsPack(rows);
    ok('it packs as a signed array', pk.gyro && pk.gyro.constructor === Int16Array);
    const back = API.gpRowsUnpack(pk);
    let dmax = 0;
    for (let i = 0; i < rows.length; i++) dmax = Math.max(dmax, Math.abs(back[i].gyroz - rows[i].gyroz));
    ok('and round-trips bit-exactly', dmax === 0, 'worst difference ' + dmax);

    /* A left-hand yaw is negative. Carried as an unsigned CAN column it would
       come back as 65535 — the stale marker — and read as "said nothing". */
    const neg = rows.slice(0, 300).map(r => Object.assign({}, r, { gyroz: -12.34 }));
    const nb = API.gpRowsUnpack(API.gpRowsPack(neg));
    ok('a left-hand yaw survives as a left-hand yaw', Math.abs(nb[0].gyroz - -12.34) < 1e-9,
       String(nb[0].gyroz));

    /* Absence is a missing key, never a magic number: zero deg/s is an
       ordinary reading meaning the car was going straight. */
    const bare = rows.slice(0, 300).map(r => { const c = Object.assign({}, r); delete c.gyroz; return c; });
    const bb = API.gpRowsUnpack(API.gpRowsPack(bare));
    ok('a recording with no gyro stays that way', bb[0].gyroz === undefined && !API.gpRowsPack(bare).gyro);
    const zero = rows.slice(0, 300).map(r => Object.assign({}, r, { gyroz: 0 }));
    const zb = API.gpRowsUnpack(API.gpRowsPack(zero));
    ok('and a genuine zero is not mistaken for absence', zb[0].gyroz === 0);
}

head('A car-bus channel outranks the puck when both exist');
{
    /* Strictly additive: a recording that already chose a yaw channel off the
       car keeps choosing it, and the puck's gyro is only the fallback. */
    const rows = makeRun();
    rows.forEach((r, i) => { r.gyroz = 0; });     /* present, but useless */
    load(rows, undefined, undefined);
    const chans = API.gpDriftChans();
    ok('both are offered', chans.length === 2, chans.map(c => c.id).join(','));
    ok('the car channel is first', chans[0].id === 'gyroz');
    ok('so it is the one chosen', API.gpDriftAngle().src.id === 'gyroz');
}

head('A channel described by the library, not by the recording');
{
    /* The puck path. A downloaded recording carries channel IDs; what they
       MEAN lives in the channel library (picked off the dash, or typed in),
       never in the recording. Resolving only the recording's own definitions
       meant a GT86's yaw rate reached the Drift view unnamed, unitless and
       undecoded — raw CAN counts — while the graph rack one panel away drew
       the same channel correctly scaled. */
    const rows = makeRun();
    for (let i = 0; i < rows.length; i++) {
        const t = i * GP_DT;
        const truth = dOf(chiOf, t) + dOf(betaOf, t);
        const meas = truth * GYRO_SCALE + GYRO_BIAS + gauss() * GYRO_NOISE;
        /* a GT86-ish decode: counts, scale 0.1, big offset */
        rows[i].can = [Math.max(0, Math.min(65535, Math.round((meas + 1024) / 0.1)))];
    }
    load(rows, null, ['dash:yaw'], [
        { id: 'dash:yaw', name: 'Yaw rate', unit: 'deg/s', decimals: 2, decode: { scale: 0.1, offset: -1024 } }
    ]);
    const ch = API.gpDriftChans();
    ok('the library supplies the name and unit', ch.length === 1 && ch[0].unit === 'deg/s',
       JSON.stringify(ch[0] && { name: ch[0].name, unit: ch[0].unit, scale: ch[0].scale }));
    ok('and the decode, so the value is degrees not counts', ch[0] && ch[0].scale === 0.1 && ch[0].offset === -1024);
    const d = API.gpDriftAngle();
    ok('so the angle is found with no help from the user', !!d && !d.direct);
    let worst = 0;
    for (let i = 0; i < rows.length; i++)
        if (d && d.ok[i]) worst = Math.max(worst, Math.abs(d.beta[i] - betaOf(i * GP_DT)));
    ok('and it is right', worst < 3, 'worst ' + worst.toFixed(2) + ' deg');
}

head('A channel with no unit is never guessed at');
{
    /* The promise the view makes in so many words: "the units are what this
       goes on, and a channel with none cannot be guessed at safely". Stripping
       the degree sign before testing made "°" and "" the same string, so a
       blank unit was read as degrees — a radian channel called Slip would have
       been wrong by 57x with nothing on screen looking odd. */
    const rows = makeRun();
    load(rows, [{ id: 'slip', name: 'Slip angle', unit: '', scale: 1, offset: 0, decimals: 2 }], ['slip']);
    ok('a unitless "Slip angle" is not taken as degrees', API.gpDriftAngle() === null);
    load(rows, [{ id: 'slip', name: 'Slip angle', unit: '°', scale: 1, offset: 0, decimals: 2 }], ['slip']);
    const d2 = API.gpDriftAngle();
    ok('the degree SIGN still works, though', !!d2 && d2.direct);
    load(rows, [{ id: 'y', name: 'Yaw rate', unit: '°/s', scale: CH_SCALE, offset: CH_OFF, decimals: 2 }], ['y']);
    const d3 = API.gpDriftAngle();
    ok('and so does °/s', !!d3 && !d3.direct);
}

head('An angle with nothing to anchor it is not scored');
{
    /* A continuous curve gives no provably-straight moment, so the number is
       an unchecked integral. It used to be marked +/-6 while the greying gate
       was 8 — printed as an ordinary figure and fed into the scorecard. */
    const rows = makeRun({ T: 60, chi: t => 12 * t, beta: t => (t > 4 ? 30 : 30 * ss(t / 4)) });
    load(rows);
    const st = API.gpDriftStats({ from: 0, to: rows.length - 1 });
    ok('it is flagged rough', st.angle && st.angle.rough, 'conf +/-' + (st.angle ? st.angle.conf.toFixed(0) : '?'));
    ok('and says WHY — nothing was straight, not "it did not close"', st.angle && st.angle.soft);
    fakeTrack.courses = [API.gpCourseClean({ id: 'c', name: 'c', target_kph: 60, target_deg: 30, elements: [] })];
    gp.courseId = 'c';
    const card = API.gpDriftCard({ from: 0, to: rows.length - 1 }, API.gpCourseActive());
    ok('so the scorecard leaves angle out entirely', card.noAngle && !card.angle,
       'out of ' + card.max);
}

head('An instrument that measured the angle itself');
{
    const rows = makeRun();
    /* re-encode the channel as the angle, not the rate */
    for (let i = 0; i < rows.length; i++)
        rows[i].can = [Math.max(0, Math.min(65535, Math.round((betaOf(i * GP_DT) - CH_OFF) / CH_SCALE)))];
    load(rows, [{ id: 'slip', name: 'Drift angle', unit: 'deg', scale: CH_SCALE, offset: CH_OFF, decimals: 2 }], ['slip']);
    const d = API.gpDriftAngle();
    ok('it is recognised as an angle', !!d && d.direct);
    let worst = 0;
    for (let i = 0; i < rows.length; i++)
        if (d.ok[i]) worst = Math.max(worst, Math.abs(d.beta[i] - betaOf(i * GP_DT)));
    ok('passed through unchanged', worst < 0.02, 'worst difference ' + worst.toFixed(4) + ' deg');
}

head('The state machine');
{
    const rows = makeRun();
    load(rows);
    const segs = API.gpDriftSegments();
    ok('four drifts found', segs.length === 4, segs.length + ' segments');
    if (segs.length) {
        ok('the first is the 38 deg corner', Math.abs(segs[0].peak - 38) < 3,
           'peak ' + segs[0].peak.toFixed(1) + ' deg');
        ok('it knows how long it was held', segs[0].secs > 6 && segs[0].secs < 12,
           segs[0].secs.toFixed(1) + ' s');
        ok('a steady angle reads as steady', segs[0].wobble < 12,
           'wobble ' + segs[0].wobble.toFixed(1) + ' deg');
        ok('none of them is flagged rough', segs.every(s => !s.rough));
    }
    const st = API.gpDriftStats({ from: 0, to: rows.length - 1 });
    ok('the run knows its widest angle', Math.abs(st.angle.peak - 38) < 3,
       st.angle.peak.toFixed(1) + ' deg');
    ok('the run knows how long it was sideways', st.angle.secs > 14 && st.angle.secs < 30,
       st.angle.secs.toFixed(1) + ' s');
    ok('entry and exit speeds are the speeds', Math.round(st.entryKph) === 60 && Math.round(st.exitKph) === 60);
}

head('Below 25 km/h the angle is not knowable, and says so');
{
    const rows = makeRun({ kphAt: t => (t > 40 && t < 46 ? 12 : 60) });
    load(rows);
    const d = API.gpDriftAngle();
    let slowOk = 0, slowN = 0;
    for (let i = 0; i < rows.length; i++) {
        const t = i * GP_DT;
        if (t > 41 && t < 45) { slowN++; if (d.ok[i]) slowOk++; }
    }
    ok('no angle is claimed at walking pace', slowOk === 0, slowN + ' slow samples, ' + slowOk + ' claimed');
}

head('Runs');
{
    /* Three bursts of driving with long gaps between them, the way a practice
       day arrives off the puck.

       Each burst runs the full 78 s, which matters: the drive ENDS straight.
       Cutting it at 40 s left the car at 34 degrees when the recording
       stopped, which no real recording does — the node writes nothing under
       8 km/h, so a gap means the car came to a stop, and a car does not go
       from 34 degrees of drift to parked between two samples. The engine was
       right to refuse that fixture; it flagged those exact samples at +/-17
       and the error there really was 33 degrees. */
    const T = 78, GAP = 90000;
    const a = makeRun({ T }), b = makeRun({ T }), c = makeRun({ T });
    const shift = (rows, ms) => rows.map(r => Object.assign({}, r, { t: r.t + ms }));
    const all = shift(a, 0).concat(shift(b, T * 1000 + GAP),
                                   shift(c, 2 * (T * 1000 + GAP)));
    load(all);
    const runs = API.gpDriftRuns();
    ok('three runs found from the gaps', runs.length === 3, runs.length + ' runs');
    if (runs.length === 3) {
        ok('the first ends where the gap starts', runs[0].to === a.length - 1);
        ok('the second starts after it', runs[1].from === a.length);
    }
    /* The seam between two runs must not leak into either of them. Before the
       gap was made a hard break, a run beside a 95 s hole came back claiming
       four times the error bar its own driving was worth. */
    load(all);
    const d3 = API.gpDriftAngle();
    let mid = 0;
    for (let i = a.length; i < a.length + b.length; i++) if (d3.ok[i]) mid = Math.max(mid, d3.conf[i]);
    ok('a gap does not widen the error bar beside it', mid < 4, 'run 2 worst +/-' + mid.toFixed(1) + ' deg');
    let e2 = 0;
    for (let i = a.length; i < a.length + b.length; i++)
        if (d3.ok[i]) e2 = Math.max(e2, Math.abs(d3.beta[i] - betaOf((i - a.length) * GP_DT)));
    ok('and the run beside it is still right', e2 < 3, 'worst error ' + e2.toFixed(2) + ' deg');

    /* one unbroken stretch is one run */
    load(makeRun({ T: 40 }));
    ok('one unbroken stretch is one run', API.gpDriftRuns().length === 1);
    /* a stretch shorter than the floor is not a run at all */
    load(makeRun({ T: 3 }));
    ok('three seconds is not a run', API.gpDriftRuns().length === 0);
}

head('Courses: clips, zones and the shrinking denominator');
{
    const rows = makeRun();
    load(rows);
    /* a clip planted exactly 4 m to the side of a point the car passes */
    const at = 500;
    const m = API.gpMetresPerDeg(rows[at].lat);
    const h = rows[at].hdg * D2R;
    const clipLat = rows[at].lat + (4 * Math.cos(h + Math.PI / 2)) / m.la;
    const clipLon = rows[at].lon + (4 * Math.sin(h + Math.PI / 2)) / m.lo;
    /* a zone laid along 60 m of the path the car definitely drives */
    const zpts = [];
    for (let i = 200; i <= 290; i += 10) zpts.push([rows[i].lat, rows[i].lon]);

    fakeTrack.courses = [API.gpCourseClean({
        id: 'c1', name: 'Test course', target_kph: 60, target_deg: 30,
        elements: [
            { k: 'clip', name: 'Clip 1', lat: clipLat, lon: clipLon, r: 3, max: 10 },
            { k: 'zone', name: 'Zone 1', pts: zpts, band: 3, max: 15 }
        ]
    })];
    gp.courseId = 'c1';
    const card = API.gpDriftCard({ from: 0, to: rows.length - 1 }, API.gpCourseActive());
    ok('the clip distance is the distance', Math.abs(card.els[0].dist - 4) < 1.2,
       'planted 4 m out, measured ' + card.els[0].dist.toFixed(2) + ' m');
    ok('a zone the car rides is fully covered', card.els[1].cover > 0.95,
       (100 * card.els[1].cover).toFixed(0) + '% covered');
    ok('full marks for the zone', card.els[1].pts > 14.2, card.els[1].pts.toFixed(1) + ' of 15');
    ok('the scorecard is stamped with its version', card.ver === K.GP_DRIFT_SCORE_VER);
    ok('angle is scored when it is measured', !!card.angle && !card.noAngle);
    const withAngle = card.max;

    /* Same course, same driving, no angle sensor: the DENOMINATOR must fall.
       If it did not, a card with no angle on it could look like a full one. */
    const rows2 = makeRun({ noChan: true });
    load(rows2, [], []);
    fakeTrack.courses = [API.gpCourseClean({
        id: 'c1', name: 'Test course', target_kph: 60, target_deg: 30,
        elements: [
            { k: 'clip', name: 'Clip 1', lat: clipLat, lon: clipLon, r: 3, max: 10 },
            { k: 'zone', name: 'Zone 1', pts: zpts, band: 3, max: 15 }
        ]
    })];
    gp.courseId = 'c1';
    const card2 = API.gpDriftCard({ from: 0, to: rows2.length - 1 }, API.gpCourseActive());
    ok('with no angle sensor the total shrinks', card2.max === withAngle - 20,
       'out of ' + withAngle + ' with angle, ' + card2.max + ' without');
    ok('and it says the angle was not measured', card2.noAngle && !card2.angle);
}

head('Shapes cannot be drawn finer than the receiver');
{
    const c = API.gpCourseClean({
        id: 'x', name: 'x',
        elements: [{ k: 'clip', name: 'tiny', lat: CLAT, lon: CLON, r: 0.3, max: 10 },
                   { k: 'zone', name: 'thin', pts: [[CLAT, CLON], [CLAT + 0.001, CLON]], band: 0.1, max: 10 }]
    });
    ok('a 30 cm clip is widened to the floor', c.elements[0].r === K.GP_DRIFT_MIN_SHAPE_M,
       c.elements[0].r + ' m');
    ok('a 10 cm band is widened to the floor', c.elements[1].band === K.GP_DRIFT_MIN_SHAPE_M,
       c.elements[1].band + ' m');
    /* The track record is JSON.stringify'd into localStorage. A zone's
       projected geometry must never ride along with it: it would be saved
       into the user's track library, reloaded for ever, and wrong the moment
       the zone moved. */
    const z = API.gpCourseClean({ id: 'z', name: 'z', elements: [
        { k: 'zone', name: 'Zone', pts: [[CLAT, CLON], [CLAT + 0.0005, CLON + 0.0005]], band: 4, max: 10 }
    ]});
    API.gpZoneGeom(z.elements[0]);
    const json = JSON.stringify(z);
    ok('zone geometry is never persisted with the track', json.indexOf('cum') < 0 && json.indexOf('_geo') < 0,
       Object.keys(z.elements[0]).join(','));

    const bad = API.gpCourseClean({ id: 'y', name: 'y', elements: [
        { k: 'clip', lat: 999, lon: 0, r: 3, max: 10 },
        { k: 'zone', pts: [[CLAT, CLON]], band: 4, max: 10 },
        { k: 'nonsense' }, null
    ]});
    ok('malformed shapes are dropped, not drawn', bad.elements.length === 0);
}

head('A channel that is not what we think it is');
{
    /* Two-times-out gyro: the fit must refuse to "correct" by that much and
       say it is weak rather than quietly scaling a wrong signal into place. */
    const rows = makeRun({ gyroScale: 2.0, gyroBias: 0 });
    load(rows);
    const d = API.gpDriftAngle();
    ok('a wildly wrong scale is refused, not applied', d.scale === 1 && d.weak,
       'scale ' + d.scale + ', weak ' + d.weak);
}

head('A course with no straight in it says so, rather than guessing');
{
    /* A continuous circle held at a steady angle: rho is zero the whole way
       round, so there is nothing anywhere that proves the car is straight.
       The engine must fall back and mark the whole thing soft, NOT quietly
       report zero degrees — a constant angle and no angle look identical to
       the rate alone, and only the anchor tells them apart. */
    const rows = makeRun({ T: 60, chi: t => 12 * t, beta: t => (t > 4 ? 30 : 30 * ss(t / 4)) });
    load(rows);
    const d = API.gpDriftAngle();
    ok('no anchors are claimed on a continuous curve', d.anchors === 0, d.anchors + ' anchors');
    let conf = 0;
    for (let i = 0; i < rows.length; i++) if (d.ok[i]) conf = Math.max(conf, d.conf[i]);
    ok('and every sample carries a wide error bar', conf >= 6, '+/-' + conf.toFixed(0) + ' deg');
}

head('A gyro whose zero wanders while you drive');
{
    /* Cheap MEMS parts drift with temperature. Per-session calibration cannot
       track that, so the closure has to absorb it — and where it cannot, the
       error bar has to grow to match. */
    const rows = makeRun({ gyroBias: 0.4 });
    for (let i = 0; i < rows.length; i++) {
        const t = i * GP_DT;
        const extra = 0.9 * (t / 78);          /* 0.9 deg/s of wander over the run */
        const dec = rows[i].can[0] * CH_SCALE + CH_OFF + extra;
        rows[i].can = [Math.max(0, Math.min(65535, Math.round((dec - CH_OFF) / CH_SCALE)))];
    }
    load(rows);
    const d = API.gpDriftAngle();
    let worst = 0, outside = 0, tot = 0;
    for (let i = 0; i < rows.length; i++) {
        if (!d.ok[i]) continue;
        const e = Math.abs(d.beta[i] - betaOf(i * GP_DT));
        worst = Math.max(worst, e); tot++;
        if (e > d.conf[i]) outside++;
    }
    ok('a wandering zero still lands inside 5 deg', worst < 5, 'worst ' + worst.toFixed(2) + ' deg');
    ok('and the error bar still covers it', outside / tot < 0.05,
       (100 * outside / tot).toFixed(1) + '% outside');
}

head('Degenerate recordings');
{
    const one = makeRun({ T: 78 }).slice(0, 1);
    load(one);
    ok('one sample does not throw', API.gpDriftAngle() === null && API.gpDriftRuns().length === 0);
    load(makeRun({ T: 78 }).slice(0, 2));
    ok('two samples do not throw', API.gpDriftRuns().length === 0);
    load([]);
    ok('an empty recording does not throw', API.gpDriftAngle() === null && API.gpDriftSwitches().length === 0);
    /* no timestamps at all: gpSecs falls back to the nominal rate */
    const noT = makeRun({ T: 40 }).map(r => { const c = Object.assign({}, r); delete c.t; return c; });
    load(noT);
    ok('a recording with no timestamps still reads', API.gpDriftAngle() !== null);
    /* a car parked with the engine running */
    const still = makeRun({ T: 40, kphAt: () => 0, beta: () => 0, chi: () => 0 });
    load(still);
    const ds = API.gpDriftAngle();
    let claimed = 0;
    for (let i = 0; i < still.length; i++) if (ds.ok[i]) claimed++;
    ok('a parked car claims no angle anywhere', claimed === 0, claimed + ' samples claimed');
    ok('and no switches', API.gpDriftSwitches().length === 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'passed all ' + pass) + ' checks');
process.exit(fail ? 1 : 0);
