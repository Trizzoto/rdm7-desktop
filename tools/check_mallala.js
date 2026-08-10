/* Does the Drift view read a real circuit, corner by corner, correctly?
 *
 * check_drift.js proves the angle engine and the star arithmetic against an
 * analytic figure. This proves the WHOLE CHAIN against a real circuit: it runs
 * the fixture through the app's own VBO importer — the same code an imported
 * drift-box log goes through, minutes and positive-west longitude and HHMMSS
 * clock included — splits it into laps on Mallala's own start/finish line,
 * finds the corners, reads and rates every corner on every lap, and then holds
 * all of it against the answer sheet the generator wrote at the same time.
 *
 * The geometry is Mallala's real circuit, so the corners are whatever the
 * survey says they are rather than something chosen to be easy.
 *
 *   node tools/make_drift_fixture.js /tmp/mallala-drift.vbo
 *   node tools/check_mallala.js      /tmp/mallala-drift.vbo
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VBO = process.argv[2] || path.join(ROOT, 'mallala-drift.vbo');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

/* ---- pull the real code out of the app -------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === '{') d++; else if (SRC[j] === '}') { d--; if (!d) { j++; break; } } }
    return SRC.slice(m.index, j);
}
function varBlock(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf(m[0].endsWith('{') ? '{' : (SRC[m.index + m[0].length] === '[' ? '[' : '{'), m.index);
    const open = SRC[i], close = open === '{' ? '}' : ']';
    let d = 0, j = i;
    for (; j < SRC.length; j++) { if (SRC[j] === open) d++; else if (SRC[j] === close) { d--; if (!d) { j++; break; } } }
    return SRC.slice(m.index, j) + ';';
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const K = {};
['GP_DRIFT_MIN_KPH', 'GP_DRIFT_ON', 'GP_DRIFT_OFF',
 'GP_DRIFT_HOLD_S', 'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G',
 'GP_DRIFT_STAR_DEG', 'GP_DRIFT_STAR_WOB', 'GP_DRIFT_SCORE_VER',
 'GP_DRIFT_ROUGH', 'GP_MAX_STEP_S', 'GP_CHAN_STALE',
 'GP_COAST_G', 'GP_BRAKE_G', 'GP_CORNER_PAD'].forEach(n => K[n] = constOf(n));
K.GP_DRIFT_STAR_W = eval('(' + /var GP_DRIFT_STAR_W = (\{[^}]*\})/.exec(SRC)[1] + ')');

const FNS = [
    'gpN', 'gpMetres', 'gpMetresPerDeg', 'gpSecs', 'gpStep', 'gpChanDefsById',
    'gpSignedDist', 'gpGateHits', 'gpMainDir', 'gpChannels', 'gpComputeG',
    'gpArcLength', 'gpCornerScan', 'gpFindCorners', 'gpCornerPhases', 'gpNearestIndex',
    'gpSplitRows',
    'gpGapS', 'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess',
    'gpDriftSrcPrefs', 'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle',
    'gpDriftSeek', 'gpDriftSwitches', 'gpDriftSegments', 'gpDriftStats',
    'gpDriftRefLap', 'gpDriftCorners', 'gpDriftCornerRead', 'gpDriftStars',
    'gpDriftBoard', 'gpDriftBest', 'gpDriftForget',
    'gpVboClockMs', 'gpVboSpeedScale', 'gpVboParse', 'gpHaversineM'
];

const gp = {};
const win = { localStorage: { getItem: () => null, setItem: () => {} } };
/* Mallala's own derived start/finish, exactly as GP_STARTS ships it: the
   midpoint of the longest straight, 15 m half width. The laps this harness
   asserts on are the laps the app would cut with no help from anybody. */
const fakeTrack = {
    id: 't', name: 'Mallala',
    start_finish: { lat: -34.4161627, lon: 138.5030594, heading: 155.7, half_width_m: 15, derived: true }
};
let libChans = [];
const stubs = `
    function gpRowsPack(rows) { return { n: rows.length }; }
    function gpEsc(s) { return String(s == null ? "" : s); }
    function gpSesUid() { return "ses_fixture"; }
`;
const ARGN = ['gp', 'window', 'GP_DT', 'GP_TRACE_HZ', 'gpActiveTrack', 'gpAllChans', ...Object.keys(K)];
const API = new Function(...ARGN,
    varBlock('GP_VBO_ROLE') + '\n' + varBlock('GP_PLACES') + '\n' + stubs + '\n' +
    FNS.map(grab).join('\n') +
    '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};'
)(gp, win, 1 / 25, 25, () => fakeTrack, () => libChans, ...Object.keys(K).map(n => K[n]));

/* ---- load the fixture through the real importer ----------------------- */
const truth = JSON.parse(fs.readFileSync(VBO.replace(/\.vbo$/, '') + '.truth.json', 'utf8'));
const parsed = API.gpVboParse(fs.readFileSync(VBO, 'utf8'), path.basename(VBO));

/* gpVboParse hands back the file's own FLOATS in rows[].cv, and separately a
   per-channel scale/offset it fitted so those floats survive as u16 in
   storage. A loaded session carries the u16, and every reader decodes it with
   those defs. So encode here exactly as saving does — otherwise the decode
   runs a second time over already-decoded values. */
const defs = parsed.meta.chanDefs;
gp.trace = parsed.rows.map(r => ({
    lat: r.lat, lon: r.lon, kph: r.kph, hdg: r.hdg, g: 0, t: r.ms,
    can: r.cv && r.cv.map((v, k) => v === null || v === undefined ? null
        : Math.max(0, Math.min(65535, Math.round((v - defs[k].offset) / defs[k].scale))))
}));
gp.traceChanIds = parsed.meta.chanIds;
gp.traceChanDefs = defs;
API.gpComputeG(gp.trace);
gp.ghostFence = null; gp.chan = null; gp.chanKey = '';
gp.driftSrcPref = null; gp.driftCorner = 0;
API.gpDriftForget();
gp.traceLaps = API.gpSplitRows(gp.trace);
gp.selLap = 0; gp.cmpLap = -1;

/* Distance from a point to a planted corner — measured to its start, middle
   AND end. A 260 m sweeper's midpoint sits a long way from where a
   speed-based detector puts the apex, and matching on the midpoint alone
   would call a correct detection a miss. */
function distToPlanted(pt, t) {
    let best = API.gpMetres(pt, { lat: t.lat, lon: t.lon });
    (t.pts || []).forEach(q => {
        const d = API.gpMetres(pt, { lat: q[0], lon: q[1] });
        if (d < best) best = d;
    });
    return best;
}

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '   ' + detail : '')); }
}
const head = s => console.log('\n' + s);

head('The file survives the round trip');
{
    ok('it parses at all', !!parsed && parsed.rows.length > 5000, parsed.rows.length + ' samples');
    ok('the channel comes through named and united',
       defs.length === 1 && /yaw/i.test(defs[0].name) && /deg\/s/i.test(defs[0].unit),
       JSON.stringify({ n: defs[0] && defs[0].name, u: defs[0] && defs[0].unit }));
    /* Longitude positive-west and latitude-in-minutes are the two traps that
       silently put a session in the wrong hemisphere. */
    const lat = gp.trace[0].lat, lon = gp.trace[0].lon;
    ok('and it lands at Mallala, not its mirror image',
       Math.abs(lat - -34.41) < 0.05 && Math.abs(lon - 138.50) < 0.05,
       lat.toFixed(4) + ', ' + lon.toFixed(4));
}

head('Laps, cut on the circuit’s own start/finish line');
{
    /* The generator drives LAPS.length laps from a standing start at s=0. The
       line is partway round, so the first crossing happens partway through
       lap 1 — which means one fewer complete lap than laps driven. */
    const want = truth.laps.length - 1;
    ok('the laps are found', gp.traceLaps.length === want,
       gp.traceLaps.length + ' complete laps from ' + truth.laps.length + ' driven');
    const secs = gp.traceLaps.map(l => API.gpSecs(gp.trace, l.from, l.to));
    ok('and each is a plausible lap of a 2.5 km circuit',
       secs.every(s => s > 55 && s < 130), secs.map(s => s.toFixed(1)).join(', ') + ' s');
    /* Every lap must be about the same length — a mis-cut lap shows up here
       before it poisons every corner reading downstream. */
    const spread = Math.max.apply(null, secs) - Math.min.apply(null, secs);
    ok('they are all the same lap', spread < 25, 'spread ' + spread.toFixed(1) + ' s');
}

head('The angle engine finds its source and calibrates');
{
    const src = API.gpDriftSource();
    ok('the yaw channel is picked up on its units alone', !!src && src.kind === 'yawrate',
       src ? src.name + ' (' + src.unit + ')' : 'none');
    const d = API.gpDriftAngle();
    ok('an angle comes back', !!d);
    ok('it is derived, not passed through', d && !d.direct);
    /* The generator's gyro carries a 1.008 scale error and a 0.42 deg/s zero.
       The fit has to find both from the session's own grip driving. */
    ok('the scale is fitted close to the truth', d && Math.abs(d.scale - 1.008) < 0.02,
       d ? 'fitted ' + d.scale.toFixed(4) + ' against 1.0080' : '');
    ok('and the zero with it', d && Math.abs(d.bias - 0.42) < 0.5,
       d ? 'fitted ' + d.bias.toFixed(3) + ' deg/s against 0.420' : '');
    ok('it found straights to anchor on', d && d.anchors > 3, d ? d.anchors + ' anchors' : '');
}

head('Corners: found once, and the same corner on every lap');
{
    const cs = API.gpDriftCorners();
    ok('a corner set is built', !!cs && cs.corners.length > 0,
       cs ? cs.corners.length + ' corners on lap ' + (cs.refLap + 1) : 'none');
    if (cs) {
        /* The generator planted a drift at every corner it found from the
           curvature. The property that matters is COVERAGE: the app must not
           MISS corners, or a whole piece of the track goes unassessed. The
           reverse is not required — the app finds corners from SPEED, so it
           legitimately also finds fast kinks the curvature threshold skipped,
           and those simply rate low because nothing was drifted there. */
        let covered = 0;
        truth.corners.forEach(t => {
            let best = 1e9;
            cs.corners.forEach(c => {
                const d = distToPlanted({ lat: c.lat, lon: c.lon }, t);
                if (d < best) best = d;
            });
            if (best < 70) covered++;
        });
        ok('it finds nearly every corner that was planted', covered >= truth.corners.length - 1,
           covered + '/' + truth.corners.length + ' planted corners covered');

        /* The point of finding them once: the same corner index must mean the
           same piece of tarmac on every lap. */
        let stable = true, drove = 0, total = 0;
        cs.corners.forEach((c, ci) => {
            cs.per.forEach((lapCells, li) => {
                const cell = lapCells[ci];
                total++;
                if (!cell) return;
                drove++;
                const d = API.gpMetres(gp.trace[cell.apex], { lat: c.lat, lon: c.lon });
                if (d > 60) stable = false;
            });
        });
        ok('and it lands on the same tarmac every lap', stable);
        ok('nearly every corner is read on nearly every lap', drove / total > 0.9,
           drove + ' of ' + total + ' corner-laps read');
    }
}

head('What the app read, against what was planted');
{
    const b = API.gpDriftBoard();
    ok('the board builds', !!b);
    if (b) {
        /* Match each app corner to the planted corner nearest it, then compare
           the angle the app says was held against the angle that was put
           there. The tolerance is the engine's OWN error bar plus the fact
           that the two corner definitions do not start and stop in exactly the
           same place — so this is checking honesty, not identity. */
        let worstErr = 0, checked = 0, inBar = 0, rated = 0, roughRated = 0, total = 0;
        b.corners.forEach((c, ci) => {
            let t = null, bd = 1e9;
            truth.corners.forEach(tc => {
                const d = distToPlanted({ lat: c.lat, lon: c.lon }, tc);
                if (d < bd) { bd = d; t = tc; }
            });
            b.cells.forEach((lapCells, li) => {
                const cell = lapCells[ci];
                if (!cell) return;
                total++;
                if (cell.rating) rated++;
                /* The gate must be absolute: a corner whose angle did not
                   close is never rated, no matter how good the driving looked. */
                if (cell.angle && cell.angle.rough && cell.rating) roughRated++;
                /* Compare only where the app's corner and the planted one are
                   plainly the same piece of track. A detector working from
                   SPEED sometimes wraps two planted corners into one sweep;
                   its mean angle is then the mean of two different drifts, and
                   holding that against either one's number is a comparison
                   between two things that were never the same thing. */
                if (!t || bd > 40) return;
                /* Only where the app says there WAS a drift. A long sweeper's
                   two ends are corners in their own right to a speed-based
                   detector, and nothing was drifted there — holding the app's
                   honest "no drift here" against the sweeper's planted angle
                   would be marking it wrong for being right. */
                if (!cell.angle || cell.angle.rough || !cell.rating) return;
                /* app lap k was driven with character k + firstBoardLapCharacter
                   — the generator writes that mapping down so this never has
                   to guess it. */
                const ch = t.per[li + (truth.firstBoardLapCharacter || 0)];
                const planted = ch && ch.held;
                if (!planted) return;
                checked++;
                const err = Math.abs(cell.angle.held - planted);
                if (err > worstErr) worstErr = err;
                if (err <= cell.angle.conf + 8) inBar++;
            });
        });
        ok('a good number of corner-laps were rated', rated > 30,
           rated + ' of ' + total + ' corner-laps rated');
        ok('a corner whose angle did not close is NEVER rated', roughRated === 0);
        ok('the angle read is the angle planted, within the error bar',
           checked > 25 && inBar / checked > 0.9,
           checked + ' checked, ' + (100 * inBar / Math.max(1, checked)).toFixed(0) +
           '% inside, worst gap ' + worstErr.toFixed(1) + ' deg');

        /* The whole point of the view: every corner that anyone drifted must
           name the lap that did it best. */
        let namable = 0, named = 0;
        b.corners.forEach((c, ci) => {
            const any = b.cells.some(lc => lc[ci] && lc[ci].rating);
            if (!any) return;
            namable++;
            if (b.best[ci] >= 0) named++;
        });
        ok('every rated corner names a best lap', named === namable, named + '/' + namable);
        /* ...and the named lap really is the best one there. */
        let bestRight = true;
        b.corners.forEach((c, ci) => {
            if (b.best[ci] < 0) return;
            const mine = b.cells[b.best[ci]][ci].rating.score;
            b.cells.forEach(lc => {
                if (lc[ci] && lc[ci].rating && lc[ci].rating.score > mine + 1e-9) bestRight = false;
            });
        });
        ok('and it really is the best lap at that corner', bestRight);
        /* The bests must be SPREAD. If one lap owned every corner the view
           would have nothing to say that a single lap time does not. */
        const owners = {};
        b.best.forEach(x => { if (x >= 0) owners[x] = 1; });
        ok('different laps own different corners', Object.keys(owners).length >= 2,
           Object.keys(owners).length + ' laps own at least one corner');

        const avg = b.lapAvg.map(a => a ? a.stars : null);
        ok('every lap gets an average', avg.every(a => a !== null),
           avg.map(a => a === null ? '-' : a.toFixed(2)).join(', '));
        if (avg.every(a => a !== null)) {
            const worstLap = avg.indexOf(Math.min.apply(null, avg));
            const bestLap = avg.indexOf(Math.max.apply(null, avg));
            ok('the worst lap rates below the best lap', avg[worstLap] < avg[bestLap],
               'lap ' + (worstLap + 1) + ' at ' + avg[worstLap].toFixed(2) +
               ' against lap ' + (bestLap + 1) + ' at ' + avg[bestLap].toFixed(2));
            ok('and the spread is big enough to be worth reading',
               avg[bestLap] - avg[worstLap] > 0.25,
               (avg[bestLap] - avg[worstLap]).toFixed(2) + ' stars between them');
            ok('gpDriftBest names the top-rated lap',
               API.gpDriftBest() === avg.indexOf(Math.max.apply(null, avg)));
        }

        let sane = true;
        b.cells.forEach(lc => lc.forEach(r => {
            if (!r || !r.rating) return;
            const rt = r.rating;
            if (rt.stars < 0 || rt.stars > 5) sane = false;
            if ((rt.stars * 10) % 5 !== 0) sane = false;
            if (rt.ver !== K.GP_DRIFT_SCORE_VER) sane = false;
            ['angle', 'commit', 'steady', 'speed'].forEach(p => {
                if (!(rt.parts[p] >= 0 && rt.parts[p] <= 1)) sane = false;
            });
        }));
        ok('every rating is on the scale it claims to be on', sane);
    }
}

head('The corner the generator sabotaged');
{
    /* One character drops the drift at one corner (amp x0.42). It must come
       back visibly worse THERE than the same lap's other corners, or the
       per-corner reading is not per-corner at all. */
    const b = API.gpDriftBoard();
    const FIRST = truth.firstBoardLapCharacter || 0;
    /* Which (corner, character) pair did the generator deliberately drop?
       Measured against that character's OWN other corners — comparing across
       characters just finds the out lap, which is uniformly gentle rather
       than specifically sabotaged. */
    let sabCorner = null, sabChar = -1, sabRatio = 1;
    const nChar = truth.corners[0].per.length;
    for (let ch = 0; ch < nChar; ch++) {
        const held = truth.corners.map(c => c.per[ch].held);
        const mean = held.reduce((a, x) => a + x, 0) / held.length;
        truth.corners.forEach((c, k) => {
            const r = held[k] / mean;
            if (r < 0.7 && r < sabRatio) { sabRatio = r; sabCorner = c; sabChar = ch; }
        });
    }
    ok('the fixture really does sabotage one corner', !!sabCorner,
       sabCorner ? 'planted T' + sabCorner.corner + ' on character ' + (sabChar + 1) +
                   ' at ' + (100 * sabRatio).toFixed(0) + '% of that lap own average' : 'none');
    if (b && sabCorner) {
        let ci = -1, bd = 1e9;
        b.corners.forEach((c, k) => {
            const d = distToPlanted({ lat: c.lat, lon: c.lon }, sabCorner);
            if (d < bd) { bd = d; ci = k; }
        });
        const li = sabChar - FIRST;                 /* character -> app lap */
        const cell = li >= 0 && b.cells[li] ? b.cells[li][ci] : null;
        const others = (b.cells[li] || []).filter((r, k) => k !== ci && r && r.rating)
                                          .map(r => r.rating.stars);
        if (cell && cell.rating && others.length) {
            const mean = others.reduce((a, x) => a + x, 0) / others.length;
            ok('and the app rates that corner below the rest of the same lap',
               cell.rating.stars < mean,
               'T' + b.corners[ci].n + ' on lap ' + (li + 1) + ' at ' + cell.rating.stars.toFixed(1) +
               ' against ' + mean.toFixed(1) + ' elsewhere');
            /* ...and the best lap for that corner must NOT be the sabotaged one. */
            ok('and does not call it the best lap for that corner', b.best[ci] !== li,
               'best is lap ' + (b.best[ci] + 1));
        } else {
            ok('and the app rates that corner below the rest of the same lap', false,
               'no rating for the sabotaged corner (matched ' + bd.toFixed(0) + ' m away)');
        }
    }
}

head('Nothing is invented when the sensor is taken away');
{
    const saved = gp.traceChanIds;
    gp.traceChanIds = [];
    gp.trace.forEach(r => { r.can = null; });
    API.gpDriftForget();
    const d = API.gpDriftAngle();
    ok('with no yaw channel there is no angle at all', d === null);
    const b = API.gpDriftBoard();
    ok('the corners are still found — they are path geometry', !!b && b.corners.length > 0);
    let anyStars = false;
    if (b) b.cells.forEach(lc => lc.forEach(r => { if (r && r.rating) anyStars = true; }));
    ok('but not one corner is rated', !anyStars);
    ok('and no lap claims an average', !!b && b.lapAvg.every(a => a === null));
    gp.traceChanIds = saved;
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'passed all ' + pass) + ' checks');
process.exit(fail ? 1 : 0);
