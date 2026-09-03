/* Pull real numbers + real geometry out of the committed golden recordings,
 * through the app's own engine, for the marketing artwork. Read-only. */
const path = require('path'), fs = require('fs');
const G = require(path.join(__dirname, '..', 'golden_lib.js'));
const MAN = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'fixtures.json'), 'utf8'));
const OUT = path.join(__dirname, 'data');
fs.mkdirSync(OUT, { recursive: true });

function load(name) {
    const spec = MAN.fixtures.find(f => f.name === name);
    const fx = G.readFixture(spec);
    const track = fx.track || spec.track || null;
    const S = G.sandbox(track);
    const API = S.API, gp = S.gp;
    gp.trace = fx.rows; gp.traceChanIds = fx.chanIds || null; gp.traceChanDefs = fx.chanDefs || null;
    gp.ghostFence = null; gp.chan = null; gp.chanKey = ''; gp.selLap = -1;
    if (track) { gp.tracks.active = track.id || 't'; if (!track.id) track.id = 't'; }
    API.gpComputeG(gp.trace);
    const diag = {};
    gp.traceLaps = track ? API.gpSplitRows(gp.trace, diag) : [];
    gp.selLap = gp.traceLaps.length ? 0 : -1;
    return { spec, fx, track, API, gp, rows: fx.rows };
}

/* distance travelled along a row range, metres */
function arc(API, rows, from, to) {
    const d = new Float64Array(to - from + 1);
    let s = 0;
    for (let i = from + 1; i <= to; i++) {
        s += API.gpHaversineM(rows[i - 1].lat, rows[i - 1].lon, rows[i].lat, rows[i].lon);
        d[i - from] = s;
    }
    return d;
}

/* Elapsed seconds from the lap start for every sample of the lap. */
function elapsed(API, rows, from, to) {
    const e = new Float64Array(to - from + 1);
    for (let i = from + 1; i <= to; i++) e[i - from] = API.gpSecs(rows, from, i);
    return e;
}

/* The continuous delta: for each metre travelled on lap A, how far ahead or
 * behind lap B was at the same PLACE. Positive = A is losing time. */
function deltaByDistance(API, rows, A, B, n) {
    const da = arc(API, rows, A.from, A.to), ea = elapsed(API, rows, A.from, A.to);
    const db = arc(API, rows, B.from, B.to), eb = elapsed(API, rows, B.from, B.to);
    const L = Math.min(da[da.length - 1], db[db.length - 1]);
    const out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
        const s = L * k / (n - 1);
        while (j < db.length - 2 && db[j + 1] < s) j++;
        const span = db[j + 1] - db[j];
        const tb = span > 0 ? eb[j] + (eb[j + 1] - eb[j]) * (s - db[j]) / span : eb[j];
        /* and where A was at that same distance */
        let i = 0; while (i < da.length - 2 && da[i + 1] < s) i++;
        const sp2 = da[i + 1] - da[i];
        const ta = sp2 > 0 ? ea[i] + (ea[i + 1] - ea[i]) * (s - da[i]) / sp2 : ea[i];
        out.push({ s: Math.round(s), d: Math.round((ta - tb) * 1000) / 1000,
                   kph: Math.round(rows[A.from + i].kph * 10) / 10 });
    }
    return out;
}

function lapGeom(API, gp, rows, lap, step) {
    const ch = (gp.chan = null, gp.chanKey = '', API.gpChannels());
    const pts = [];
    for (let i = lap.from; i <= lap.to; i += step) {
        pts.push({ lat: rows[i].lat, lon: rows[i].lon,
                   kph: Math.round(rows[i].kph * 10) / 10,
                   g: Math.round(rows[i].g * 1000) / 1000,
                   gl: Math.round(ch.glat[i] * 1000) / 1000 });
    }
    return pts;
}

module.exports = { load, arc, elapsed, deltaByDistance, lapGeom, MAN, OUT };

if (require.main === module) {
    const D = load('donington-driver1');
    console.log('DONINGTON laps', D.gp.traceLaps.length);
    const times = D.gp.traceLaps.map(l => D.API.gpSpanSecs(D.rows, l));
    console.log('times', times.map(t => t.toFixed(3)).join(' '));
    const bi = times.indexOf(Math.min(...times));
    console.log('best lap idx', bi);
    const cs = D.API.gpFindCorners(D.rows, D.gp.traceLaps[bi].from, D.gp.traceLaps[bi].to);
    console.log('corners', cs.length, JSON.stringify(cs[0]));
    const ch = D.API.gpChannels();
    console.log('glat sample', ch.glat[D.gp.traceLaps[bi].from + 100]);
}
