/* A drift practice session at Mallala, as a VBO you can import.
 *
 * Laps, not runs. A drifter at a circuit does laps of the whole track and
 * drifts every corner of it, and the question afterwards is never "how was
 * the lap" — it is "was turn 3 better that time". So this generates six laps
 * of the real circuit with a DIFFERENT quality of drift at each corner on
 * each lap, and writes down exactly what it planted, so the app's per-corner
 * reading can be held to account against it.
 *
 * The circuit is not invented: the centreline comes out of GP_SHAPES in
 * src/tauri-overlay.html, which is the OSM survey the app already ships
 * (2557 m measured against 2600 m published).
 *
 * What is generated, and why each part is the way it is:
 *
 *   - Position is INTEGRATED FROM SPEED at 25 Hz, never emitted one sample
 *     per metre. A generator that spaces samples by distance makes every lap
 *     the same duration whatever its speed field says, and every comparison
 *     passes vacuously.
 *   - Corners are found from the survey's own CURVATURE, not chosen by hand,
 *     so the drift is planted where the track actually turns and the app's
 *     independent corner detection has something real to agree with.
 *   - The car does not follow the centreline. Each lap carries its own smooth
 *     lateral offset, which is what six attempts at the same corner look like.
 *   - Slip angle is signed BY THE CORNER: a drifting car's nose points to the
 *     inside, so beta has the same sign as the path's turn rate. Getting this
 *     backwards draws a car crabbing the wrong way round every corner.
 *   - Between corners beta returns to ZERO and the car runs straight. This is
 *     load-bearing, not cosmetic: the angle engine calibrates its gyro on
 *     provably-straight driving, and a fixture with no straight in it tests
 *     the refusal path instead of the measurement path.
 *   - The gyro channel is the honest sum: body yaw rate = the rate the PATH
 *     turns + the rate the ANGLE changes. Nothing else. It is then corrupted
 *     the way a real MEMS part is — about a percent of scale error, a fixed
 *     zero offset, white noise — and heading gets receiver noise too, because
 *     an exact heading hides the regression bias in the scale fit entirely.
 *
 *   node tools/make_drift_fixture.js [out.vbo]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'mallala-drift.vbo');

/* ---- the circuit, from the app's own survey --------------------------- */
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');
const shape = /mallala:\s*\[([\s\S]*?)\n\s*\],/.exec(SRC);
if (!shape) throw new Error('mallala not found in GP_SHAPES');
const nums = shape[1].match(/-?\d+\.\d+/g).map(Number);
const PTS = [];
for (let i = 0; i + 1 < nums.length; i += 2) PTS.push([nums[i], nums[i + 1]]);

const LAT0 = PTS[0][0], LON0 = PTS[0][1];
const MLA = 111320, MLO = 111320 * Math.cos(LAT0 * Math.PI / 180);
/* close the loop explicitly so a lap can run past the last vertex */
const XY = PTS.concat([PTS[0]]).map(p => [(p[1] - LON0) * MLO, (p[0] - LAT0) * MLA]);
const CUM = [0];
for (let i = 1; i < XY.length; i++)
    CUM.push(CUM[i - 1] + Math.hypot(XY[i][0] - XY[i - 1][0], XY[i][1] - XY[i - 1][1]));
const LEN = CUM[CUM.length - 1];

function seg(s) {
    s = ((s % LEN) + LEN) % LEN;
    let lo = 0, hi = CUM.length - 1;
    while (lo < hi) { const k = (lo + hi) >> 1; if (CUM[k] < s) lo = k + 1; else hi = k; }
    return Math.max(1, lo);
}
/* Point and tangent at a distance along the centreline. */
function atS(s) {
    const i = seg(s), f = (((s % LEN) + LEN) % LEN - CUM[i - 1]) / Math.max(1e-9, CUM[i] - CUM[i - 1]);
    const ax = XY[i - 1][0], ay = XY[i - 1][1], bx = XY[i][0], by = XY[i][1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    return { x: ax + dx * f, y: ay + dy * f, hdg: Math.atan2(dx / L, dy / L) };
}

/* ---- heading, as a smooth continuous function of distance ---------------
   The survey is a polyline, so its TANGENT is piecewise constant: a staircase
   that only changes when s crosses a vertex. Averaging that staircase leaves
   a staircase, and differentiating it gives zero almost everywhere with a
   spike at each vertex — which is not a heading trace any receiver ever
   produced, and not something a gyro channel can be derived from.
   So: sample the CHORD direction on a fine grid, unwrap it into a continuous
   angle, smooth THAT, and interpolate.

   The grid must be EXACTLY periodic in the lap, and that is the whole battle.
   A grid whose last sample sits a little past the finish line, smoothed with a
   wrap that assumes it sits exactly on it, leaves a step in the heading at the
   seam — and a step in heading is an infinite turn rate. It showed up as the
   generator's own course rate jumping to +235 deg/s for four samples in the
   middle of a −55 deg/s corner, once per lap, which the angle engine then
   faithfully integrated into an 80-degree misclosure. The app was right; the
   drive it was given was impossible.

   So: the heading is written as a periodic part plus a linear ramp of exactly
   one full turn per lap. Both are exact by construction, so hdgAt is smooth
   across the seam no matter how the grid divides. */
const NT = 2048;                       /* points per lap, exactly periodic */
const TSTEP = LEN / (NT - 1);
const RES = new Float64Array(NT);      /* the periodic part, smoothed */
let TURN = 0;                          /* radians of heading per lap: +/-2pi */
let H0 = 0;
{
    const un = new Float64Array(NT);
    let prev = null;
    for (let k = 0; k < NT; k++) {
        const s = k * TSTEP, a = atS(s - 8), b = atS(s + 8);
        const h = Math.atan2(b.x - a.x, b.y - a.y);
        if (prev === null) un[k] = h;
        else {
            let d = h - prev;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            un[k] = un[k - 1] + d;
        }
        prev = h;
    }
    H0 = un[0];
    /* A closed circuit turns through exactly one revolution. Snapping to it
       rather than trusting the accumulated sum is what makes the seam exact. */
    TURN = Math.round((un[NT - 1] - un[0]) / (2 * Math.PI)) * 2 * Math.PI;
    /* Strip the ramp, leaving something genuinely periodic to smooth. */
    const res = new Float64Array(NT);
    for (let k = 0; k < NT; k++) res[k] = un[k] - H0 - (k / (NT - 1)) * TURN;
    const P = NT - 1;                              /* the period, in samples */
    const W = Math.max(1, Math.round(10 / TSTEP)); /* +/-10 m of smoothing */
    for (let k = 0; k < P; k++) {
        let acc = 0;
        for (let j = k - W; j <= k + W; j++) acc += res[((j % P) + P) % P];
        RES[k] = acc / (2 * W + 1);
    }
    RES[NT - 1] = RES[0];                          /* periodic, exactly */
}
/* Continuous and UNWRAPPED across the start/finish seam, by construction. */
function hdgAt(s) {
    const u = s / LEN;                    /* laps, fractional */
    const laps = Math.floor(u);
    const r = (u - laps) * LEN;           /* 0 .. LEN */
    const f = r / TSTEP;
    const k = Math.min(NT - 2, Math.floor(f));
    const t = f - k;
    return H0 + RES[k] + (RES[k + 1] - RES[k]) * t + u * TURN;
}
function dHdgDs(s) { return (hdgAt(s + TSTEP) - hdgAt(s - TSTEP)) / (2 * TSTEP); }  /* rad/m */
function turnAt(s) { return dHdgDs(s) * 180 / Math.PI; }                            /* deg/m, + is right */

/* ---- where the corners are, from the survey itself ---------------------
   A corner is a contiguous stretch the track genuinely turns through, and its
   centre is where it turns hardest. Found rather than typed in, so the drift
   is planted where the circuit actually bends and the app's own detector has
   the same thing to find. */
const KTHRESH = 0.10;                    /* deg per metre — gentler than this is a straight */
function findCorners() {
    const out = [];
    let run = null;
    for (let s = 0; s < LEN; s += 2) {
        const t = turnAt(s);
        if (Math.abs(t) >= KTHRESH) {
            if (run && Math.sign(t) === run.sign && s - run.end <= 30) { run.end = s; run.pts.push([s, t]); }
            else { if (run && run.end - run.start >= 24) out.push(run); run = { start: s, end: s, sign: Math.sign(t), pts: [[s, t]] }; }
        }
    }
    if (run && run.end - run.start >= 24) out.push(run);
    return out.map((r, i) => {
        let best = r.pts[0];
        r.pts.forEach(p => { if (Math.abs(p[1]) > Math.abs(best[1])) best = p; });
        return { n: i + 1, s0: r.start, s1: r.end, sMid: best[0], sign: r.sign,
                 peakTurn: best[1], len: r.end - r.start };
    });
}
const CORNERS = findCorners();
if (CORNERS.length < 3) throw new Error('only ' + CORNERS.length + ' corners found — check KTHRESH');

/* ---- where the timing line is -------------------------------------------
   Mallala's start/finish, exactly as GP_STARTS ships it. The app cuts laps
   HERE, not at s=0, so the driver's character must change here too — change
   it at s=0 and every lap the app measures is half one character and half the
   next, which makes the corner-to-corner comparison compare nothing. */
const SF = { lat: -34.4161627, lon: 138.5030594 };
const S_SF = (function () {
    let best = 0, bd = Infinity;
    for (let s = 0; s < LEN; s += 1) {
        const p = atS(s);
        const dy = (LAT0 + p.y / MLA - SF.lat) * MLA, dx = (LON0 + p.x / MLO - SF.lon) * MLO;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = s; }
    }
    return best;
})();
/* Which driver-character applies at a given total distance. Before the first
   crossing the car is on its out lap; after it, each crossing steps on. */
function charAt(S) {
    return Math.max(0, Math.min(LAPS.length - 1, Math.floor((S - S_SF) / LEN) + 1));
}

let _s = 20260810;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const ss = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* ---- six laps by the same driver ---------------------------------------
   `commit` scales the angle carried everywhere; `wob` is how much it wanders
   while it is up; `focus` names a corner this lap was especially good at, so
   the best lap for each corner is genuinely spread across the session rather
   than one lap owning all of them — which is the thing the view exists to
   show, and a fixture where one lap wins everything would never test it. */
const LAPS = [
    { name: 'out lap, feeling it out', commit: 0.55, wob: 1.5, wide: 1.2, focus: -1, dies: -1 },
    { name: 'building up',             commit: 0.78, wob: 1.1, wide: 2.2, focus: 1,  dies: -1 },
    { name: 'good through the first',  commit: 0.88, wob: 0.8, wide: 3.0, focus: 0,  dies: 3 },
    { name: 'best of the day',         commit: 1.02, wob: 0.5, wide: 3.6, focus: 2,  dies: -1 },
    /* breakAt: this lap STRAIGHTENS between corner N and N+1 instead of
       linking them — the mistake the whole link feature exists to show. */
    { name: 'greedy, caught it twice', commit: 1.10, wob: 2.3, wide: 4.1, focus: 4,  dies: -1, breakAt: 7 },
    { name: 'tidy cool-down',          commit: 0.72, wob: 0.6, wide: 1.8, focus: 3,  dies: -1 }
];

const DT = 1 / 25;
const GYRO_SCALE = 1.008, GYRO_BIAS = 0.42, GYRO_NOISE = 0.35;
const HDG_NOISE = 0.3, POS_NOISE = 0.32;

/* How much angle this lap carries through this corner, as a multiplier.
   Deterministic — a fixture whose numbers move between runs cannot be
   asserted against. */
function ampFor(li, ci) {
    const L = LAPS[li];
    let a = L.commit;
    /* Big enough that the focused corner genuinely WINS. A gentle nudge left
       the lap with the highest overall commitment owning every corner, and a
       session where one lap owns everything is a session the corner-by-corner
       comparison has nothing to say about. */
    if (L.focus === ci) a *= 1.5;               /* the corner this lap nailed */
    if (L.dies === ci) a *= 0.42;               /* ...and the one it dropped */
    /* a little corner-to-corner character, stable per pair */
    a *= 1 + 0.08 * Math.sin(ci * 2.4 + li * 1.7);
    return a;
}

/* ---- speed --------------------------------------------------------------
   Curvature ceiling with a backward brake pass and a forward drive pass, so
   the driving contains real cornering rather than a constant. A drifting car
   is slower through the corner than a gripping one — it is scrubbing — so the
   ceiling is pulled down in proportion to the angle being carried. That is
   also what gives the speed part of the rating something honest to vary on.

   ONE profile over the WHOLE session, not one per lap. A per-lap profile
   steps at the start/finish line, because consecutive laps carry different
   angle and therefore scrub differently — and a step down in speed is exactly
   what a corner detector is built to find. It planted a phantom 9-second
   corner on the main straight of every lap, whose angle could never close. */
const VMAX = 160 / 3.6, ALAT = 1.15 * 9.81, ABRAKE = 1.20 * 9.81, ADRIVE = 0.42 * 9.81;
const VSTEP = 4;
let VPROF = null;
function buildSpeedAll() {
    const total = LAPS.length * LEN;
    const N = Math.ceil(total / VSTEP) + 1;
    const v = new Float64Array(N);
    for (let k = 0; k < N; k++) {
        const S = k * VSTEP;
        const kap = Math.abs(turnAt(S)) * Math.PI / 180;     /* rad per metre */
        let ceil = Math.min(VMAX, kap > 1e-5 ? Math.sqrt(ALAT / kap) : VMAX);
        /* scrub: the more angle here, the more speed it costs */
        ceil *= 1 - 0.30 * Math.min(1, Math.abs(betaShape(S)) / 45);
        /* A floor, because the survey is a SIMPLIFIED polyline: two nearly
           coincident points make a kink whose curvature implies a three-metre
           radius, and the ceiling then asks the car to take Mallala's fastest
           section at 22 km/h. Below 25 km/h the app correctly refuses to read
           an angle at all — course over ground is receiver noise down there —
           so an unfloored fixture manufactures a corner that can never be
           measured and then blames the app for not measuring it. Mallala's
           slowest corner is a second-gear 60-odd; 48 is clear of the floor
           with room to spare. */
        v[k] = Math.max(ceil, 48 / 3.6);
    }
    for (let k = N - 2; k >= 0; k--)
        v[k] = Math.min(v[k], Math.sqrt(v[k + 1] * v[k + 1] + 2 * ABRAKE * VSTEP));
    for (let k = 1; k < N; k++)
        v[k] = Math.min(v[k], Math.sqrt(v[k - 1] * v[k - 1] + 2 * ADRIVE * VSTEP));
    return v;
}
function kphAt(S) {
    const v = VPROF || (VPROF = buildSpeedAll());
    const f = Math.max(0, Math.min(v.length - 2, S / VSTEP));
    const k = Math.floor(f);
    return (v[k] + (v[k + 1] - v[k]) * (f - k)) * 3.6;
}

/* How far off the centreline the car runs, in metres, positive to the right.
   A function of TOTAL distance driven, never of the lap index — the offset
   must be continuous across the start/finish line or the car teleports
   sideways there, and a teleport is an impossible turn rate that the angle
   engine reads (correctly) as a 90-degree misclosure. It cost an afternoon:
   every corner near the line came back "rough" and the app looked wrong when
   the fixture was.
   The slow phase drift is what makes each lap a different line while keeping
   the whole session one continuous path. */
function widthAt(S) {
    const f = Math.max(0, Math.min(LAPS.length - 1.0001, (S - S_SF) / LEN + 1));
    const k = Math.floor(f), t = f - k;
    const a = LAPS[k].wide, b = LAPS[Math.min(LAPS.length - 1, k + 1)].wide;
    return a + (b - a) * (t * t * (3 - 2 * t));
}
function offAt(S) {
    const u = S / LEN * 2 * Math.PI;
    return widthAt(S) * (0.6 * Math.sin(u * 3 + S / LEN * 0.9) +
                         0.4 * Math.sin(u * 5 + S / LEN * 1.7));
}

/* ---- the angle ----------------------------------------------------------
   One bump per corner, signed by the way the corner goes, zero everywhere
   between them. The bump is raised-cosine so it starts and ends at exactly
   zero with zero slope — the gyro is its derivative, and a bump with a corner
   in it would put a step in a channel that is supposed to be a rate. */
/* `S` is total distance driven; the CHARACTER at that point picks the
   amplitudes, and the character steps at the timing line.
   A hard switch is safe there and only there: the line sits at the midpoint
   of the longest straight, clear of every corner's reach, so beta is exactly
   zero on both sides of the switch and there is nothing to step. */
/* A lap that does NOT link a pair of corners: the angle is squeezed to zero
   in a short window between them, which is what straightening up and
   re-initiating actually looks like. Everything else about the lap is
   unchanged, so the only thing the comparison can be measuring is the link. */
function breakFactor(S, li) {
    const L = LAPS[li];
    if (L.breakAt === undefined) return 1;
    const c0 = CORNERS[L.breakAt], c1 = CORNERS[L.breakAt + 1];
    if (!c0 || !c1) return 1;
    /* Wide enough to be a real straighten. A driver who catches it and
       re-initiates is upright for the best part of a second, and at 60 km/h
       that is 15-20 m of nothing plus the ramp down and back up either side.
       A narrower notch cost three points of commitment and proved nothing. */
    const mid = (c0.sMid + c1.sMid) / 2, half = 55;
    const r = ((S % LEN) + LEN) % LEN;
    let x = r;
    if (x < mid - LEN / 2) x += LEN;
    if (x > mid + LEN / 2) x -= LEN;
    const t = Math.abs(x - mid) / half;
    return t >= 1 ? 1 : ss(t);
}

function betaShape(S, forceChar) {
    /* `forceChar` lets the answer sheet ask "what would character N have done
       at this point on the track", without having to fake a distance that
       lands in that lap — faking one moves the POSITION as well as the
       character, and the sheet then describes a different corner entirely. */
    const li = forceChar === undefined ? charAt(S) : forceChar;
    const r = ((S % LEN) + LEN) % LEN;
    let b = 0;
    for (let ci = 0; ci < CORNERS.length; ci++) {
        const c = CORNERS[ci];
        /* Reach a little past the turn itself — the car is already sideways on
           the way in and still gathering it up on the way out — but never hold
           one drift for longer than a driver would.
           The cap is load-bearing. Two of Mallala's bends read as 260-270 m of
           continuous curvature, and drifting the whole of one means fourteen
           unbroken seconds sideways with no straight anywhere in it. The angle
           engine has nothing to close that leg against and correctly calls the
           result rough — so an uncapped fixture tests the refusal path at the
           very corners it is supposed to be measuring. A real driver initiates,
           holds, and gathers it up; the straight either side is what makes the
           number checkable. */
        const MAXDRIFT = 110;
        const pad = 22;
        const half = Math.min((c.s1 - c.s0) / 2, MAXDRIFT / 2);
        const a0 = c.sMid - half - pad, a1 = c.sMid + half + pad;
        let x = r;
        if (x < a0 - LEN / 2) x += LEN;
        if (x > a1 + LEN / 2) x -= LEN;
        if (x <= a0 || x >= a1) continue;
        const u = (x - a0) / (a1 - a0);
        const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * u);      /* 0 -> 1 -> 0 */
        const amp = 44 * ampFor(li, ci);
        const wob = LAPS[li].wob * 2.2 * Math.sin(u * 15.5 + ci) * Math.sin(u * 5.7);
        b += (amp + wob) * env * c.sign;
    }
    return b * breakFactor(S, li);
}

/* ---- integrate the whole session --------------------------------------- */
/* The direction the car TRAVELS: the centreline's heading tilted by the slope
   of the car's own lateral offset. */
function courseAt(S) {
    const dodv = (offAt(S + 2) - offAt(S - 2)) / 4;   /* m per m */
    return hdgAt(S) + Math.atan(dodv);
}

/* ONE continuous integration over every lap, never a restart per lap.
   Restarting each lap at an exact multiple of the lap length put the car a
   metre BEHIND where the previous lap's last sample left it — a backwards
   step at 25 Hz, which is a reversed heading and an impossible turn rate. It
   read as a phantom corner sitting on the start/finish line whose angle could
   never close (+/-41 degrees of doubt, every lap). The car drives; the lap
   number is only ever read off the distance. */
function drive() {
    const out = [];
    const total = LAPS.length * LEN;
    let s = 0, t = 0;
    while (s < total) {
        const li = charAt(s);
        const v = kphAt(s) / 3.6;
        const p = atS(s), h = hdgAt(s);
        const o = offAt(s);
        const nx = Math.cos(h), ny = -Math.sin(h);             /* right normal */
        const course = courseAt(s);
        const b = betaShape(s);
        /* Body yaw rate = how fast the path turns + how fast the angle
           changes. Both per second, so both scaled by ground speed. The path
           here is the CAR'S path, not the centreline: differencing the
           centreline instead left the gyro disagreeing with the heading
           written beside it, which the calibration then dutifully absorbed as
           a scale error. A fixture has to be consistent with itself before it
           can hold anything to account. */
        const dCourse = (courseAt(s + TSTEP) - courseAt(s - TSTEP)) / (2 * TSTEP) * 180 / Math.PI * v;
        const dBeta = (betaShape(s + TSTEP) - betaShape(s - TSTEP)) / (2 * TSTEP) * v;
        out.push({
            t: t,
            lat: LAT0 + (p.y + o * ny + gauss() * POS_NOISE) / MLA,
            lon: LON0 + (p.x + o * nx + gauss() * POS_NOISE) / MLO,
            kph: v * 3.6,
            hdg: ((course * 180 / Math.PI % 360) + 360 + gauss() * HDG_NOISE) % 360,
            yaw: (dCourse + dBeta) * GYRO_SCALE + GYRO_BIAS + gauss() * GYRO_NOISE,
            s: s, lap: li,
            beta: b,
            trueCourseRate: dCourse
        });
        s += v * DT;
        t += DT;
    }
    return out;
}

const rows = drive();
const lapTruth = LAPS.map((L, li) => {
    let from = -1, to = -1;
    rows.forEach((r, i) => { if (r.lap === li) { if (from < 0) from = i; to = i; } });
    return { lap: li + 1, name: L.name, from: from, to: to, secs: (to - from + 1) * DT };
});

/* ---- what was planted, per corner per lap ------------------------------
   The answer sheet. Written beside the VBO rather than in it: a column here
   would become a channel in the app, and the app has no business being handed
   the answer it is being tested on. */
const cornerTruth = CORNERS.map((c, ci) => {
    const per = LAPS.map((L, li) => {
        /* what the planted beta actually does through this corner, sampled
           the same way the app will read it: mean of |beta| above the drift
           threshold, and the fraction of the corner spent above it */
        let peak = 0, sum = 0, n = 0, tot = 0;
        const half = Math.min((c.s1 - c.s0) / 2, 110 / 2);
        for (let s = c.sMid - half - 22; s <= c.sMid + half + 22; s += 1) {
            const b = Math.abs(betaShape(s, li));
            tot++;
            if (b > peak) peak = b;
            if (b >= 10) { sum += b; n++; }
        }
        return { lap: li + 1, peak: +peak.toFixed(2), held: +(n ? sum / n : 0).toFixed(2),
                 commit: +(tot ? n / tot : 0).toFixed(3), amp: +ampFor(li, ci).toFixed(3) };
    });
    let bestLap = 1, bh = -1;
    per.forEach(p => { if (p.held > bh) { bh = p.held; bestLap = p.lap; } });
    const mid = atS(c.sMid);
    /* Three points along the corner, not just its middle: a 260 m sweeper's
       midpoint can sit 100 m from where a speed-based detector puts its apex,
       and matching on the midpoint alone would call a correct detection a
       miss. */
    const pts = [c.s0, c.sMid, c.s1].map(x => {
        const q = atS(x);
        return [+(LAT0 + q.y / MLA).toFixed(7), +(LON0 + q.x / MLO).toFixed(7)];
    });
    return { corner: c.n, sMid: +c.sMid.toFixed(1), len: +c.len.toFixed(1),
             sign: c.sign, peakTurn: +c.peakTurn.toFixed(3),
             lat: +(LAT0 + mid.y / MLA).toFixed(7), lon: +(LON0 + mid.x / MLO).toFixed(7),
             pts: pts, bestLap: bestLap, per: per };
});

/* ---- write the VBO ----------------------------------------------------- */
function clockStr(sec) {
    const s = 9 * 3600 + 40 * 60 + sec;               /* session starts just before 09:40 */
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ssec = s - hh * 3600 - mm * 60;
    return (hh * 10000 + mm * 100 + Math.floor(ssec)) + (ssec - Math.floor(ssec)).toFixed(2).slice(1);
}
let vbo = 'File created on 10/08/2026 @ 09:40:00\n\n' +
    '[header]\nsats\ntime\nlat\nlong\nvelocity kmh\nheading\nheight\nYaw rate\n\n' +
    '[channel units]\ndeg/s\n\n' +
    '[comments]\n' +
    'Mallala Motor Sport Park — drift practice, ' + LAPS.length + ' laps of the full circuit.\n' +
    'Synthetic: centreline from the app\'s OSM survey, position integrated from speed at 25 Hz,\n' +
    'yaw rate = path turn rate + angle rate, with a 1.008 scale error, 0.42 deg/s zero offset and noise.\n' +
    '[column names]\nsats time lat long velocity heading height Yaw_rate\n\n[data]\n';
vbo += rows.map(r =>
    '012 ' + clockStr(r.t) + ' ' + (r.lat * 60).toFixed(5) + ' ' + (-r.lon * 60).toFixed(5) +
    ' ' + r.kph.toFixed(3) + ' ' + r.hdg.toFixed(2) + ' 68.00 ' + r.yaw.toFixed(2)).join('\n') + '\n';

fs.writeFileSync(OUT, vbo);
const base = OUT.replace(/\.vbo$/, '');
fs.writeFileSync(base + '.truth.json', JSON.stringify({
    circuit: 'Mallala', lengthM: +LEN.toFixed(1),
    startFinishS: +S_SF.toFixed(1),
    /* The app's first COMPLETE lap runs from the first crossing of the line to
       the second, and that whole lap is driven with character 1 — character 0
       is the out lap before timing starts. So: app lap k <-> per[k + 1]. */
    firstBoardLapCharacter: 1,
    /* The character that straightens between two corners instead of linking
       them, and which pair — so the harness can check the app noticed. */
    brokeLink: (function () {
        for (let i = 0; i < LAPS.length; i++)
            if (LAPS[i].breakAt !== undefined)
                return { character: i, betweenCorners: [LAPS[i].breakAt + 1, LAPS[i].breakAt + 2] };
        return null;
    })(),
    laps: lapTruth, corners: cornerTruth
}, null, 1));
/* Per-sample truth, for checks that need to hold a derived channel to account
   rather than a per-corner summary. */
fs.writeFileSync(base + '.rates.json',
    JSON.stringify({ courseRate: rows.map(r => +r.trueCourseRate.toFixed(4)),
                     beta: rows.map(r => +r.beta.toFixed(3)) }));

console.log('wrote ' + OUT);
console.log('  ' + rows.length + ' samples, ' + LAPS.length + ' laps of ' + LEN.toFixed(0) + ' m, ' +
            (fs.statSync(OUT).size / 1024).toFixed(0) + ' kB');
console.log('  ' + CORNERS.length + ' corners found from the survey:');
CORNERS.forEach(c => console.log('    T' + c.n + '  s=' + c.sMid.toFixed(0).padStart(4) +
    ' m  ' + (c.sign > 0 ? 'right' : 'left ') + '  ' + c.len.toFixed(0).padStart(3) + ' m long'));
console.log('\n  angle held (deg) per corner per lap — the answer sheet:');
let head = '  lap  ' + CORNERS.map(c => ('T' + c.n).padStart(6)).join('') + '   name';
console.log(head);
LAPS.forEach((L, li) => {
    const cells = cornerTruth.map(ct => ct.per[li].held.toFixed(1).padStart(6)).join('');
    console.log('   ' + (li + 1) + '   ' + cells + '   ' + L.name);
});
console.log('\n  best lap per corner: ' +
    cornerTruth.map(c => 'T' + c.corner + '=lap' + c.bestLap).join('  '));
