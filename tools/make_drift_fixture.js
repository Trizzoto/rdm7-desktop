/* A drift practice day at Mallala, as a VBO you can import.
 *
 * The circuit is not invented: the centreline comes out of GP_SHAPES in
 * src/tauri-overlay.html, which is the OSM survey the app already ships
 * (2557 m measured against 2600 m published). The drift course is the real
 * right-left-right complex onto the main straight — s ~ 2150 to 2520 — which
 * is a proper drift layout by accident of the circuit's own geometry: a
 * straight to build entry speed, a long right to initiate into, then two
 * direction changes before the exit.
 *
 * What is generated, and why each part is the way it is:
 *
 *   - Position is INTEGRATED FROM SPEED at 25 Hz, never emitted one sample
 *     per metre. A generator that spaces samples by distance makes every run
 *     the same duration whatever its speed field says, and every comparison
 *     passes vacuously.
 *   - The car does not follow the centreline. Each run carries its own smooth
 *     lateral offset, zero at entry and exit and a few metres at its widest,
 *     which is what five attempts at the same corner actually look like and
 *     is what the line overlay is for.
 *   - Slip angle is signed BY THE CORNER: a drifting car's nose points to the
 *     inside, so beta has the same sign as the path's turn rate. Getting this
 *     backwards draws a car crabbing the wrong way round every corner and
 *     looks subtly, unplaceably wrong on the map.
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
/* close the loop explicitly so the section can run past the last vertex */
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
   produced, and not something a gyro channel can be derived from. (It showed
   up as the written heading and the written yaw rate disagreeing by a factor
   of two to four, worse the faster the car went.)
   So: sample the CHORD direction on a fine grid, unwrap it into a continuous
   angle, smooth THAT, and interpolate. Position is continuous, so the chord
   direction is too, and the smoothed table has an honest derivative. */
const TSTEP = 2, TSPAN = LEN + 400;
const NT = Math.ceil(TSPAN / TSTEP) + 1;
const HSM = new Float64Array(NT);
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
    const W = Math.round(10 / TSTEP);          /* +/-10 m of smoothing */
    for (let k = 0; k < NT; k++) {
        let acc = 0, c = 0;
        for (let j = k - W; j <= k + W; j++) { acc += un[Math.max(0, Math.min(NT - 1, j))]; c++; }
        HSM[k] = acc / c;
    }
}
/* Continuous and UNWRAPPED, so differences never need a seam fix. */
function hdgAt(s) {
    const f = Math.max(0, Math.min(NT - 1.001, s / TSTEP)), k = Math.floor(f);
    return HSM[k] + (HSM[k + 1] - HSM[k]) * (f - k);
}
function dHdgDs(s) { return (hdgAt(s + TSTEP) - hdgAt(s - TSTEP)) / (2 * TSTEP); }  /* rad per metre */
function turnAt(s) { return dHdgDs(s) * 180 / Math.PI; }                            /* deg per metre, + is right */

/* ---- the drift course --------------------------------------------------
   A run is not just the complex. The puck records whenever the car is moving
   above 8 km/h, and a drift day at a circuit means going OUT and driving
   round to the section — so a run is an out-lap driven on the grip, then the
   complex drifted, then a roll-out before joining the queue again and
   stopping. Recording only the drifted part would leave a session with no
   gripping corner anywhere in it, and the angle engine calibrates its gyro
   against exactly those. (It matters: on a complex-only fixture the scale fit
   has nothing honest to work with and correctly refuses, which is the right
   behaviour but tests nothing.) */
const SOUT = 1150;                     /* join the circuit here, on the grip */
const S0 = 2150, S1 = 2520;            /* the drifted complex */
const SEND = 2620;                     /* roll out, then stop */

let _s = 20260810;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
function gauss() { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const ss = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/* Five attempts by the same driver at the same course. `commit` scales how
   much angle is carried; `dies` makes the angle fall away mid-course, which
   is the failure a drifter most wants to see in a table. */
const RUNS = [
    { name: 'first go, tidy',    commit: 0.82, entry: 88, dies: 0,    wob: 0.6, wide: 2.4 },
    { name: 'more angle',        commit: 1.00, entry: 92, dies: 0,    wob: 0.9, wide: 3.6 },
    { name: 'dropped it',        commit: 0.95, entry: 94, dies: 0.55, wob: 1.4, wide: 1.2 },
    { name: 'best of the day',   commit: 1.12, entry: 96, dies: 0,    wob: 0.5, wide: 4.4 },
    { name: 'greedy on entry',   commit: 1.05, entry: 101, dies: 0.8, wob: 1.8, wide: 0.4 }
];

const DT = 1 / 25;
const GYRO_SCALE = 1.008, GYRO_BIAS = 0.42, GYRO_NOISE = 0.35;
const HDG_NOISE = 0.3, POS_NOISE = 0.32;

/* ---- speed ---------------------------------------------------------------
   On the grip section the car is limited by the corner it is in, then by how
   hard it can brake into it and drive out of it — a curvature ceiling with a
   backward and a forward pass, which is what makes the out-lap contain real
   cornering instead of a constant. Through the complex the driver's
   commitment sets the speed instead, because a drifting car is not at the
   grip limit; it is at the limit of what the driver will hold. */
const VMAX = 165 / 3.6, ALAT = 1.15 * 9.81, ABRAKE = 1.25 * 9.81, ADRIVE = 0.45 * 9.81;
const VSTEP = 4;
function buildSpeed(r) {
    const N = Math.ceil((SEND - SOUT) / VSTEP) + 1;
    const v = new Float64Array(N);
    const low = r.entry / 3.6 * 0.66;
    for (let k = 0; k < N; k++) {
        const s = SOUT + k * VSTEP;
        if (s >= S0 && s <= S1) {
            const u = (s - S0) / (S1 - S0);
            v[k] = u < 0.16 ? r.entry / 3.6
                 : u < 0.34 ? r.entry / 3.6 + (low - r.entry / 3.6) * ss((u - 0.16) / 0.18)
                 : u < 0.78 ? low + 1.1 * Math.sin((u - 0.34) / 0.44 * Math.PI)
                 : low + (r.entry / 3.6 * 0.92 - low) * ss((u - 0.78) / 0.22);
        } else {
            const kap = Math.abs(turnAt(s)) * Math.PI / 180;     /* rad per metre */
            v[k] = Math.min(VMAX, kap > 1e-5 ? Math.sqrt(ALAT / kap) : VMAX);
        }
    }
    /* brake into what is coming, then respect what the engine can do */
    for (let k = N - 2; k >= 0; k--)
        v[k] = Math.min(v[k], Math.sqrt(v[k + 1] * v[k + 1] + 2 * ABRAKE * VSTEP));
    for (let k = 1; k < N; k++)
        v[k] = Math.min(v[k], Math.sqrt(v[k - 1] * v[k - 1] + 2 * ADRIVE * VSTEP));
    return v;
}
function kphAt(s, r) {
    const v = r._v || (r._v = buildSpeed(r));
    const f = (Math.max(SOUT, Math.min(SEND, s)) - SOUT) / VSTEP;
    const k = Math.max(0, Math.min(v.length - 2, Math.floor(f)));
    return (v[k] + (v[k + 1] - v[k]) * (f - k)) * 3.6;
}

/* How far off the centreline this run runs, in metres, positive to the right.
   Zero at both ends so the runs converge where the course does. */
function offAt(s, r) {
    const u = (s - S0) / (S1 - S0);
    if (u <= 0 || u >= 1) return 0;
    return r.wide * Math.sin(Math.PI * u) + 0.6 * r.wide * Math.sin(3 * Math.PI * u);
}

/* Slip angle. Sign follows the corner — the nose points to the inside — and
   the magnitude is the driver's commitment against how hard the corner is,
   with the transitions passing through zero because that is what a transition
   IS. */
function betaAt(s, r) {
    const u = (s - S0) / (S1 - S0);
    if (u < 0.17 || u > 0.94) return 0;
    const t = turnAt(s);
    /* a smoothed sign, so the flick through neutral is a ramp not a step */
    const shape = Math.tanh(t * 2.2);
    let amp = 46 * r.commit;
    if (r.dies) {                       /* the angle falls away partway round */
        const k = (u - r.dies) / 0.18;
        if (k > 0) amp *= 1 - 0.62 * ss(k);
    }
    const grow = ss((u - 0.17) / 0.11) * (1 - ss((u - 0.86) / 0.08));
    /* a little wander, so "held smoothly" is a thing that varies between runs */
    const wob = r.wob * 2.4 * Math.sin(u * 17) * Math.sin(u * 6.3);
    return (amp * shape + wob) * grow;
}

/* ---- integrate one run ------------------------------------------------- */
/* The direction the car TRAVELS: the centreline's heading tilted by the slope
   of this run's own lateral offset. Running wide through a corner is not the
   same line as the centreline, and it does not point the same way either. */
function courseAt(s, r) {
    const dodv = (offAt(s + 2, r) - offAt(s - 2, r)) / 4;   /* m per m */
    return hdgAt(s) + Math.atan(dodv);
}

function driveRun(r, t0) {
    const out = [];
    let s = SOUT, t = 0;
    while (s < SEND) {
        const v = kphAt(s, r) / 3.6;
        const p = atS(s), h = hdgAt(s);
        const o = offAt(s, r);
        const nx = Math.cos(h), ny = -Math.sin(h);             /* right normal */
        const course = courseAt(s, r);
        const b = betaAt(s, r);
        /* Body yaw rate = how fast the path turns + how fast the angle
           changes. Both per second, so both scaled by ground speed.
           The path here is the CAR'S path, not the centreline: differencing
           the centreline instead left the gyro disagreeing with the heading
           written beside it by a couple of deg/s, which the calibration then
           dutifully absorbed as an 8% scale error. A fixture has to be
           consistent with itself before it can hold anything to account. */
        const dCourse = (courseAt(s + TSTEP, r) - courseAt(s - TSTEP, r)) / (2 * TSTEP) * 180 / Math.PI * v;
        const dBeta = (betaAt(s + TSTEP, r) - betaAt(s - TSTEP, r)) / (2 * TSTEP) * v;
        out.push({
            t: t0 + t,
            lat: LAT0 + (p.y + o * ny + gauss() * POS_NOISE) / MLA,
            lon: LON0 + (p.x + o * nx + gauss() * POS_NOISE) / MLO,
            kph: v * 3.6,
            hdg: ((course * 180 / Math.PI + gauss() * HDG_NOISE) % 360 + 360) % 360,
            yaw: (dCourse + dBeta) * GYRO_SCALE + GYRO_BIAS + gauss() * GYRO_NOISE,
            beta: b,                                  /* truth, for the checker */
            trueCourseRate: dCourse                   /* truth, for the checker */
        });
        s += v * DT;
        t += DT;
    }
    return out;
}

const rows = [];
const truth = [];
let clock = 0;
RUNS.forEach((r, i) => {
    const run = driveRun(r, clock);
    truth.push({ name: r.name, from: rows.length, to: rows.length + run.length - 1,
                 secs: run.length * DT,
                 entryKph: run[0].kph, exitKph: run[run.length - 1].kph,
                 lowKph: Math.min.apply(null, run.map(x => x.kph)),
                 peakBeta: Math.max.apply(null, run.map(x => Math.abs(x.beta))) });
    rows.push.apply(rows, run);
    /* back to the queue: two minutes of not being recorded */
    clock += run.length * DT + 120 + Math.round(rnd() * 40);
});

/* ---- write the VBO ----------------------------------------------------- */
function clockStr(sec) {
    const s = 9 * 3600 + 40 * 60 + sec;               /* first run just before 09:40 */
    const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ssec = s - hh * 3600 - mm * 60;
    return (hh * 10000 + mm * 100 + Math.floor(ssec)) + (ssec - Math.floor(ssec)).toFixed(2).slice(1);
}
let vbo = 'File created on 10/08/2026 @ 09:40:00\n\n' +
    '[header]\nsats\ntime\nlat\nlong\nvelocity kmh\nheading\nheight\nYaw rate\n\n' +
    '[channel units]\ndeg/s\n\n' +
    '[comments]\n' +
    'Mallala Motor Sport Park — drift practice, final complex (right-left-right onto the main straight).\n' +
    'Synthetic: centreline from the app\'s OSM survey, position integrated from speed at 25 Hz,\n' +
    'yaw rate = path turn rate + angle rate, with a 1.008 scale error, 0.42 deg/s zero offset and noise.\n' +
    '[column names]\nsats time lat long velocity heading height Yaw_rate\n\n[data]\n';
vbo += rows.map(r =>
    '012 ' + clockStr(r.t) + ' ' + (r.lat * 60).toFixed(5) + ' ' + (-r.lon * 60).toFixed(5) +
    ' ' + r.kph.toFixed(3) + ' ' + r.hdg.toFixed(2) + ' 68.00 ' + r.yaw.toFixed(2)).join('\n') + '\n';

fs.writeFileSync(OUT, vbo);
fs.writeFileSync(OUT.replace(/\.vbo$/, '') + '.truth.json', JSON.stringify(truth, null, 1));
/* Per-sample truth, for checks that need to hold a derived channel to
   account rather than a per-run summary. Written beside the file because the
   VBO cannot carry it: a column here would become a channel in the app, and
   the app has no business being handed the answer. */
fs.writeFileSync(OUT.replace(/\.vbo$/, '') + '.rates.json',
    JSON.stringify({ courseRate: rows.map(r => +r.trueCourseRate.toFixed(4)),
                     beta: rows.map(r => +r.beta.toFixed(3)) }));

/* ---- a course to go with it --------------------------------------------
   Emitted from the same geometry the driving came from, so the entry and end
   lines land exactly where the complex starts and stops. Worth having beyond
   the demo: without a course a run is a gap-bounded burst, which at a circuit
   means the whole out-lap — and then the entry/lowest/exit speeds describe
   the drive to the section rather than the drift. With one, a run IS the
   complex and those numbers say what they look like they say. */
function llAt(s, off) {
    const p = atS(s), h = hdgAt(s);
    const nx = Math.cos(h), ny = -Math.sin(h);          /* right normal */
    return [LAT0 + (p.y + (off || 0) * ny) / MLA, LON0 + (p.x + (off || 0) * nx) / MLO];
}
function gateAt(s, name) {
    const at = llAt(s, 0);
    return { lat: at[0], lon: at[1], heading: ((hdgAt(s) * 180 / Math.PI) % 360 + 360) % 360,
             half_width_m: 18, name: name };
}
/* The apex of the first right is around s=2270; the inside of a right-hand
   corner is to the right, so the clip sits a few metres that side of the
   line the car takes. The exit zone runs along the last right onto the
   straight, which is where a judge would want the car to fill the outside. */
const zonePts = [];
for (let s = 2400; s <= 2480; s += 16) zonePts.push(llAt(s, 3.5));
const course = {
    id: 'demo-mallala-complex', name: 'Final complex',
    entry: gateAt(S0 + 40, 'Entry'), finish: gateAt(S1 - 20, 'End'),
    target_kph: 95, target_deg: 45, target_drift_s: 9,
    elements: [
        { k: 'clip', name: 'Inside clip', lat: llAt(2270, 4.5)[0], lon: llAt(2270, 4.5)[1],
          r: 3, max: 10 },
        { k: 'zone', name: 'Exit zone', pts: zonePts, band: 4, max: 15 }
    ]
};
fs.writeFileSync(OUT.replace(/\.vbo$/, '') + '.course.json', JSON.stringify(course, null, 1));

console.log('wrote ' + OUT);
console.log('  ' + rows.length + ' samples, ' + RUNS.length + ' runs, ' +
            (fs.statSync(OUT).size / 1024).toFixed(0) + ' kB');
console.log('  course: Mallala s=' + S0 + '..' + S1 + ' m of ' + LEN.toFixed(0) + ' m');
console.log('\n  what the runs really were:');
console.log('  run  name                secs  entry  low   exit   peak angle');
truth.forEach((t, i) => console.log('   ' + (i + 1) + '   ' + t.name.padEnd(20) +
    t.secs.toFixed(1).padStart(5) + t.entryKph.toFixed(0).padStart(7) +
    t.lowKph.toFixed(0).padStart(6) + t.exitKph.toFixed(0).padStart(7) +
    t.peakBeta.toFixed(1).padStart(11) + '°'));
