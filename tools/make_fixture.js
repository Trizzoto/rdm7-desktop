/* A .rdmsession of five laps at Winton, written into src/dist (gitignored) so
 * a running Studio can fetch and import it through its own code path.
 *
 * A DEV AID, not a feature: ADR-0011 is that the app never fabricates data,
 * and nothing here ships. It exists because the GPS workspace cannot
 * otherwise be exercised without a puck and a circuit, and "it renders" is
 * not something to find out at the track.
 *
 * Generator rules, each learned from a test that lied while the code was
 * right: integrate position from speed at 25 Hz so lap TIME follows lap
 * SPEED; use a closed polar curve r = R0 + A*cos(3t) + B*cos(5t), which is
 * positive everywhere and so provably never crosses itself; take speed from
 * curvature rather than decorative texture; and give every sample a real
 * heading, or yaw rate and lateral g come out identically zero and a broken
 * channel looks fine.
 *
 *   node tools/make_fixture.js
 *   then, in the app's Session view, Import a session file
 */
const fs = require('fs');
const path = require('path');

const CENTRE = [-36.5183, 146.0861];   /* Winton, from GP_PLACES */
const D = Math.PI / 180, R = 6371008.8;
const mLat = D * R, mLon = D * R * Math.cos(CENTRE[0] * D);
const R0 = 380, A = 90, B = 45;

const pos = th => {
    const r = R0 + A * Math.cos(3 * th) + B * Math.cos(5 * th);
    return [r * Math.cos(th), r * Math.sin(th)];
};
const speedAt = th => {
    const h = 0.01;
    const [x0, y0] = pos(th - h), [x1, y1] = pos(th), [x2, y2] = pos(th + h);
    const a = Math.hypot(x1 - x0, y1 - y0), b = Math.hypot(x2 - x1, y2 - y1);
    const c = Math.hypot(x2 - x0, y2 - y0);
    const area = Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
    const cr = area < 1e-9 ? 1e6 : (a * b * c) / (4 * area);
    return Math.max(12, Math.min(55, Math.sqrt(1.1 * 9.81 * cr)));
};

/* Two CAN channels, so the fixture exercises the channel columns as well as
   the GPS block. Both are DERIVED FROM THE PHYSICS already integrated above,
   never painted on: RPM follows road speed through a fixed final drive and a
   gear picked by speed, and throttle follows the longitudinal acceleration
   the speed trace actually implies. A decorative sine here would let a broken
   decode look perfectly healthy, which is the whole reason for the rule. */
const GEARS = [3.6, 2.2, 1.5, 1.1, 0.9];          /* ratio per gear */
const FINAL = 3.9, TYRE_M = 1.98;                  /* rolling circumference */
function rpmFor(vms) {
    const wheelRps = vms / TYRE_M;
    /* Pick the highest gear that keeps it under 7000 — a real shift pattern,
       so the trace steps at the shift points instead of being a scaled copy
       of speed. */
    for (let g = GEARS.length - 1; g >= 0; g--) {
        const r = wheelRps * FINAL * GEARS[g] * 60;
        if (r < 7000 || g === 0) return Math.max(1200, r);
    }
    return 1200;
}

const rows = [];
let tms = Date.UTC(2026, 6, 25, 3, 12, 0) % 4294967295;   /* fits the u32 t field */
let clock = Date.UTC(2026, 6, 25, 3, 12, 0);
const LAPS = 5;
let prevV = null;
for (let lap = 0; lap < LAPS; lap++) {
    const scale = 1 + [0.02, -0.01, 0, 0.008, 0.03][lap];
    let th = 0;
    while (th < Math.PI * 2) {
        const [x, y] = pos(th);
        const v = speedAt(th) / scale;
        /* Heading from the direction of travel. A constant heading makes yaw
           rate and lateral g identically zero, which reads as a car that
           never turned — and would let a broken channel look fine. */
        const [hx, hy] = pos(th + 1e-4);
        const hdgDeg = (Math.atan2(hx - x, hy - y) / D + 360) % 360;
        /* Throttle from the acceleration this speed trace implies: hard on
           where it is gaining, closed where it is losing. */
        const accel = prevV === null ? 0 : (v - prevV) * 25;      /* m/s^2 */
        prevV = v;
        const throttle = Math.max(0, Math.min(100, 50 + accel * 14));
        rows.push({ lat: CENTRE[0] + y / mLat, lon: CENTRE[1] + x / mLon,
                    kph: v * 3.6, hdg: hdgDeg, t: tms,
                    /* Raw counts, exactly as the puck stores them: the scale
                       lives in the channel definition, not in the data. */
                    can: [Math.round(rpmFor(v)), Math.round(throttle * 10)] });
        const [nx, ny] = pos(th + 1e-4);
        th += (v / 25) / (Math.hypot(nx - x, ny - y) / 1e-4);
        tms += 40;
    }
}

const n = rows.length;
const NCH = 2;
const lat = new Int32Array(n), lon = new Int32Array(n);
const kph = new Uint16Array(n), hdg = new Uint16Array(n), t = new Uint32Array(n);
const can = new Uint16Array(n * NCH);
rows.forEach((r, i) => {
    lat[i] = Math.round(r.lat * 1e7); lon[i] = Math.round(r.lon * 1e7);
    kph[i] = Math.round(r.kph * 100); hdg[i] = Math.round(r.hdg * 100);
    t[i] = r.t;
    /* One stale sample per lap, so the "gone quiet" path is exercised too —
       0xFFFF is the node's TRACE_CHAN_STALE and must read back as a gap. */
    can[i * NCH] = (i % 1500 === 400) ? 0xFFFF : r.can[0];
    can[i * NCH + 1] = r.can[1];
});
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

const out = {
    format: 'rdm-session', version: 1,
    meta: {
        name: 'Winton — fixture', trackId: null, trackName: 'Winton', trial: false,
        recordedAt: clock, dated: 'gps', savedAt: Date.now(),
        device: 'RDM GPS', samples: n, durationS: (n - 1) * 0.04,
        lapCount: 0, bestLapS: null, lapTimesS: [], corners: [], car: '', driver: '',
        /* The ids these columns mean. They match the two definitions the
           fixture README asks you to add by hand (or import), so the rack can
           name and scale them. */
        chanIds: ['my:fixture_rpm', 'my:fixture_thr']
    },
    data: { n, lat: b64(lat), lon: b64(lon), kph: b64(kph), hdg: b64(hdg), t: b64(t),
            nch: NCH, can: b64(can) }
};
const dst = path.join('C:', 'Users', 'ruuva', 'workspace', 'rdm7-desktop', 'src', 'dist', 'fixture.rdmsession');
fs.writeFileSync(dst, JSON.stringify(out));
console.log('wrote', dst, n, 'samples,', ((n - 1) * 0.04 / 60).toFixed(1), 'min');

/* The recording carries raw counts; what they MEAN lives in the channel
 * definitions, which are per-PC. Without these two the columns still draw —
 * unnamed and unscaled, which is the honest fallback — so paste this into the
 * app's console first if you want them labelled properly. */
const defs = [
    { id: 'my:fixture_rpm', name: 'Engine RPM', unit: 'rpm', decimals: 0,
      decode: { can_id: 0x360, bit_start: 0, bit_length: 16, is_signed: false,
                endian: 1, scale: 1, offset: 0 } },
    { id: 'my:fixture_thr', name: 'Throttle', unit: '%', decimals: 1,
      decode: { can_id: 0x360, bit_start: 16, bit_length: 16, is_signed: false,
                endian: 1, scale: 0.1, offset: 0 } }
];
console.log('\nto have the two channels named and scaled, paste into the app console:\n');
console.log("localStorage.setItem('rdm7_gp_mychans', '" + JSON.stringify(defs) + "'); location.reload()");
