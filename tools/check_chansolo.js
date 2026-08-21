/* Showing one channel on its own, and getting back what you had.
 *
 * A rack of a dozen traces and the question "what did speed do here" was
 * twelve clicks away, and twelve more to undo. The bulk tick made it two
 * gestures — all off, then tick the one — but it still forgot the set you had
 * been looking at, so coming back meant rebuilding it by hand.
 *
 * So the channel's NAME is the control: one click shows only that one, the
 * same click again restores exactly the set that was showing before.
 *
 * What this pins down:
 *   - soloing leaves exactly one lane shown, whatever was showing before
 *   - clicking the same name again restores the PREVIOUS set, not "all"
 *   - soloing a second channel while soloed still remembers the original set
 *   - with nothing remembered, un-soloing falls back to every channel
 *   - the soloed lane is derived from what is drawn, so a hand-made
 *     one-channel selection un-solos on the next click instead of doing
 *     nothing
 *   - an unknown channel is ignored rather than blanking the rack
 *
 * Functions come verbatim out of src/tauri-overlay.html — a copy would drift
 * and then pass while the app failed.
 *
 *   node tools/check_chansolo.js
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
const WANT = ['gpLaneShown', 'gpLaneSoloId', 'gpLaneSolo'];
const parts = WANT.map(n => grabFrom(src, n));

/* gpLaneRowsAll builds its list out of a loaded recording, the puck's channel
   selection and the drift sources — none of which this is about. Stubbed to a
   fixed set of lanes so what is under test is the solo bookkeeping.
   gpLaneShowMap / gpLaneShowSave are the store; drawing is a no-op. */
const prelude = `
    var gp = { laneShow: {}, laneSoloPrev: null, stripCache: 'stale' };
    var LANES = [];
    var draws = 0, refreshes = 0, saves = 0;
    function gpLaneRowsAll() { return LANES; }
    function gpLaneShowMap() { if (!gp.laneShow) gp.laneShow = {}; return gp.laneShow; }
    function gpLaneShowSave() { saves++; }
    function gpDrawStrip() { draws++; }
    function gpChanUiRefresh() { refreshes++; }
`;

const F = new Function(prelude + parts.join('\n') + `
    return { solo: gpLaneSolo, soloId: gpLaneSoloId, shown: gpLaneShown,
             setLanes: function (l) { LANES = l; },
             map: function () { return gp.laneShow; },
             setMap: function (m) { gp.laneShow = m; gp.laneSoloPrev = null; },
             prev: function () { return gp.laneSoloPrev; },
             counts: function () { return { draws: draws, refreshes: refreshes, saves: saves }; } };
`)();

let pass = 0, fail = 0;
function ok(what, cond, got) {
    if (cond) { pass++; console.log('  ok   ' + what); }
    else { fail++; console.log('  FAIL ' + what + (got === undefined ? '' : '  got: ' + got)); }
}

/* Four channels. `throttle` is pending — the puck logs it but this recording
   has no data for it — which is the one lane that is NOT drawn by default. */
const LANES = [
    { id: 'speed', label: 'Speed' },
    { id: 'rpm', label: 'Engine RPM' },
    { id: 'coolant', label: 'Coolant' },
    { id: 'throttle', label: 'Throttle', pending: true }
];
F.setLanes(LANES);
const drawn = () => LANES.filter(F.shown).map(l => l.id);

console.log('by default every channel with data is drawn');
F.setMap({});
ok('three of the four', JSON.stringify(drawn()) === '["speed","rpm","coolant"]',
   JSON.stringify(drawn()));
ok('nothing is soloed', F.soloId() === null, String(F.soloId()));

console.log('\none click shows only that channel');
F.solo('speed');
ok('speed alone', JSON.stringify(drawn()) === '["speed"]', JSON.stringify(drawn()));
ok('and it reads as the soloed one', F.soloId() === 'speed', String(F.soloId()));
ok('the pending channel was not dragged in', F.shown(LANES[3]) === false);

console.log('\nthe same click again puts back what was there');
F.solo('speed');
ok('all three again', JSON.stringify(drawn()) === '["speed","rpm","coolant"]',
   JSON.stringify(drawn()));
ok('nothing soloed', F.soloId() === null, String(F.soloId()));

console.log('\nit restores the SET you had, not simply everything');
/* Coolant hidden by hand, then a solo and back: coolant must still be hidden.
   Restoring "all" would quietly undo a choice the solo was never asked to
   touch. */
F.setMap({ coolant: false });
ok('two showing to start', JSON.stringify(drawn()) === '["speed","rpm"]',
   JSON.stringify(drawn()));
F.solo('rpm');
ok('rpm alone', JSON.stringify(drawn()) === '["rpm"]', JSON.stringify(drawn()));
F.solo('rpm');
ok('and coolant is still hidden', JSON.stringify(drawn()) === '["speed","rpm"]',
   JSON.stringify(drawn()));

console.log('\nsoloing a second channel keeps the ORIGINAL set remembered');
F.setMap({ coolant: false });
F.solo('speed');
F.solo('rpm');          /* straight from one solo to another */
ok('now rpm alone', JSON.stringify(drawn()) === '["rpm"]', JSON.stringify(drawn()));
F.solo('rpm');
ok('back to the set from before the FIRST solo',
   JSON.stringify(drawn()) === '["speed","rpm"]', JSON.stringify(drawn()));

console.log('\nnothing remembered: un-soloing falls back to every channel');
/* What a solo left behind in localStorage looks like on the next launch —
   one lane showing and no memory of what came before. */
F.setMap({ speed: true, rpm: false, coolant: false, throttle: false });
ok('one lane showing', JSON.stringify(drawn()) === '["speed"]', JSON.stringify(drawn()));
ok('nothing remembered', F.prev() === null);
F.solo('speed');
ok('the default set comes back', JSON.stringify(drawn()) === '["speed","rpm","coolant"]',
   JSON.stringify(drawn()));

console.log('\na hand-made single selection is treated as a solo');
/* Because the soloed lane is DERIVED from what is drawn rather than stored,
   there is no second piece of state to disagree with the rack. */
F.setMap({ speed: true, rpm: false, coolant: false, throttle: false });
ok('it reads as soloed', F.soloId() === 'speed', String(F.soloId()));
F.solo('speed');
ok('so the click releases it rather than doing nothing',
   drawn().length === 3, JSON.stringify(drawn()));

console.log('\na channel with no data in this recording can still be soloed');
/* The same thing its Graph tick already allows: an empty lane with the
   channel's name on it, which is how you tell "not recorded" apart from
   "recorded and flat". The rack's own label cannot start this one — there is
   no label on a lane that is not drawn — but the Channels list can. */
F.setMap({});
F.solo('throttle');
ok('it is the only lane drawn', JSON.stringify(drawn()) === '["throttle"]',
   JSON.stringify(drawn()));
ok('and it reads as the soloed one', F.soloId() === 'throttle', String(F.soloId()));
F.solo('throttle');
ok('and the ordinary set comes back',
   JSON.stringify(drawn()) === '["speed","rpm","coolant"]', JSON.stringify(drawn()));

console.log('\nan unknown channel changes nothing');
F.setMap({});
const before = JSON.stringify(drawn());
F.solo('nosuchchannel');
ok('the rack is untouched', JSON.stringify(drawn()) === before, JSON.stringify(drawn()));
ok('and nothing is soloed', F.soloId() === null, String(F.soloId()));

console.log('\nevery solo redraws and saves');
const c0 = F.counts();
F.solo('speed');
const c1 = F.counts();
ok('the strip is redrawn', c1.draws === c0.draws + 1);
ok('the channel list is refreshed', c1.refreshes === c0.refreshes + 1);
ok('and the choice is written down', c1.saves === c0.saves + 1);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
