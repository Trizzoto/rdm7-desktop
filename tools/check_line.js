/* How close is the DRAWN line to the line the car actually drove?
 *
 * Pulls the real smoother out of src/tauri-overlay.html (no copies — a copy
 * would drift and then pass while the app failed) and scores it against a
 * curve whose true shape is known analytically, so "more accurate" is a
 * number rather than an opinion.
 *
 * The drive is corrupted the way a GNSS receiver corrupts it:
 *   - position gets white noise of sigma metres per axis. A VBOX export or
 *     the puck's own download is 0.3-0.5 m; a phone log can be metres.
 *   - HEADING does not. Receivers derive heading from Doppler, which is far
 *     cleaner than position — that asymmetry is why the heading channel is
 *     what sets the window width.
 *
 * The metric is the perpendicular distance from each TRUE point to the drawn
 * polyline. Point-to-point would flatter any method that lags.
 *
 *   node tools/check_line.js            score the working tree
 *   node tools/check_line.js HEAD~1     ...and compare against a git ref
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

/* ---- extract named functions verbatim ---------------------------------- */
function grabFrom(src, name) {
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

/* Every function gpSmoothPath reaches for, plus the ones it used to. Missing
   names are skipped so an older revision still builds. */
const WANT = ['gpMetres', 'gpSecs', 'gpStep', 'gpSmoothAxis', 'gpSmoothNoise', 'gpSmoothPath'];

function build(src) {
    const parts = [];
    for (const n of WANT) {
        try { parts.push(grabFrom(src, n)); } catch (e) { /* not in this revision */ }
    }
    const body = parts.join('\n') +
        '\n;return function (rows) { gp.trace = rows; gp.pathKey = ""; gp.path = null;' +
        ' return gpSmoothPath(); };';
    const gp = { trace: null, pathKey: '', path: null, liveMode: false };
    return new Function('gp', 'GP_SMOOTH_LIVE', 'GP_SMOOTH_MAXW', 'GP_MAX_STEP_S', 'GP_DT',
        body)(gp, 10, 60, 0.5, 1 / 25);
}

/* ---- ground truth ------------------------------------------------------- */
const CLAT = -36.5266, CLON = 146.0899;
const MLAT = 111320, MLON = 111320 * Math.cos(CLAT * Math.PI / 180);
const R0 = 330;
/* r(theta) > 0 everywhere, so the course provably never crosses its own line */
const rad = th => R0 * (1 + 0.30 * Math.cos(2 * th) + 0.11 * Math.sin(3 * th)
                          - 0.07 * Math.cos(5 * th));
const TRUTH = [], TCUM = [0];
for (let k = 0; k <= 200000; k++) {
    const th = k / 200000 * 2 * Math.PI, r = rad(th);
    TRUTH.push([r * Math.cos(th), r * Math.sin(th)]);
    if (k) TCUM.push(TCUM[k - 1] + Math.hypot(TRUTH[k][0] - TRUTH[k - 1][0],
                                              TRUTH[k][1] - TRUTH[k - 1][1]));
}
const LEN = TCUM[TCUM.length - 1];

function atS(s) {
    s = ((s % LEN) + LEN) % LEN;
    let lo = 0, hi = TCUM.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (TCUM[m] < s) lo = m + 1; else hi = m; }
    const i = Math.max(1, lo);
    const f = (s - TCUM[i - 1]) / Math.max(1e-9, TCUM[i] - TCUM[i - 1]);
    const x = TRUTH[i - 1][0] + (TRUTH[i][0] - TRUTH[i - 1][0]) * f;
    const y = TRUTH[i - 1][1] + (TRUTH[i][1] - TRUTH[i - 1][1]) * f;
    let tx = TRUTH[i][0] - TRUTH[i - 1][0], ty = TRUTH[i][1] - TRUTH[i - 1][1];
    const tl = Math.hypot(tx, ty) || 1;
    return { x, y, tx: tx / tl, ty: ty / tl };
}

/* fixed seed, so two runs compare like for like */
let _s = 12345;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; };
function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* speed from curvature, integrated — never decorative texture */
function speedAt(s) {
    const a = atS(s), b = atS(s + 2);
    let dh = Math.atan2(b.ty, b.tx) - Math.atan2(a.ty, a.tx);
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const kap = Math.abs(dh) / 2;
    return Math.max(12, Math.min(55, kap > 1e-6 ? Math.sqrt(10 / kap) : 55));
}

function drive(hz, sigma) {
    _s = 12345;
    const dt = 1 / hz, rows = [], truth = [];
    let s = 0, t = 0;
    while (s < LEN) {
        const p = atS(s), v = speedAt(s);
        truth.push([p.x, p.y]);
        rows.push({
            lat: CLAT + (p.y + gauss() * sigma) / MLAT,
            lon: CLON + (p.x + gauss() * sigma) / MLON,
            kph: v * 3.6,
            hdg: (Math.atan2(p.tx, p.ty) * 180 / Math.PI + 360 + gauss() * 0.4) % 360,
            t: Math.round(t * 1000), g: 0
        });
        s += v * dt; t += dt;
    }
    return { rows, truth };
}

/* ---- scoring ------------------------------------------------------------ */
const toXY = ll => [(ll[1] - CLON) * MLON, (ll[0] - CLAT) * MLAT];
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let u = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return Math.hypot(px - (ax + dx * u), py - (ay + dy * u));
}
function score(drawn, truth, idx) {
    const errs = [];
    for (let n = 0; n < truth.length; n++) {
        const p = truth[n], j = idx ? idx[n] : n;
        let best = Infinity;
        for (let k = Math.max(0, j - 30); k <= Math.min(drawn.length - 2, j + 30); k++) {
            const d = segDist(p[0], p[1], drawn[k][0], drawn[k][1],
                              drawn[k + 1][0], drawn[k + 1][1]);
            if (d < best) best = d;
        }
        errs.push(best);
    }
    errs.sort((a, b) => a - b);
    return {
        rms: +Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / errs.length).toFixed(3),
        p95: +errs[Math.floor(errs.length * 0.95)].toFixed(3)
    };
}

/* ---- run ---------------------------------------------------------------- */
const ref = process.argv[2];
const now = build(fs.readFileSync(path.join(ROOT, REL), 'utf8'));
let old = null;
if (ref) {
    try {
        old = build(execSync('git show ' + ref + ':' + REL, { cwd: ROOT, maxBuffer: 1 << 28 }).toString());
    } catch (e) { console.error('cannot read ' + ref + ': ' + e.message); process.exit(2); }
}

let pass = 0, fail = 0;
const ok = (what, cond, note) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + what + (note ? '   ' + note : ''));
    cond ? pass++ : fail++;
};

console.log('\nground truth: a ' + LEN.toFixed(0) + ' m closed course, known analytically');
console.log('\ndistance from the drawn line to the line the car really drove, metres');
console.log('  rate  noise |  raw fixes  |    drawn    |' + (old ? '     ' + ref + '    |' : ''));
for (const hz of [10, 25]) for (const sigma of [0.2, 0.4, 0.8]) {
    const { rows, truth } = drive(hz, sigma);
    const raw = score(rows.map(r => toXY([r.lat, r.lon])), truth);
    const a = score(now(rows).map(toXY), truth);
    const b = old ? score(old(rows).map(toXY), truth) : null;
    console.log('  %s Hz %sm | %s / %s | %s / %s |%s',
        String(hz).padStart(4), sigma.toFixed(1),
        raw.rms.toFixed(3), raw.p95.toFixed(3), a.rms.toFixed(3), a.p95.toFixed(3),
        b ? ' ' + b.rms.toFixed(3) + ' / ' + b.p95.toFixed(3) + ' |' : '');
    /* Smoothing that lands further from the truth than the raw fixes is not
       smoothing, it is damage. */
    ok('  ' + hz + ' Hz sigma ' + sigma + ': beats the raw fixes', a.rms < raw.rms * 0.85);
    if (b) ok('  ' + hz + ' Hz sigma ' + sigma + ': no worse than ' + ref, a.rms <= b.rms * 1.02);
}

console.log('\nthe tightest 10% of the course — where a wide window would show');
for (const hz of [10, 25]) {
    const { rows, truth } = drive(hz, 0.4);
    const kap = rows.map((_, i) => {
        const j0 = Math.max(0, i - 2), j1 = Math.min(rows.length - 1, i + 2);
        let dh = Math.abs(rows[j1].hdg - rows[j0].hdg) % 360;
        return dh > 180 ? 360 - dh : dh;
    });
    const thr = kap.slice().sort((a, b) => b - a)[Math.floor(kap.length * 0.1)];
    const pick = [], pidx = [];
    truth.forEach((p, i) => { if (kap[i] >= thr) { pick.push(p); pidx.push(i); } });
    const raw = score(rows.map(r => toXY([r.lat, r.lon])), pick, pidx);
    const a = score(now(rows).map(toXY), pick, pidx);
    const b = old ? score(old(rows).map(toXY), pick, pidx) : null;
    console.log('  %d Hz  raw %s   drawn %s%s', hz, raw.rms.toFixed(3), a.rms.toFixed(3),
        b ? '   ' + ref + ' ' + b.rms.toFixed(3) : '');
    ok('  ' + hz + ' Hz: the apex is not cut', a.rms < raw.rms * 0.85);
    if (b) ok('  ' + hz + ' Hz: apex no worse than ' + ref, a.rms <= b.rms * 1.02);
}

console.log('\na car parked for 20 s must not scribble');
{
    const rows = [], p = atS(100);
    for (let i = 0; i < 500; i++)
        rows.push({ lat: CLAT + (p.y + (Math.sin(i * 7.3) + Math.cos(i * 3.1)) * 0.35) / MLAT,
                    lon: CLON + (p.x + (Math.cos(i * 5.7) + Math.sin(i * 2.9)) * 0.35) / MLON,
                    kph: 0.4, hdg: (i * 37) % 360, t: i * 40, g: 0 });
    const spread = pts => {
        const xy = pts.map(toXY);
        let mx = 0;
        for (let i = 0; i < xy.length; i += 5) for (let j = i + 1; j < xy.length; j += 5)
            mx = Math.max(mx, Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]));
        return mx;
    };
    const r = spread(rows.map(x => [x.lat, x.lon])), a = spread(now(rows));
    console.log('  raw %s m across, drawn %s m across', r.toFixed(2), a.toFixed(2));
    ok('  the scribble collapses', a < r * 0.7);
}

console.log('\ninputs that must not crash or produce NaN');
{
    const { rows } = drive(25, 0.4);
    const cases = {
        'speed channel dead': rows.map(r => Object.assign({}, r, { kph: 0 })),
        'no timestamps': rows.map(r => Object.assign({}, r, { t: undefined })),
        'one sample': rows.slice(0, 1),
        'two samples': rows.slice(0, 2),
        'every sample identical': rows.slice(0, 200).map(() => Object.assign({}, rows[0]))
    };
    for (const k of Object.keys(cases)) {
        let good = false, note = '';
        try {
            const o = now(cases[k]);
            const bad = o.filter(p => !p || !isFinite(p[0]) || !isFinite(p[1])).length;
            good = o.length === cases[k].length && bad === 0;
            note = o.length + ' points, ' + bad + ' non-finite';
        } catch (e) { note = 'threw: ' + e.message; }
        ok('  ' + k, good, note);
    }
}

console.log('\ncost (computed once per recording, then cached)');
{
    const big = [];
    for (let i = 0; i < 331000; i++) {
        const p = atS(i * 1.2);
        big.push({ lat: CLAT + p.y / MLAT, lon: CLON + p.x / MLON, kph: 108,
                   hdg: (Math.atan2(p.tx, p.ty) * 180 / Math.PI + 360) % 360, t: i * 40, g: 0 });
    }
    let t0 = Date.now(); now(big.slice(0, 12000)); const small = Date.now() - t0;
    t0 = Date.now(); now(big); const full = Date.now() - t0;
    console.log('  12,000 samples (a session) %d ms, 331,000 (a full ring) %d ms', small, full);
    ok('  a session stays interactive', small < 400, small + ' ms');
    ok('  a full ring stays tolerable', full < 4000, full + ' ms');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
