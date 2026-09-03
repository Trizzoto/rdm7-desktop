/* Real numbers and real geometry for the marketing artwork.
 *
 * Everything here comes out of the committed golden recordings (ADR-0050)
 * through the app's own engine, lifted verbatim by tools/golden_lib.js. No
 * number on a poster is invented — if it cannot be measured from a recording
 * it does not go on the artwork.
 *
 *   node tools/hype/data.js        writes tools/hype/data/posters.json
 */
const path = require('path'), fs = require('fs'), zlib = require('zlib');
const G = require(path.join(__dirname, '..', 'golden_lib.js'));
const DX = require(path.join(__dirname, 'drift.js'));
const ROOT = path.join(__dirname, '..', '..');
const MAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fixtures.json'), 'utf8'));

/* ---- loading ----------------------------------------------------------- */

function boot(fx, track, mk) {
    const S = (mk || G.sandbox)(track);
    const API = S.API, gp = S.gp;
    gp.trace = fx.rows;
    gp.traceChanIds = fx.chanIds || null;
    gp.traceChanDefs = fx.chanDefs || null;
    gp.ghostFence = null; gp.chan = null; gp.chanKey = '';
    gp.driftSrcPref = null; gp.driftUnit = 0;
    gp.selLap = -1; gp.cmpLap = -1;
    if (track) { gp.tracks.active = track.id || 't'; if (!track.id) track.id = 't'; }
    API.gpComputeG(gp.trace);
    const diag = {};
    gp.traceLaps = track ? API.gpSplitRows(gp.trace, diag) : [];
    gp.selLap = gp.traceLaps.length ? 0 : -1;
    return { API, gp, rows: fx.rows, track, diag };
}

function golden(name) {
    const spec = MAN.fixtures.find(f => f.name === name);
    const fx = G.readFixture(spec);
    return boot(fx, fx.track || spec.track || null);
}

/* The synthetic drift drive that lives at the repo root — the app's own
 * demo drive, rebuildable from a fixed seed by tools/make_drift_fixture.js.
 * It is the only recording here with a car deliberately sideways in it. */
function driftFixture() {
    const S0 = DX.sandbox(null);
    const text = fs.readFileSync(path.join(ROOT, 'mallala-drift.vbo'), 'utf8');
    const parsed = S0.API.gpVboParse(text, 'mallala-drift.vbo');
    const defs = parsed.meta.chanDefs;
    const rows = parsed.rows.map(r => ({
        lat: r.lat, lon: r.lon, kph: r.kph, hdg: r.hdg, g: 0, t: r.ms,
        can: r.cv && r.cv.map((v, k) => (v == null) ? null
            : Math.max(0, Math.min(65535, Math.round((v - defs[k].offset) / defs[k].scale))))
    }));
    /* Its own circuit, taken from the real Mallala golden so the shape on the
       artwork is the surveyed one. */
    const mal = MAN.fixtures.find(f => f.name === 'mallala-2026-08-23');
    const fx = { rows, meta: parsed.meta, chanIds: parsed.meta.chanIds, chanDefs: defs };
    return boot(fx, JSON.parse(JSON.stringify(mal.track)), DX.sandbox);
}

/* ---- measuring --------------------------------------------------------- */

const r3 = v => Math.round(v * 1000) / 1000;
/* Coordinates need six places, not three. Three is a 111 m grid, which draws
   a flowing circuit as a rectilinear staircase — it did, on the first proof. */
const r6 = v => Math.round(v * 1e6) / 1e6;
const r1 = v => Math.round(v * 10) / 10;

function arc(API, rows, from, to) {
    const d = new Float64Array(to - from + 1);
    let s = 0;
    for (let i = from + 1; i <= to; i++) {
        s += API.gpHaversineM([rows[i - 1].lat, rows[i - 1].lon], [rows[i].lat, rows[i].lon]);
        d[i - from] = s;
    }
    return d;
}
/* Elapsed seconds from the lap start, closing on the lap's GATE-measured
 * time. The samples inside a lap span slightly less than the lap does: the
 * gate is crossed between two of them at each end, and gpSpanSecs counts
 * that fraction while a sample-to-sample sum cannot. At 10 Hz the two differ
 * by up to a fifth of a sample — 22 ms on this recording — which is enough
 * for a delta trace to close 22 ms away from the lap gap printed beside it
 * and read as a bug. Stretching the series onto the true span (a 0.03%
 * correction here) makes the trace and the lap times one measurement. */
function elapsed(API, rows, from, to, lap) {
    const e = new Float64Array(to - from + 1);
    for (let i = from + 1; i <= to; i++) e[i - from] = API.gpSecs(rows, from, i);
    const raw = e[e.length - 1];
    const span = lap ? API.gpSpanSecs(rows, lap) : raw;
    if (raw > 0 && span > 0 && Math.abs(span - raw) < 0.5) {
        const k = span / raw;
        for (let i = 0; i < e.length; i++) e[i] *= k;
    }
    return e;
}
/* value of a series sampled at a distance, linearly */
function at(dist, series, s) {
    let i = 0;
    while (i < dist.length - 2 && dist[i + 1] < s) i++;
    const span = dist[i + 1] - dist[i];
    return { i, v: span > 0 ? series[i] + (series[i + 1] - series[i]) * (s - dist[i]) / span : series[i] };
}

/* The continuous delta: at every metre of the circuit, how much time the
 * analysed lap had gained or lost against the reference. Positive = slower. */
function deltaSeries(API, rows, A, B, n) {
    const da = arc(API, rows, A.from, A.to), ea = elapsed(API, rows, A.from, A.to, A);
    const db = arc(API, rows, B.from, B.to), eb = elapsed(API, rows, B.from, B.to, B);
    const La = da[da.length - 1], Lb = db[db.length - 1];
    /* Matched by FRACTION of each lap, not by raw metres. Two laps of the same
       circuit measure a few metres apart — different line, different noise —
       and truncating to the shorter one makes the trace stop before the line,
       so its last value is not the lap gap. On a fraction basis the end of
       the trace IS the difference between the two lap times, which is the
       one number a reader will check it against. */
    const out = [];
    for (let k = 0; k < n; k++) {
        const f = k / (n - 1);
        const a = at(da, ea, La * f), b = at(db, eb, Lb * f);
        out.push({ s: Math.round(La * f), d: r3(a.v - b.v),
                   kph: r1(rows[A.from + a.i].kph) });
    }
    return { pts: out, lengthM: Math.round(La) };
}

function lapPoints(API, gp, rows, lap, want) {
    gp.chan = null; gp.chanKey = '';
    const ch = API.gpChannels();
    const step = Math.max(1, Math.floor((lap.to - lap.from) / want));
    const pts = [];
    for (let i = lap.from; i <= lap.to; i += step)
        pts.push([r6(rows[i].lat), r6(rows[i].lon), r1(rows[i].kph),
                  Math.round(rows[i].g * 100) / 100, Math.round(ch.glat[i] * 100) / 100]);
    return pts;
}

/* Where the time went, corner by corner. The corners are the engine's own
 * (gpFindCorners on the analysed lap); the loss is the delta across each. */
function cornerLoss(API, rows, A, B, corners) {
    const da = arc(API, rows, A.from, A.to), ea = elapsed(API, rows, A.from, A.to, A);
    const db = arc(API, rows, B.from, B.to), eb = elapsed(API, rows, B.from, B.to, B);
    const La = da[da.length - 1], Lb = db[db.length - 1];
    /* same fraction basis as deltaSeries, so the corner losses and the trace
       are describing one curve rather than two */
    const dAt = s => at(da, ea, s).v - at(db, eb, Lb * (s / La)).v;
    return corners.map((c, k) => {
        const s0 = da[Math.max(0, c.entry - A.from)], s1 = da[Math.min(da.length - 1, c.exit - A.from)];
        let vmin = 1e9, vin = 0;
        for (let i = c.entry; i <= c.exit && i < rows.length; i++)
            if (rows[i].kph < vmin) vmin = rows[i].kph;
        vin = rows[c.entry].kph;
        return { n: k + 1, from: Math.round(s0), to: Math.round(s1),
                 lost: r3(dAt(s1) - dAt(s0)), apexKph: r1(vmin), entryKph: r1(vin) };
    });
}

/* Both laps read at the same PLACE — the same fraction round the circuit —
 * so a two-up comparison can print what each car was actually doing there
 * rather than two numbers that only look plausible. */
function pairAt(API, rows, A, B, frac) {
    const da = arc(API, rows, A.from, A.to), ea = elapsed(API, rows, A.from, A.to, A);
    const db = arc(API, rows, B.from, B.to), eb = elapsed(API, rows, B.from, B.to, B);
    const La = da[da.length - 1], Lb = db[db.length - 1];
    const ka = [], kb = [];
    for (let i = A.from; i <= A.to; i++) ka.push(rows[i].kph);
    for (let i = B.from; i <= B.to; i++) kb.push(rows[i].kph);
    const a = at(da, ea, La * frac), b = at(db, eb, Lb * frac);
    return {
        metres: Math.round(La * frac), frac,
        a: { t: Math.round(a.v * 100) / 100, kph: r1(at(da, ka, La * frac).v) },
        b: { t: Math.round(b.v * 100) / 100, kph: r1(at(db, kb, Lb * frac).v) },
        gap: r3(a.v - b.v)
    };
}

/* Splits by equal distance — the shape the Sectors panel draws when a circuit
 * carries no gates of its own, and the arithmetic behind the ideal lap. */
function splits(API, rows, laps, n) {
    const per = laps.map(l => {
        const d = arc(API, rows, l.from, l.to), e = elapsed(API, rows, l.from, l.to, l);
        const L = d[d.length - 1];
        const cuts = [];
        for (let k = 1; k <= n; k++) cuts.push(at(d, e, L * k / n).v);
        const t = []; let prev = 0;
        cuts.forEach(c => { t.push(r3(c - prev)); prev = c; });
        return t;
    });
    const best = [];
    for (let k = 0; k < n; k++) best.push(Math.min(...per.map(p => p[k])));
    return { per, best: best.map(r3), ideal: r3(best.reduce((a, b) => a + b, 0)) };
}

/* Signed lateral offset of the analysed lap from the reference, in metres.
 * Positive is left of the reference. Two laps a car's width apart are
 * sub-pixel with the whole circuit on screen; this is the only thing that
 * shows the difference, and it is measured, never exaggerated. */
function lineOffset(API, rows, A, B, want) {
    const out = [];
    const step = Math.max(1, Math.floor((A.to - A.from) / want));
    let j = B.from;
    for (let i = A.from; i <= A.to; i += step) {
        /* forward-only sliding window: a hairpin must not match the far side */
        let bj = j, bd = Infinity;
        for (let k = j; k <= Math.min(B.to, j + 120); k++) {
            const d = API.gpHaversineM([rows[i].lat, rows[i].lon], [rows[k].lat, rows[k].lon]);
            if (d < bd) { bd = d; bj = k; }
        }
        j = bj;
        const h = rows[bj].hdg * Math.PI / 180;
        const mpd = API.gpMetresPerDeg(rows[bj].lat);
        const dE = (rows[i].lon - rows[bj].lon) * mpd.lo;    /* east */
        const dN = (rows[i].lat - rows[bj].lat) * mpd.la;    /* north */
        /* heading is clockwise from north, so the unit vector along the
           reference's travel is (sin h, cos h) in (east, north). Left of it
           is the perpendicular (-cos h, sin h). */
        const off = -dE * Math.cos(h) + dN * Math.sin(h);
        out.push([r6(rows[i].lat), r6(rows[i].lon), Math.round(off * 100) / 100]);
    }
    return out;
}

function moments(API, gp, rows, lap) {
    gp.chan = null; gp.chanKey = '';
    const ch = API.gpChannels();
    let top = { kph: 0 }, brake = { g: 0 }, corner = { gl: 0 };
    for (let i = lap.from; i <= lap.to && i < rows.length; i++) {
        if (rows[i].kph > top.kph) top = { kph: rows[i].kph, i };
        if (rows[i].g < brake.g) brake = { g: rows[i].g, i, kph: rows[i].kph };
        if (Math.abs(ch.glat[i]) > Math.abs(corner.gl))
            corner = { gl: ch.glat[i], i, kph: rows[i].kph };
    }
    let peak = 0;
    for (let i = lap.from; i <= lap.to && i < rows.length; i++) {
        const m = Math.hypot(ch.glat[i], rows[i].g);
        if (m > peak) peak = m;
    }
    return { top: { kph: r1(top.kph) },
             brake: { g: r3(Math.abs(brake.g)), kph: r1(brake.kph) },
             corner: { g: r3(Math.abs(corner.gl)), kph: r1(corner.kph) },
             peakCombined: r3(peak) };
}

function grip(API, gp, rows, lap, want) {
    gp.chan = null; gp.chanKey = '';
    const ch = API.gpChannels();
    const step = Math.max(1, Math.floor((lap.to - lap.from) / want));
    const pts = [];
    let vmax = 1;
    for (let i = lap.from; i <= lap.to; i++) if (rows[i].kph > vmax) vmax = rows[i].kph;
    for (let i = lap.from; i <= lap.to; i += step) {
        if (rows[i].kph < 8) continue;
        pts.push([Math.round(ch.glat[i] * 100) / 100, Math.round(rows[i].g * 100) / 100,
                  Math.round(rows[i].kph / vmax * 100) / 100]);
    }
    return { pts, vmax: r1(vmax) };
}

/* ---- the recordings ---------------------------------------------------- */

function donington() {
    const D = golden('donington-driver1');
    const { API, gp, rows } = D;
    const laps = gp.traceLaps;
    const times = laps.map(l => API.gpSpanSecs(rows, l));
    const bi = times.indexOf(Math.min(...times));
    const sorted = times.map((t, i) => ({ t, i })).sort((a, b) => a.t - b.t);
    const ci = sorted[1].i;                       /* second best = the reference */
    const best = laps[bi], cmp = laps[ci];
    const corners = API.gpFindCorners(rows, best.from, best.to);
    const sp = splits(API, rows, laps, 3);
    return {
        name: 'Donington National', car: 'Lotus Evora GTE', hz: 10,
        source: 'Racelogic RaceRender demo dataset, VBOX HD2',
        samples: rows.length,
        lapTimes: times.map(t => Math.round(t * 1000) / 1000),
        bestLap: bi + 1, cmpLap: ci + 1,
        bestS: Math.round(times[bi] * 1000) / 1000,
        cmpS: Math.round(times[ci] * 1000) / 1000,
        outline: lapPoints(API, gp, rows, best, 700),
        cmpOutline: lapPoints(API, gp, rows, cmp, 700),
        delta: deltaSeries(API, rows, best, cmp, 420),
        corners: cornerLoss(API, rows, best, cmp, corners),
        cornerCount: corners.length,
        splits: sp,
        lineOffset: lineOffset(API, rows, best, cmp, 700),
        pair: pairAt(API, rows, best, cmp, 0.375),
        moments: moments(API, gp, rows, best),
        grip: grip(API, gp, rows, best, 1400)
    };
}

function mallala() {
    const M = golden('mallala-2026-08-23');
    const { API, gp, rows } = M;
    const laps = gp.traceLaps;
    const clean = API.gpCleanRuns();
    const times = clean.map(l => API.gpSpanSecs(rows, l));
    const breaks = [];
    rows.forEach((r, i) => { if (r.brk) breaks.push({ i, m: Math.round(r.brkM) }); });
    const d = API.gpDriftAngle();
    /* the whole recording drawn, so the breaks can be shown where they fell */
    const step = Math.max(1, Math.floor(rows.length / 900));
    const trace = [];
    for (let i = 0; i < rows.length; i += step)
        trace.push([r6(rows[i].lat), r6(rows[i].lon), r1(rows[i].kph), rows[i].brk ? 1 : 0]);
    /* Speed against elapsed time for the whole session, with the samples
       either side of a gap flagged. A hole in a recording is far more legible
       on the speed trace than on the map, where it is a few pixels of a line
       that already crosses itself. */
    const sstep = Math.max(1, Math.floor(rows.length / 1100));
    const speed = [];
    for (let i = 0; i < rows.length; i += sstep)
        speed.push([Math.round(API.gpSecs(rows, 0, i) * 10) / 10, r1(rows[i].kph),
                    rows[i].brk ? 1 : 0]);
    /* and where each gap falls on that axis */
    const gapsAt = breaks.map(b => ({ t: Math.round(API.gpSecs(rows, 0, b.i) * 10) / 10,
                                      m: Math.round(rows[b.i].brkM) }));

    /* The timed lap on its own. The whole session includes the drive in, the
       drive out and everything in the paddock, which draws as a scribble. */
    let lapOutline = null;
    if (clean.length) {
        const l = clean[times.indexOf(Math.min(...times))];
        const st = Math.max(1, Math.floor((l.to - l.from) / 600));
        lapOutline = [];
        for (let i = l.from; i <= l.to; i += st)
            lapOutline.push([r6(rows[i].lat), r6(rows[i].lon), r1(rows[i].kph)]);
    }

    return {
        speed, gapsAt, lapOutline,
        name: 'Mallala Motor Sport Park', date: '23 August 2026', hz: 25,
        samples: rows.length, channels: 12,
        laps: laps.length, clean: clean.length,
        bestS: times.length ? Math.round(Math.min(...times) * 1000) / 1000 : null,
        breaks: { count: breaks.length, metres: breaks.map(b => b.m),
                  atFrac: breaks.map(b => Math.round(b.i / rows.length * 1000) / 1000) },
        angle: d ? { peakDeg: Math.round(Math.max(...Array.from(d.beta).map(Math.abs)) * 10) / 10,
                     scale: Math.round(d.scale * 10000) / 10000,
                     bias: Math.round(d.bias * 10000) / 10000,
                     anchors: d.anchors, fitN: d.fitN,
                     worst: Math.round(d.worst * 100) / 100 } : null,
        trace
    };
}

function drift() {
    const D = driftFixture();
    const { API, gp, rows } = D;
    const laps = gp.traceLaps;
    const times = laps.map(l => API.gpSpanSecs(rows, l));
    const a = API.gpDriftAngle();
    const board = API.gpDriftBoard();

    /* The best corner-on-a-lap in the drive, and the four parts it was
       rated on. This is the unit the whole mode is built round. */
    let star = null;
    board.cells.forEach((lr, li) => lr.forEach((r, ui) => {
        if (r && r.rating && (!star || r.rating.score > star.rating.score))
            star = { lap: li + 1, unit: ui, rating: r.rating, read: r,
                     members: board.units[ui].members.map(m => board.corners[m].n),
                     linked: !!board.units[ui].linked };
    }));

    /* The angle through that corner, with the error bar the engine claims. */
    let angleTrace = null;
    if (star && a) {
        const pad = 45, f = Math.max(0, star.read.from - pad),
              t = Math.min(rows.length - 1, star.read.to + pad);
        const step = Math.max(1, Math.floor((t - f) / 260));
        const pts = [];
        for (let i = f; i <= t; i += step)
            pts.push([Math.round(API.gpSecs(rows, f, i) * 100) / 100,
                      Math.round(a.beta[i] * 10) / 10, r1(rows[i].kph),
                      a.conf ? Math.round(a.conf[i] * 100) / 100 : null]);
        angleTrace = { pts,
                       inFrom: Math.round(API.gpSecs(rows, f, star.read.from) * 100) / 100,
                       inTo: Math.round(API.gpSecs(rows, f, star.read.to) * 100) / 100 };
    }

    /* Every corner of the best-rated lap, as the board table draws it. */
    const bl = star ? star.lap - 1 : 0;
    const table = board.cells[bl].map((r, ui) => ({
        unit: ui + 1,
        corners: board.units[ui].members.map(m => board.corners[m].n),
        linked: !!board.units[ui].linked,
        stars: r && r.rating ? r.rating.stars : null,
        unrated: r ? (r.spun ? 'spun' : (r.rating ? null : 'not a drift')) : 'not driven',
        heldDeg: r && r.angle ? Math.round(r.angle.held * 10) / 10 : null,
        peakDeg: r && r.angle ? Math.round(r.angle.peak * 10) / 10 : null,
        entryKph: r ? r1(r.entryKph) : null,
        commit: r ? Math.round(r.commit * 100) / 100 : null
    }));

    /* The whole drive drawn, with the sideways stretches marked. */
    const segs = API.gpDriftSegments() || [];
    const inSeg = new Uint8Array(rows.length);
    segs.forEach(s => { for (let i = s.from; i <= s.to && i < rows.length; i++) inSeg[i] = 1; });
    const bi = times.indexOf(Math.min(...times));
    const lap = laps[bl] || laps[bi];
    const step = Math.max(1, Math.floor((lap.to - lap.from) / 700));
    const outline = [];
    for (let i = lap.from; i <= lap.to; i += step)
        outline.push([r6(rows[i].lat), r6(rows[i].lon), r1(rows[i].kph),
                      inSeg[i], a && a.ok[i] ? Math.round(a.beta[i] * 10) / 10 : 0]);

    /* Where on the lap the rated corner is, as a fraction of the drawn
       outline, so the artwork can point at the place it is talking about. */
    const starFrac = star ? [(star.read.from - lap.from) / (lap.to - lap.from),
                             (star.read.to - lap.from) / (lap.to - lap.from)] : null;

    return {
        starFrac,
        name: 'Mallala Motor Sport Park', kind: 'drift practice',
        synthetic: true, samples: rows.length, hz: 25,
        laps: times.map(t => Math.round(t * 1000) / 1000),
        lapAvg: board.lapAvg.map(x => x ? { stars: Math.round(x.stars * 100) / 100, n: x.n } : null),
        bestLap: bl + 1,
        units: board.units.length, corners: board.corners.length,
        linkedUnits: board.units.filter(u => u.linked).length,
        segments: segs.length,
        star, table, angleTrace, outline,
        fullMarksDeg: DX.constOf('GP_DRIFT_STAR_DEG'),
        weights: { angle: 0.45, commit: 0.25, steady: 0.20, speed: 0.10 },
        angleSrc: a && a.src ? { name: a.src.name, kind: a.src.kind, unit: a.src.unit } : null,
        /* what the engine had to undo before any of this could be trusted */
        fit: a ? { scale: Math.round(a.scale * 10000) / 10000,
                   bias: Math.round(a.bias * 1000) / 1000,
                   anchors: a.anchors, worst: Math.round(a.worst * 100) / 100 } : null,
        peakDeg: a ? Math.round(Math.max(...Array.from(a.beta).map(v => Math.abs(v || 0))) * 10) / 10 : null
    };
}

function mountbarker() {
    const R = golden('mountbarker-ring-2026-08-22');
    const { API, gp, rows } = R;
    const step = Math.max(1, Math.floor(rows.length / 1200));
    const trace = [];
    for (let i = 0; i < rows.length; i += step)
        trace.push([r6(rows[i].lat), r6(rows[i].lon), r1(rows[i].kph)]);
    return { name: 'Mount Barker', samples: rows.length, trace,
             /* Moving samples only. A puck parked overnight wanders a few
                km/h on noise, and summing that adds tens of kilometres of
                drive that never happened. */
             km: Math.round(rows.reduce((s, r, i) =>
                 (i && r.kph >= 8 && rows[i - 1].kph >= 8 && !r.brk)
                     ? s + API.gpHaversineM([rows[i - 1].lat, rows[i - 1].lon], [r.lat, r.lon])
                     : s, 0) / 100) / 10 };
}

if (require.main === module) {
    const out = { built: '2026-09-01', donington: donington(), mallala: mallala(),
                  drift: drift(), mountbarker: mountbarker() };
    const dir = path.join(__dirname, 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'posters.json'), JSON.stringify(out));
    const K = n => Math.round(n / 1024) + ' kB';
    console.log('wrote', K(JSON.stringify(out).length));
    console.log('donington best', out.donington.bestS, 'vs', out.donington.cmpS,
                '| corners', out.donington.cornerCount, '| ideal', out.donington.splits.ideal);
    console.log('  moments', JSON.stringify(out.donington.moments));
    console.log('  corner loss', out.donington.corners.map(c => c.n + ':' + c.lost).join(' '));
    console.log('mallala breaks', out.mallala.breaks.metres.join(','), '| angle', JSON.stringify(out.mallala.angle));
    console.log('drift segments', out.drift.segments, '| peak', out.drift.peakDeg,
                '| src', out.drift.angleSrc && out.drift.angleSrc.name);
    console.log('  best corner: lap', out.drift.star.lap, 'corners', out.drift.star.members,
                out.drift.star.rating.stars + '★', '| parts', JSON.stringify(out.drift.star.rating.parts));
    console.log('  table', out.drift.table.map(t => 'T' + t.corners.join('+') + ' ' +
                (t.stars === null ? '(' + t.unrated + ')' : t.stars + '★')).join('  '));
    console.log('  lapAvg', out.drift.lapAvg.map(a => a && a.stars).join(' '));
    console.log('mountbarker km', out.mountbarker.km);
}
module.exports = { donington, mallala, drift, mountbarker };
