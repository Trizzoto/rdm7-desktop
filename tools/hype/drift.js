/* The drift board, run outside the app.
 *
 * golden_lib's sandbox stops at gpDriftStats; the rating, the links and the
 * board that puts a corner-on-a-lap out of five need a wider lift. Same rule
 * as every harness here: the functions are taken VERBATIM out of the overlay,
 * never copied, so artwork carrying a star rating carries the app's own.
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}
function varBlock(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1, d = 0, j = i;
    for (; j < SRC.length; j++) {
        const c = SRC[j];
        if (c === '[' || c === '{' || c === '(') d++;
        else if (c === ']' || c === '}' || c === ')') d--;
        else if (c === ';' && d === 0) { j++; break; }
    }
    return SRC.slice(m.index, j);
}
function constOf(n) {
    const m = new RegExp('var ' + n + ' = (0x[0-9a-fA-F]+|[-0-9.]+)').exec(SRC);
    if (!m) throw new Error('not found: var ' + n);
    return m[1].indexOf('0x') === 0 ? parseInt(m[1], 16) : parseFloat(m[1]);
}

const CONSTS = ['GP_DRIFT_MIN_KPH', 'GP_DRIFT_ON', 'GP_DRIFT_OFF', 'GP_DRIFT_HOLD_S',
    'GP_DRIFT_SETTLE_S', 'GP_DRIFT_SWITCH_G', 'GP_DRIFT_STAR_DEG', 'GP_DRIFT_STAR_SETTLE',
    'GP_DRIFT_RHO_MIN_KPH', 'GP_DRIFT_SPIN', 'GP_DRIFT_SPIN_DROP', 'GP_DRIFT_SCORE_VER',
    'GP_DRIFT_ROUGH', 'GP_DRIFT_LINK_FRAC', 'GP_MAX_STEP_S', 'GP_CHAN_STALE', 'GP_NO_T',
    'GP_BREAK_SLACK', 'GP_BREAK_FLOOR_M', 'GP_BREAK_QUIET_M', 'GP_BREAK_QUIET_K',
    'GP_BREAK_MAX_FRAC', 'GP_COAST_G', 'GP_BRAKE_G', 'GP_CORNER_PAD', 'GP_TURN_DPS',
    'GP_TURN_MIN_S', 'GP_TURN_MIN_DEG', 'GP_TURN_SAME_S'];

const FNS = ['gpN', 'gpMetres', 'gpMetresPerDeg', 'gpHaversineM', 'gpSecs', 'gpStep', 'gpHz',
    'gpChanDefsById', 'gpChanFixes', 'gpChanFixApply', 'gpChanFixFor', 'gpChanRawRange',
    'gpChanWouldRead', 'gpChanDef', 'gpChanValue', 'gpChanDefsFor', 'gpDashChansCached',
    'gpSignedDist', 'gpCrossAt', 'gpSpanSecs', 'gpGateHits', 'gpMainDir', 'gpChannels',
    'gpComputeG', 'gpHeadingAt', 'gpArcLength', 'gpCornerScan', 'gpFindCorners',
    'gpCornerPhases', 'gpNearestIndex', 'gpNominalStep', 'gpMarkBreaks', 'gpGapS',
    'gpDriftChans', 'gpDriftCanChans', 'gpHaveGyro', 'gpDriftGuess', 'gpDriftSrcPrefs',
    'gpDriftSrcKey', 'gpDriftSource', 'gpDriftAngle', 'gpDriftSeek', 'gpDriftSwitches',
    'gpDriftSegments', 'gpDriftStats', 'gpDriftForget', 'gpDriftCornerRead', 'gpDriftSpun',
    'gpDriftStars', 'gpDriftLinkMap', 'gpDriftUnits', 'gpDriftBoard', 'gpDriftBest',
    'gpDriftCorners', 'gpDriftRefLap', 'gpMyChans', 'gpLapRange', 'gpCleanRuns', 'gpSplitRows', 'gpMoveRuns',
    'gpOrientGates', 'gpRunsFromCrossings', 'gpRunGapMs', 'gpRunBreakM', 'gpGradeRuns',
    'gpDeadMs', 'gpVboClockMs', 'gpVboSpeedScale', 'gpVboParse', 'gpTrackFromVbo',
    'gpGateFromEnd'];

function sandbox(track) {
    const gp = { tracks: { active: null, tracks: track ? [track] : [] } };
    const win = { localStorage: { getItem: () => null, setItem: () => { } } };
    const K = {};
    CONSTS.forEach(n => { try { K[n] = constOf(n); } catch (e) { } });
    K.GP_DRIFT_STAR_W = eval('(' + /var GP_DRIFT_STAR_W = (\{[^}]*\})/.exec(SRC)[1] + ')');
    const stubs = [
        'function gpEsc(s) { return String(s == null ? "" : s); }',
        'function gpTracksSave() { }',
        'function gpTracksReady() { }',
        'function gpTrackUid() { return "trk_hype"; }',
        'function gpAllChans() { return []; }',
        'function gpRowsPack(rows) { return { n: rows.length }; }',
        'function gpSesUid() { return "ses_hype"; }',
        'function gpActiveTrack() { return ARGtrack; }',
        'var GP_MAX_SECTORS = 8;'
    ].join('\n');
    const names = Object.keys(K);
    const args = ['gp', 'window', 'GP_DT', 'GP_TRACE_HZ', 'ARGtrack'].concat(names);
    const body = varBlock('GP_VBO_ROLE') + '\n' + varBlock('GP_PLACES') + '\n' + stubs + '\n' +
        FNS.map(grab).join('\n') +
        '\n;return {' + FNS.map(n => n + ':' + n).join(',') + '};';
    const API = new Function(...args, body)(gp, win, 1 / 25, 25, track || null,
        ...names.map(n => K[n]));
    return { API, gp, K };
}
module.exports = { sandbox, grab, varBlock, constOf, SRC };

if (require.main === module) {
    const S = sandbox(null);
    console.log('lifted', Object.keys(S.API).length, 'functions, star weights',
        JSON.stringify(S.K.GP_DRIFT_STAR_W), 'full marks at', S.K.GP_DRIFT_STAR_DEG + '°');
}
