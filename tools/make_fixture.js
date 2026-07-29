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

const rows = [];
let tms = Date.UTC(2026, 6, 25, 3, 12, 0) % 4294967295;   /* fits the u32 t field */
let clock = Date.UTC(2026, 6, 25, 3, 12, 0);
const LAPS = 5;
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
        rows.push({ lat: CENTRE[0] + y / mLat, lon: CENTRE[1] + x / mLon,
                    kph: v * 3.6, hdg: hdgDeg, t: tms });
        const [nx, ny] = pos(th + 1e-4);
        th += (v / 25) / (Math.hypot(nx - x, ny - y) / 1e-4);
        tms += 40;
    }
}

const n = rows.length;
const lat = new Int32Array(n), lon = new Int32Array(n);
const kph = new Uint16Array(n), hdg = new Uint16Array(n), t = new Uint32Array(n);
rows.forEach((r, i) => {
    lat[i] = Math.round(r.lat * 1e7); lon[i] = Math.round(r.lon * 1e7);
    kph[i] = Math.round(r.kph * 100); hdg[i] = Math.round(r.hdg * 100);
    t[i] = r.t;
});
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');

const out = {
    format: 'rdm-session', version: 1,
    meta: {
        name: 'Winton — fixture', trackId: null, trackName: 'Winton', trial: false,
        recordedAt: clock, dated: 'gps', savedAt: Date.now(),
        device: 'RDM GPS', samples: n, durationS: (n - 1) * 0.04,
        lapCount: 0, bestLapS: null, lapTimesS: [], corners: [], car: '', driver: ''
    },
    data: { n, lat: b64(lat), lon: b64(lon), kph: b64(kph), hdg: b64(hdg), t: b64(t) }
};
const dst = path.join('C:', 'Users', 'ruuva', 'workspace', 'rdm7-desktop', 'src', 'dist', 'fixture.rdmsession');
fs.writeFileSync(dst, JSON.stringify(out));
console.log('wrote', dst, n, 'samples,', ((n - 1) * 0.04 / 60).toFixed(1), 'min');
