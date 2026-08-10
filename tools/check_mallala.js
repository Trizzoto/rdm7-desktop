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
    'gpDriftLinkMap', 'gpDriftUnits',
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
gp.driftSrcPref = null; gp.driftUnit = 0;
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

head('Corners driven as one drift are linked, and rated as one');
{
    const b = API.gpDriftBoard();
    ok('the board builds', !!b);
    ok('some corners were linked', b && b.units.some(u => u.linked),
       b ? b.units.map(u => u.name).join(' | ') : '');
    if (b) {
        /* A link must be a RUN of consecutive corners, and every corner must
           belong to exactly one unit — a corner that fell out of the grouping
           would silently stop being assessed. */
        let seen = [], consecutive = true;
        b.units.forEach(u => {
            u.members.forEach((m, k) => {
                seen.push(m);
                if (k && m !== u.members[k - 1] + 1) consecutive = false;
            });
        });
        seen.sort((x, y) => x - y);
        ok('every corner belongs to exactly one unit',
           seen.length === b.corners.length && seen.every((v, i) => v === i),
           seen.length + ' of ' + b.corners.length);
        ok('and a link is always consecutive corners', consecutive);

        /* The fixture links the final complex on most laps. The app must have
           noticed at least one multi-corner unit there. */
        const linked = b.units.filter(u => u.linked);
        ok('a linked unit spans more than one corner',
           linked.length > 0 && linked.every(u => u.members.length >= 2),
           linked.map(u => u.name + ' (' + u.members.length + ')').join(', '));

        /* Inside a link every member is still read on its own, or the driver
           cannot tell WHICH corner of it was the weak one. */
        let members = 0, withAngle = 0;
        b.cells.forEach(lr => lr.forEach((r, ui) => {
            if (!r || !b.units[ui].linked || !r.members) return;
            r.members.forEach(m => { if (m) { members++; if (m.angle) withAngle++; } });
        }));
        ok('each corner inside a link is still read on its own',
           members > 0 && withAngle > 0, withAngle + ' of ' + members + ' member reads carry an angle');
    }
}

head('What the app read, against what was planted');
{
    const b = API.gpDriftBoard();
    const FIRST = truth.firstBoardLapCharacter || 0;
    /* Match a single-corner unit to the planted corner it sits on, tightly. A
       linked unit spans several planted corners and its mean angle is the mean
       of several drifts, so it is checked through its MEMBERS instead. */
    const plantedFor = (lat, lon) => {
        let t = null, bd = 1e9;
        truth.corners.forEach(tc => {
            const d = distToPlanted({ lat, lon }, tc);
            if (d < bd) { bd = d; t = tc; }
        });
        return { t, d: bd };
    };

    let checked = 0, inBar = 0, worst = 0, rated = 0, total = 0, roughRated = 0;
    b.units.forEach((u, ui) => {
        b.cells.forEach((lr, li) => {
            const cell = lr[ui];
            if (!cell) return;
            total++;
            if (cell.rating) rated++;
            if (cell.angle && cell.angle.rough && cell.rating) roughRated++;
            if (!cell.angle || cell.angle.rough || !cell.rating) return;
            /* single corners: the unit itself. linked: each member. */
            const probes = u.linked && cell.members
                ? cell.members.filter(Boolean).map(m => ({ lat: gp.trace[m.apex].lat,
                                                           lon: gp.trace[m.apex].lon, a: m.angle }))
                : [{ lat: b.corners[u.members[0]].lat, lon: b.corners[u.members[0]].lon, a: cell.angle }];
            probes.forEach(pr => {
                if (!pr.a || pr.a.rough) return;
                const { t, d } = plantedFor(pr.lat, pr.lon);
                if (!t || d > 40) return;
                const ch = t.per[li + FIRST];
                if (!ch || !ch.held) return;
                checked++;
                const err = Math.abs(pr.a.held - ch.held);
                if (err > worst) worst = err;
                if (err <= pr.a.conf + 8) inBar++;
            });
        });
    });
    ok('a good number of unit-laps were rated', rated > 25, rated + ' of ' + total);
    ok('a stretch whose angle did not close is NEVER rated', roughRated === 0);
    ok('the angle read is the angle planted, within the error bar',
       checked > 25 && inBar / checked > 0.9,
       checked + ' checked, ' + (100 * inBar / Math.max(1, checked)).toFixed(0) +
       '% inside, worst gap ' + worst.toFixed(1) + ' deg');

    let namable = 0, named = 0, bestRight = true;
    b.units.forEach((u, ui) => {
        const any = b.cells.some(lr => lr[ui] && lr[ui].rating);
        if (!any) return;
        namable++;
        if (b.best[ui] >= 0) named++;
        if (b.best[ui] < 0) return;
        const mine = b.cells[b.best[ui]][ui].rating.score;
        b.cells.forEach(lr => {
            if (lr[ui] && lr[ui].rating && lr[ui].rating.score > mine + 1e-9) bestRight = false;
        });
    });
    ok('every rated unit names a best lap', named === namable, named + '/' + namable);
    ok('and it really is the best lap there', bestRight);

    const owners = {};
    b.best.forEach(x => { if (x >= 0) owners[x] = 1; });
    ok('different laps own different corners', Object.keys(owners).length >= 2,
       Object.keys(owners).length + ' laps own at least one');

    const avg = b.lapAvg.map(a => a ? a.stars : null);
    ok('every lap gets an average', avg.every(a => a !== null),
       avg.map(a => a === null ? '-' : a.toFixed(2)).join(', '));
    if (avg.every(a => a !== null)) {
        const lo = avg.indexOf(Math.min.apply(null, avg));
        const hi = avg.indexOf(Math.max.apply(null, avg));
        ok('the worst lap rates below the best lap', avg[lo] < avg[hi],
           'lap ' + (lo + 1) + ' at ' + avg[lo].toFixed(2) + ' against lap ' + (hi + 1) +
           ' at ' + avg[hi].toFixed(2));
        ok('and the spread is big enough to be worth reading', avg[hi] - avg[lo] > 0.25,
           (avg[hi] - avg[lo]).toFixed(2) + ' stars between them');
        ok('gpDriftBest names the top-rated lap', API.gpDriftBest() === hi);
    }

    let sane = true;
    b.cells.forEach(lr => lr.forEach(r => {
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

head('The lap that broke the link');
{
    /* One character straightens between two corners of the complex instead of
       linking them. Everything else about that lap is unchanged, so if the
       link means anything at all, that lap must score worse on COMMITMENT for
       the unit containing those corners — and only for that unit. */
    const b = API.gpDriftBoard();
    const FIRST = truth.firstBoardLapCharacter || 0;
    const bl = truth.brokeLink;
    ok('the fixture really does break a link', !!bl,
       bl ? 'character ' + (bl.character + 1) + ' between planted T' +
            bl.betweenCorners[0] + ' and T' + bl.betweenCorners[1] : 'none');
    if (b && bl) {
        const li = bl.character - FIRST;
        /* which planted corners are either side of the break */
        const t0 = truth.corners[bl.betweenCorners[0] - 1];
        const t1 = truth.corners[bl.betweenCorners[1] - 1];
        /* the unit covering them */
        let ui = -1;
        b.units.forEach((u, k) => {
            const hits = u.members.filter(m => {
                const c = b.corners[m];
                return distToPlanted({ lat: c.lat, lon: c.lon }, t0) < 60 ||
                       distToPlanted({ lat: c.lat, lon: c.lon }, t1) < 60;
            });
            if (hits.length >= 2) ui = k;
        });
        ok('both corners of the break sit in one linked unit', ui >= 0 && b.units[ui].linked,
           ui >= 0 ? b.units[ui].name : 'not found');
        if (ui >= 0 && li >= 0 && b.cells[li] && b.cells[li][ui]) {
            const mine = b.cells[li][ui];
            const others = b.cells.map((lr, k) => k === li ? null : lr[ui])
                                  .filter(r => r && r.rating);
            const meanCommit = others.reduce((a, r) => a + r.commit, 0) / Math.max(1, others.length);
            ok('the lap that straightened is less committed through the link',
               mine.commit < meanCommit,
               (100 * mine.commit).toFixed(0) + '% against ' + (100 * meanCommit).toFixed(0) +
               '% on the laps that linked it');
            /* ...and it must NOT be the best lap there, however much angle it
               carried elsewhere. */
            ok('and is not named the best lap through it', b.best[ui] !== li,
               'best is lap ' + (b.best[ui] + 1));
        } else {
            ok('the lap that straightened is less committed through the link', false, 'no cell');
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
