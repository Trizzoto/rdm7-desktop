/* The map, with nothing loaded.
 *
 * Analyse with no recording open was four panels each saying a version of
 * "nothing here", and the largest of them said it by showing anonymous
 * farmland. Counting the graph's "no recording loaded", two panels printing
 * the identical sentence and six em-dashes across the transport, the screen
 * said NOTHING about ten times and said what to do next zero times — while
 * seven recordings sat one click away.
 *
 * So the map draws the one thing it already knows: every circuit you have
 * driven, with how many recordings are on it and your best lap there. Nothing
 * is invented — ADR-0011 still forbids a demo trace — this is the track
 * library and the session store, drawn instead of hidden.
 *
 * What has to hold:
 *   - a track with no geometry at all is SKIPPED, never dropped at 0,0
 *   - recordings match by id, and by name for anything older than the library
 *   - the shipped synthetic fixture never becomes your personal best
 *   - most recently driven first, because that is the one worth finding
 *   - and it takes itself down the moment a recording is open
 *
 *   node tools/check_mapempty.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

function grabFrom(src, name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' +
                          name + ' = function)', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j).replace(/^\s*window\.(\w+) = function/, 'function $1');
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const WANT = ['gpN', 'gpMetres', 'gpTrackOverviewRows', 'gpTrackOverviewNear'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

const parts = [], missing = [];
for (const n of WANT) { try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); } }

const F = new Function(`
    var gp = { tracks: null, sessions: [] };
    /* The library is already loaded in every path that reaches this. */
    function gpTracksReady() { return gp.tracks; }
    var GP_TRACK_NEAR_M = ${/var GP_TRACK_NEAR_M = (\d+)/.exec(src)[1]};
    ${parts.join('\n')}
    return { gp: gp, rows: gpTrackOverviewRows, near: gpTrackOverviewNear,
             NEAR_M: GP_TRACK_NEAR_M };
`)();

ok('every function under test was found', missing.length === 0, 'missing: ' + missing.join(', '));

const lib = (tracks) => { F.gp.tracks = { version: 1, tracks: tracks }; };
const RING = [[-35.30, 139.51], [-35.31, 139.52], [-35.30, 139.53], [-35.30, 139.51]];

/* ── where a pill goes ────────────────────────────────────────────────── */
console.log('\nwhere each circuit is placed');
{
    F.gp.sessions = [];

    lib([{ id: 'a', name: 'A', start_finish: { lat: -35.1, lon: 139.1 },
           outline: { pts: RING }, center: [1, 1] }]);
    let r = F.rows()[0];
    ok('the timing line wins when there is one', near(r.at[0], -35.1) && near(r.at[1], 139.1),
       JSON.stringify(r.at));

    lib([{ id: 'b', name: 'B', outline: { pts: RING }, center: [1, 1] }]);
    r = F.rows()[0];
    ok('otherwise the middle of the shape', r.at[0] < -35.29 && r.at[0] > -35.31,
       JSON.stringify(r.at));
    ok('and the shape itself is carried through', r.pts && r.pts.length === RING.length);

    lib([{ id: 'c', name: 'C', center: [-34.9, 138.6] }]);
    r = F.rows()[0];
    ok('and the saved view as a last resort', near(r.at[0], -34.9), JSON.stringify(r.at));
    ok('with no shape to draw', r.pts === null);

    /* The one that matters: a track with nothing to place it by must not be
       drawn at all. Falling back to [0,0] would put a pill in the Atlantic
       with the user's own circuit name on it — the same null-island failure
       the live map's fix guard exists to prevent. */
    lib([{ id: 'd', name: 'D' }, { id: 'e', name: 'E', center: [-34.9, 138.6] }]);
    ok('a track with no position at all is skipped, not placed at 0,0',
       F.rows().length === 1 && F.rows()[0].t.id === 'e',
       JSON.stringify(F.rows().map(x => x.t.id)));

    lib([{ id: 'f', name: 'F', start_finish: { lat: null, lon: null }, center: [-34.9, 138.6] }]);
    ok('a broken timing line falls through rather than poisoning the pill',
       near(F.rows()[0].at[0], -34.9), JSON.stringify(F.rows()[0].at));

    lib([{ id: 'g', name: 'G', outline: { pts: [[1, 1], [2, 2]] }, center: [-34.9, 138.6] }]);
    ok('an outline too short to be a shape is not drawn as one',
       F.rows()[0].pts === null);

    lib([null, { id: 'h', name: 'H', center: [1, 2] }]);
    ok('a hole in the library does not take the map down', F.rows().length === 1);

    lib([]);
    ok('an empty library is an empty list, not an error', F.rows().length === 0);
}

/* ── what each pill says ──────────────────────────────────────────────── */
console.log('\nwhat it says about each circuit');
{
    lib([{ id: 'trk_mb', name: 'Mount Barker Time Trial', center: [-35.07, 138.86] },
         { id: 'trk_wt', name: 'Winton', center: [-36.53, 146.09] }]);
    F.gp.sessions = [
        { id: 's1', trackId: 'trk_mb', trackName: 'Mount Barker Time Trial',
          bestLapS: 84.2, recordedAt: 3000, device: 'RDM GPS' },
        { id: 's2', trackId: 'trk_mb', trackName: 'Mount Barker Time Trial',
          bestLapS: 83.1, recordedAt: 5000, device: 'RDM GPS' },
        /* Older than the library: carries the name, not the id. */
        { id: 's3', trackId: null, trackName: 'Mount Barker Time Trial',
          bestLapS: 88.0, recordedAt: 1000, device: 'RDM GPS' },
        { id: 's4', trackId: 'trk_wt', trackName: 'Winton',
          bestLapS: 60.0, recordedAt: 2000, device: 'synthetic' },
    ];
    const by = {};
    F.rows().forEach(r => { by[r.t.id] = r; });

    ok('recordings are counted per circuit', by.trk_mb.n === 3, by.trk_mb.n);
    ok('including one matched by NAME, from before the library had the track',
       by.trk_mb.n === 3, 'id-only matching would give 2');
    ok('the best lap is the best of them', near(by.trk_mb.best, 83.1), by.trk_mb.best);
    ok('and it is the LAST session that dates the circuit', by.trk_mb.last === 5000);

    /* The fixture that ships for testing compare/coach is a lap nobody drove.
       It winning a personal best is the exact fault the sessions rail already
       had to fix, and on the map it would be worse — printed on the circuit,
       looking like something you did. */
    ok('a synthetic fixture never becomes your best lap', by.trk_wt.best === null,
       String(by.trk_wt.best));
    ok('but it still counts as a recording that exists there', by.trk_wt.n === 1);

    /* Most recent first: it decides which circuit wears the accent. */
    ok('most recently driven comes first',
       F.rows()[0].t.id === 'trk_mb', F.rows().map(r => r.t.id).join(','));

    F.gp.sessions = [];
    ok('a circuit with no recordings is still shown', F.rows().length === 2);
    ok('with nothing to claim about it', F.rows()[0].best === null && F.rows()[0].n === 0);
    ok('and no date, so nothing gets marked as "where you were last"',
       F.rows().every(r => !r.last));
}

/* ── one pill per circuit ─────────────────────────────────────────────── */
console.log('\none pill per circuit, not per library row');
{
    /* Found live: his library holds "The Bend GT" three times and "Mallala"
       twice, adopted more than once over the months. Three identical pills
       stacked on one point — and worse, both rows matched the same recordings
       BY NAME, so each of them claimed the whole count. */
    F.gp.sessions = [
        { id: 's1', trackId: 'x1', trackName: 'The Bend GT', bestLapS: 100, recordedAt: 9, device: 'RDM GPS' },
    ];
    lib([{ id: 'x1', name: 'The Bend GT', center: [-35.02, 139.29] },
         { id: 'x2', name: 'The Bend GT', center: [-35.02, 139.29] },
         { id: 'x3', name: 'the bend gt', center: [-35.02, 139.29] }]);
    let r = F.rows();
    ok('three copies of one circuit draw one pill', r.length === 1, r.length + ' pills');
    ok('and its count is not multiplied by the duplicates', r[0].n === 1, r[0].n);

    /* Which copy survives: the one that can draw a shape. */
    lib([{ id: 'y1', name: 'Mallala', center: [-34.71, 138.50] },
         { id: 'y2', name: 'Mallala', center: [-34.71, 138.50], outline: { pts: RING } }]);
    F.gp.sessions = [];
    r = F.rows();
    ok('the copy that has a shape is the one kept', r.length === 1 && r[0].t.id === 'y2',
       r.map(x => x.t.id).join(','));

    /* Two genuinely different circuits are not merged. */
    lib([{ id: 'z1', name: 'Mallala', center: [-34.71, 138.50] },
         { id: 'z2', name: 'Winton', center: [-36.53, 146.09] }]);
    ok('different names stay separate', F.rows().length === 2);

    /* A row with no name at all cannot be deduped by name and must survive. */
    lib([{ id: 'n1', center: [1, 1] }, { id: 'n2', center: [2, 2] }]);
    ok('unnamed rows are not all collapsed into one', F.rows().length === 2);
}

/* ── what to frame ────────────────────────────────────────────────────── */
console.log('\nwhich circuits the map opens on');
{
    /* Found live: fitting ALL of them gave a view of the whole planet
       centred in Chad at 11.5N 21.1E, with eleven pills piled into one
       smudge — because the library spans South Australia, Donington and
       Colorado. */
    F.gp.sessions = [
        { id: 'a', trackId: 'mb', trackName: 'MB', bestLapS: 80, recordedAt: 9000, device: 'RDM GPS' },
        { id: 'b', trackId: 'dn', trackName: 'DN', bestLapS: 80, recordedAt: 1000, device: 'RDM GPS' },
    ];
    lib([{ id: 'mb', name: 'MB', center: [-35.07, 138.86] },      /* Mount Barker */
         { id: 'ml', name: 'ML', center: [-34.71, 138.50] },      /* Mallala, ~45 km */
         { id: 'tb', name: 'TB', center: [-35.02, 139.29] },      /* The Bend, ~40 km */
         { id: 'dn', name: 'DN', center: [52.83, -1.38] },        /* Donington */
         { id: 'hp', name: 'HP', center: [39.76, -104.06] }]);    /* High Plains */

    const rows = F.rows();
    ok('the most recently driven circuit leads', rows[0].t.id === 'mb',
       rows.map(r => r.t.id).join(','));
    const near = F.near(rows);
    ok('the frame is the circuits near it', near.length === 3,
       near.map(r => r.t.id).join(','));
    ok('and it does not reach across an ocean',
       near.every(r => ['mb', 'ml', 'tb'].indexOf(r.t.id) >= 0),
       near.map(r => r.t.id).join(','));
    ok('but the far ones are still in the list, so they are still drawn',
       rows.length === 5);
    ok('the threshold is a day\'s drive, not a continent',
       F.NEAR_M >= 100000 && F.NEAR_M <= 1500000, F.NEAR_M + ' m');

    /* One circuit in the world frames itself. */
    lib([{ id: 'only', name: 'Only', center: [-35.07, 138.86] }]);
    ok('a single circuit frames itself', F.near(F.rows()).length === 1);
    ok('and an empty library frames nothing without throwing',
       (lib([]), F.near(F.rows()).length) === 0);
}

/* ── it has to take itself down ───────────────────────────────────────── */
console.log('\nand it is only ever there when nothing is open');
{
    const draw = grabFrom(src, 'gpDrawTrackOverview');
    ok('it is scoped to Analyse', /gp\.view === "session"/.test(draw),
       'Tracks has its own editor on this map and Drift is reading a recording');
    ok('and to having no recording open', /!\(gp\.trace && gp\.trace\.length\)/.test(draw));
    const wantAt = draw.indexOf('var want');
    const removeAt = draw.indexOf('removeLayer');
    ok('the not-wanted path REMOVES the layer rather than just skipping',
       wantAt >= 0 && removeAt > wantAt && removeAt < draw.indexOf('gpTrackOverviewRows'),
       'a layer that is only ever added stays painted over the recording you ' +
       'then open — the same fault the drift shapes had');

    const trace = grabFrom(src, 'gpDrawTrace');
    const callAt = trace.indexOf('gpDrawTrackOverview()');
    ok('gpDrawTrace calls it', callAt > 0);
    ok('BEFORE its early returns, so every exit path can take it down',
       callAt >= 0 && callAt < trace.indexOf('cv.setStrands([])'),
       'called after the guard, it can never clear itself');

    ok('the fit happens once, not on every draw',
       /!gp\._ovFit && bounds\.length/.test(draw),
       'refitting would fight a pan and make the map unusable to look around in');
    /* Found live: zoom came back as exactly maxZoom BOTH times — once for
       three circuits 45 km apart and once for a set spanning three
       continents. The same answer for two bounds that share nothing is what a
       measurement taken before the box exists looks like. gpDrawTrace runs
       while the Analyse grid is still being laid out, and fitBounds on a
       zero-size map returns the cap whatever you hand it. */
    ok('and it waits until the map has a box to fit into',
       /getSize/.test(draw) && /sz\.x > \d+ && sz\.y > \d+/.test(draw),
       'fitBounds on a zero-size map returns maxZoom for any bounds at all');
    ok('and it only counts as fitted once it actually fitted',
       draw.indexOf('gp._ovFit = true') > draw.indexOf('fitBounds'),
       'stamping before the fit means a fit that never happened is never retried');

    /* Found in a screenshot, which is the only thing that could have found it:
       Mount Barker and The Bend are forty kilometres apart and a few pixels
       apart at the zoom that frames both, so one pill sat squarely over the
       other's name. That reads as a rendering fault rather than a crowded
       map. */
    const fit = grabFrom(src, 'gpTrackPillsFit');
    ok('pills that would overlap are placed, not just drawn',
       /getBoundingClientRect/.test(fit) && /clashes\(/.test(fit));
    ok('every corner of its own point is tried before it gives up',
       /\["", "flip", "below", "flip below"\]/.test(fit) &&
       fit.indexOf('spots') < fit.indexOf('display = "none"'),
       'hiding a label before trying to move it throws away a name for nothing');
    /* Two positions was not enough on his own data: The Bend flipped left and
       landed on Mount Barker anyway, because they are side by side. It needed
       to go below. */
    ok('including below the point, which is what the side-by-side pair needs',
       /below/.test(fit) && /\.gpb-trackpill\.below/.test(src));
    ok('and moving a label does not cost it its accent',
       /gpb-trackdot/.test(fit) && /lead\(el\)/.test(fit),
       'rebuilding the class list to reposition would drop `lead` silently');
    ok('a stood-down pill still keeps its point marked',
       /gpb-trackdot/.test(draw) && !/trackpill::before/.test(src),
       'a dot drawn as a pseudo-element of the pill vanishes with it, and the ' +
       'circuit disappears from the map entirely');
    ok('and is still named on hover', /bindTooltip/.test(draw));
    ok('priority is the order the rows came in, so the recent one never loses',
       fit.indexOf('marks.forEach') > 0 && !/sort/.test(fit));
    ok('and it runs again when the map moves',
       /zoomend/.test(draw) && /moveend/.test(draw),
       'a placement solved at one zoom is wrong at the next');

    const jump = grabFrom(src, 'gpTrackJump');
    ok('clicking a circuit OFFERS its recordings rather than opening one',
       /sessFilter\.track/.test(jump) && /gpSetView\("sessions"\)/.test(jump),
       'auto-opening was explicitly not what was asked for');
    ok('and it does not load a trace', !/gpSessOpen/.test(jump));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
