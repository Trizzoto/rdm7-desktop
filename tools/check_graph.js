/* Does the graph draw what its key says it draws, and does the window
 * follow the playhead?
 *
 * Two bugs this locks down, both reported from the car:
 *
 *   1. Colours that matched nothing. A single ticked lap drew a
 *      lap-coloured line under a key reading "colour = channel"; the
 *      analysed lap was drawn whether or not it was ticked and never
 *      appeared in the key at all; Combined listed laps it has never
 *      drawn; and ticked laps were drawn against the WHOLE SESSION, whose
 *      x-axis they cannot be lined up against. Every one of those is one
 *      surface disagreeing with another, so the test is the agreement:
 *      gpGraphLines is the single answer and the key is generated from it.
 *
 *   2. The window that would not move. Zoomed into a corner, pressing
 *      play left the window where it was — a second later the playhead was
 *      past the right-hand edge and stopped being drawn at all.
 *
 * Same extraction trick as check_autotrack: the real functions are pulled
 * out of src/tauri-overlay.html, never copied.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'tauri-overlay.html');
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
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
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    let i = src.indexOf('=', m.index) + 1, depth = 0, j = i;
    for (; j < src.length; j++) {
        const c = src[j];
        if (c === '[' || c === '{' || c === '(') depth++;
        else if (c === ']' || c === '}' || c === ')') depth--;
        else if (c === ';' && depth === 0) { j++; break; }
    }
    return src.slice(m.index, j);
}
/* gpPanelGraphLegendHtml is the key itself. It is grabbed whole so the test
   reads the rendered key rather than a description of it — the mismatch
   being tested for is exactly the kind a re-description would hide. */

const NEEDED_FN = ['gpShownLaps', 'gpShownList', 'gpGraphLines', 'gpGraphLinesSig',
    'gpGraphLeftOff', 'gpLapRole', 'gpLapColourOn', 'gpLapColour', 'gpMapLapColour', 'gpRunWord', 'gpIsTrial', 'gpActiveTrack', 'gpTrackById',
    'gpLapRange', 'gpStripRange', 'gpStripFollow', 'gpSecs', 'gpSpanSecs', 'gpLapTime', 'gpEsc', 'gpN',
    'gpPanelGraphLegendHtml'];
/* GP_FOLLOW_EDGE and GP_FOLLOW_STEP share one `var` statement, so grabbing
   the first brings the second with it. */
const NEEDED_VAR = ['GP_LAP_COLOURS', 'GP_ROLE_SUBJECT_LIGHT', 'GP_ROLE_SUBJECT_DARK', 'GP_ROLE_REF_LIGHT', 'GP_ROLE_REF_DARK', 'GP_FOLLOW_EDGE', 'GP_MAX_STEP_S'];

let code = '';
NEEDED_VAR.forEach(v => { code += grabVar(v) + '\n'; });
NEEDED_FN.forEach(f => { code += grab(f) + '\n'; });

global.gp = null;
global.localStorage = { getItem: () => null, setItem: () => {} };
const api = new Function(code + '\n; return {' + NEEDED_FN.concat(NEEDED_VAR).join(',') + '};')();
const { gpShownLaps, gpShownList, gpGraphLines, gpGraphLinesSig, gpGraphLeftOff,
        gpLapColour, gpStripRange, gpStripFollow, gpPanelGraphLegendHtml } = api;

/* ---- a recording: four laps of 400 samples at 25 Hz, then a cool-down --- */
const LAPS = [{ from: 0, to: 399 }, { from: 400, to: 799 },
              { from: 800, to: 1199 }, { from: 1200, to: 1599 }];
const TRACE = [];
for (let i = 0; i < 1800; i++) TRACE.push({ lat: 0, lon: 0, kph: 100, hdg: 0, g: 0, t: i * 40 });

function fresh(over) {
    global.gp = {
        trace: TRACE, traceLaps: LAPS, ghostFence: null,
        selLap: 1, cmpLap: 0, shownLaps: null,
        plotMode: over ? 'over' : 'tiled',
        stripZoom: null, playIdx: 0, playing: false,
        tracks: null, sessionId: null
    };
    return global.gp;
}

let pass = 0, fail = 0;
function ok(what, cond, saw) {
    if (cond) { pass++; return; }
    fail++;
    console.log('  FAIL  ' + what + (saw === undefined ? '' : '   saw: ' + JSON.stringify(saw)));
}
function eq(what, a, b) { ok(what + ' = ' + JSON.stringify(b), JSON.stringify(a) === JSON.stringify(b), a); }

/* Every lap the key names, and the swatch colour it names it with. The key
   is HTML, so this reads it the way the eye does. */
function keyRows() {
    const h = gpPanelGraphLegendHtml();
    const out = [];
    const re = /<span class='sw'>(?:<i style='background:([^']+)'><\/i>)?<b>([^<]+)<\/b>/g;
    let m;
    while ((m = re.exec(h))) out.push({ name: m[2], colour: m[1] || null });
    return out;
}
function keySays() {
    const h = gpPanelGraphLegendHtml();
    const m = /colour&nbsp;=&nbsp;(\w+)/.exec(h);
    return m ? m[1] : null;
}
/* What the canvas would stroke: gpRackStatic takes lines[0].colour for the
   subject (falling back to the lane's own colour) and lines[1..] for the
   comparison laps. */
function canvasLines() {
    return gpGraphLines().map(e => ({ lap: e.lap, colour: e.colour }));
}
/* The key and the canvas, side by side — the whole point of the exercise. */
function agree() {
    const canvas = canvasLines(), key = keyRows();
    if (canvas.length !== key.length) return 'canvas ' + canvas.length + ' lines, key ' + key.length + ' rows';
    for (let i = 0; i < canvas.length; i++) {
        const want = canvas[i].lap < 0 ? 'WHOLE SESSION' : 'LAP ' + (canvas[i].lap + 1);
        if (key[i].name !== want) return 'line ' + i + ' is ' + want + ', key says ' + key[i].name;
        if ((key[i].colour || null) !== canvas[i].colour) return want + ' drawn ' + canvas[i].colour + ', key swatch ' + key[i].colour;
    }
    return null;
}

console.log('\n---- what the graph draws, and what the key says -------------');

/* ---- the analysed lap is always a line, ticked or not ----------------- */
{
    const g = fresh();
    g.selLap = 1; g.shownLaps = { 1: false, 0: true };
    eq('analysed lap unticked: still drawn', canvasLines().map(e => e.lap), [1, 0]);
    ok('...and named in the key', agree() === null, agree());
}

/* ---- one line means colour is free to mean the channel ---------------- */
{
    const g = fresh();
    g.selLap = 1; g.shownLaps = { 1: true };
    eq('one lap: one line', canvasLines(), [{ lap: 1, colour: null }]);
    eq('one lap: colour means the channel', keySays(), 'channel');
    ok('one lap: no swatch that matches nothing', keyRows()[0].colour === null, keyRows());
    ok('key and canvas agree', agree() === null, agree());
}

/* ---- two or more and colour has to mean the lap ----------------------- */
{
    const g = fresh();
    g.selLap = 1; g.shownLaps = { 1: true, 0: true, 3: true };
    eq('three laps, subject first', canvasLines().map(e => e.lap), [1, 0, 3]);
    eq('...in their own colours',
       canvasLines().map(e => e.colour), [gpLapColour(1), gpLapColour(0), gpLapColour(3)]);
    eq('colour means the lap', keySays(), 'lap');
    ok('key and canvas agree', agree() === null, agree());
    ok('nothing left off, nothing to explain', gpGraphLeftOff() === '', gpGraphLeftOff());
}

/* ---- the whole session has no lap to line a comparison up against ----- */
{
    const g = fresh();
    g.selLap = -1; g.shownLaps = { 0: true, 2: true };
    eq('whole session: one line', canvasLines(), [{ lap: -1, colour: null }]);
    eq('whole session: colour means the channel', keySays(), 'channel');
    eq('whole session: named in the key', keyRows().map(r => r.name), ['WHOLE SESSION']);
    ok('...and the ticked laps are accounted for', /Pick a lap/.test(gpGraphLeftOff()), gpGraphLeftOff());
    ok('key and canvas agree', agree() === null, agree());
}

/* ---- Combined draws one lap, so it may only list one ------------------ */
{
    const g = fresh(true);
    g.selLap = 2; g.shownLaps = { 2: true, 0: true, 1: true };
    eq('Combined: one line', canvasLines(), [{ lap: 2, colour: null }]);
    eq('Combined: colour means the channel', keySays(), 'channel');
    eq('Combined: lists only the lap it draws', keyRows().map(r => r.name), ['LAP 3']);
    ok('...and says where the others went', /Combined/.test(gpGraphLeftOff()), gpGraphLeftOff());
    ok('key and canvas agree', agree() === null, agree());
}

/* ---- a ticked lap with no samples is not a line ----------------------- */
{
    const g = fresh();
    g.traceLaps = LAPS.concat([{ from: 1700, to: 1700 }]);
    g.selLap = 1; g.shownLaps = { 1: true, 4: true };
    eq('empty lap is not drawn', canvasLines().map(e => e.lap), [1]);
    ok('key and canvas agree', agree() === null, agree());
    g.traceLaps = LAPS;
}

/* ---- the cache token moves whenever the picture does ------------------ */
{
    const g = fresh();
    g.selLap = 1; g.shownLaps = { 1: true };
    const a = gpGraphLinesSig();
    g.shownLaps = { 1: true, 0: true };
    const b = gpGraphLinesSig();
    ok('ticking a lap changes the cache token', a !== b, [a, b]);
    g.selLap = 0;
    ok('...and so does changing the subject', gpGraphLinesSig() !== b, gpGraphLinesSig());
}

/* ---- the set is seeded once, not refilled behind you ------------------ */
{
    const g = fresh();
    g.selLap = -1; g.cmpLap = 3; g.shownLaps = null;
    eq('seeded from the analysed pair', gpShownList(), [3]);
    gpShownLaps()[3] = false;
    eq('unticking the last lap leaves it unticked', gpShownList(), []);
}

console.log('\n---- the window follows the playhead -------------------------');

const SPAN = 100;
function zoomAt(from) {
    global.gp.stripZoom = { lap: global.gp.selLap, from: from, to: from + SPAN };
}

/* ---- the whole lap on screen: nothing to follow ----------------------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = true; g.playIdx = 790;
    g.stripZoom = null;
    gpStripFollow();
    ok('no zoom, no movement', g.stripZoom === null, g.stripZoom);
}

/* ---- playing off the right-hand edge pages forward -------------------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = true;
    zoomAt(400); g.playIdx = 450;
    gpStripFollow();
    eq('mid-window: the picture holds still', [g.stripZoom.from, g.stripZoom.to], [400, 500]);

    g.playIdx = 489;                        /* 89% across — not yet */
    gpStripFollow();
    eq('near the edge: still holds', [g.stripZoom.from, g.stripZoom.to], [400, 500]);

    g.playIdx = 492;                        /* past 90% */
    gpStripFollow();
    eq('at the edge: pages forward', [g.stripZoom.from, g.stripZoom.to], [480, 580]);
    ok('...and the playhead is inside the new window',
       g.playIdx >= g.stripZoom.from && g.playIdx <= g.stripZoom.to, [g.playIdx, g.stripZoom]);
    ok('...with an overlap to read across', g.stripZoom.from < 500, g.stripZoom);
}

/* ---- it never pages past the end of the lap --------------------------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = true;
    zoomAt(699); g.playIdx = 795;
    gpStripFollow();
    eq('the last window stops at the flag', [g.stripZoom.from, g.stripZoom.to], [699, 799]);
    ok('the playhead is still in it',
       g.playIdx >= g.stripZoom.from && g.playIdx <= g.stripZoom.to, [g.playIdx, g.stripZoom]);
}

/* ---- paused, the window does not creep -------------------------------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = false;
    zoomAt(400); g.playIdx = 495;
    gpStripFollow();
    eq('paused at the edge: nothing moves', [g.stripZoom.from, g.stripZoom.to], [400, 500]);
}

/* ---- landing outside is a jump, not a page ---------------------------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = false;
    zoomAt(400); g.playIdx = 700;
    gpStripFollow();
    eq('scrubbed away: centred on the playhead', [g.stripZoom.from, g.stripZoom.to], [650, 750]);

    zoomAt(600); g.playIdx = 405;
    gpStripFollow();
    eq('scrubbed back: centred there too', [g.stripZoom.from, g.stripZoom.to], [400, 500]);

    zoomAt(600); g.playIdx = 401;
    gpStripFollow();
    ok('...clamped to the lap, never before it', gpStripRange().from >= 400, gpStripRange());
}

/* ---- a zoom belonging to another lap is not this lap's window --------- */
{
    const g = fresh();
    g.selLap = 1; g.playing = true;
    g.stripZoom = { lap: 2, from: 800, to: 900 };
    g.playIdx = 790;
    gpStripFollow();
    eq('another lap\'s zoom is left alone', [g.stripZoom.lap, g.stripZoom.from], [2, 800]);
}

console.log('');
console.log(fail ? '  FAILED ' + fail + ' of ' + (pass + fail) : '  passed all ' + pass + ' checks');
console.log('');
process.exit(fail ? 1 : 0);
