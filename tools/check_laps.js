/* Laps at a track, gathered across every recording.
 *
 * A recording is a filing decision — where the ring happened to be downloaded,
 * how many times the car was switched off. "My best lap at Mount Barker" is a
 * question about the TRACK, and answering it meant opening files one at a time
 * and remembering numbers.
 *
 * What this pins down:
 *   - laps from DIFFERENT recordings sort into one ranking
 *   - the gap column is measured against the best lap at that track, not
 *     against the best lap in whichever recording the row came from
 *   - a track's summary counts laps and DAYS, not recordings
 *   - untimed laps (an out-lap that never crossed the line) are not ranked
 *   - one track's laps never leak into another's
 *
 * Functions come verbatim out of src/tauri-overlay.html — a copy would drift
 * and then pass while the app failed.
 *
 *   node tools/check_laps.js
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

const WANT = ['gpTrackLapRows', 'gpLapTrackSummary', 'gpSesMode'];
const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [];
for (const n of WANT) parts.push(grabFrom(src, n));

const prelude = `
    var gp = { sessions: [], sessFilter: null, sesMode: null };
    /* Day granularity only — the summary counts DAYS, and a harness that
       carried its own date formatting would agree with itself and with
       nothing else. Mirrors gpSesDay's contract, not its implementation. */
    function gpSesDay(ms) { return new Date(ms).toISOString().slice(0, 10); }
`;

const F = new Function(prelude + parts.join('\n') + `
    return { gpTrackLapRows: gpTrackLapRows,
             gpLapTrackSummary: gpLapTrackSummary,
             gpSesMode: gpSesMode,
             setSessions: function (s) { gp.sessions = s; },
             setFilter: function (f) { gp.sessFilter = f; },
             setMode: function (m) { gp.sesMode = m; } };
`)();

let pass = 0, fail = 0;
function ok(what, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + what); }
    else { fail++; console.log('  FAIL  ' + what + (detail ? '  — ' + detail : '')); }
}

const DAY = 86400000;
const T0 = Date.UTC(2026, 7, 19, 10, 0, 0);

/* Three days at Mount Barker and one at Mallala. The quickest lap of all is
   in the MIDDLE recording, so a ranking that just takes the newest or the
   first recording's best gets it wrong. */
F.setSessions([
    { id: 's1', name: 'Mount Barker — Wed', trackName: 'Mount Barker Time Trial',
      trial: true, recordedAt: T0, dated: 'gps', driver: 'Tommy', car: 'GT86',
      lapTimesS: [233.610, 189.402] },
    { id: 's2', name: 'Mount Barker — Thu', trackName: 'Mount Barker Time Trial',
      trial: true, recordedAt: T0 + DAY, dated: 'gps', driver: 'Tommy', car: 'GT86',
      lapTimesS: [159.212, 0, 171.004] },          /* the 0 is an untimed out-lap */
    { id: 's3', name: 'Mount Barker — Fri', trackName: 'Mount Barker Time Trial',
      trial: true, recordedAt: T0 + 2 * DAY, dated: 'download', driver: 'Tommy', car: 'GT86',
      lapTimesS: [166.900] },
    { id: 's4', name: 'Mallala — Wed', trackName: 'Mallala',
      trial: false, recordedAt: T0, dated: 'gps', driver: 'Tommy', car: 'GT86',
      lapTimesS: [72.345, 71.980] },
    { id: 's5', name: 'A drive with no track', trackName: null,
      trial: false, recordedAt: T0, dated: 'gps', lapTimesS: [] }
]);

console.log('\nlaps gather across recordings');
const mb = F.gpTrackLapRows('Mount Barker Time Trial');
ok('every timed lap at the track is listed', mb.length === 5, mb.length + ' laps');
ok('the untimed out-lap is not ranked', mb.every(r => r.t > 0));
ok('they come from more than one recording',
   new Set(mb.map(r => r.sesId)).size === 3,
   new Set(mb.map(r => r.sesId)).size + ' recordings');
ok('quickest first', mb[0].t === 159.212, String(mb[0].t));
ok('and it is the one from the MIDDLE recording, not the newest or the oldest',
   mb[0].sesId === 's2', mb[0].sesId);
ok('slowest last', mb[mb.length - 1].t === 233.610, String(mb[mb.length - 1].t));
ok('sorted throughout', mb.every((r, i) => i === 0 || mb[i - 1].t <= r.t));

console.log('\nthe lap index points back at a real lap');
const fromS2 = mb.filter(r => r.sesId === 's2');
ok('the 159.212 is index 0 of its recording',
   fromS2.filter(r => r.t === 159.212)[0].lapIdx === 0);
/* lapTimesS was [159.212, 0, 171.004] — so 171.004 is index 2, NOT index 1.
   Skipping the untimed lap must not renumber the ones after it, or Open
   lands on the wrong lap. */
ok('the 171.004 is index 2, not renumbered by the skipped out-lap',
   fromS2.filter(r => r.t === 171.004)[0].lapIdx === 2,
   String(fromS2.filter(r => r.t === 171.004)[0].lapIdx));

console.log('\none track never borrows another track\'s laps');
const mal = F.gpTrackLapRows('Mallala');
ok('Mallala has its own two', mal.length === 2, mal.length + ' laps');
ok('and its own best', mal[0].t === 71.980, String(mal[0].t));
ok('no Mount Barker lap leaked in', mal.every(r => r.track === 'Mallala'));
ok('a recording with no track contributes nothing',
   mb.concat(mal).every(r => r.sesId !== 's5'));

console.log('\nthe gap is against the track best, not the recording best');
/* s3's only lap is 166.900. Inside its own recording it is the best lap and
   its gap would be zero — but at the track it is 7.688 s off. Getting this
   wrong makes every recording look like a personal best. */
const s3row = mb.filter(r => r.sesId === 's3')[0];
const gap = s3row.t - mb[0].t;
ok('a lap that is best-of-its-own-recording still shows a real gap',
   Math.abs(gap - 7.688) < 0.001, gap.toFixed(3));

console.log('\ntrack summary counts days, not recordings');
const sum = F.gpLapTrackSummary();
const mbSum = sum.filter(t => t.name === 'Mount Barker Time Trial')[0];
ok('Mount Barker is summarised', !!mbSum);
ok('5 timed laps', mbSum.laps === 5, String(mbSum.laps));
ok('over 3 days', mbSum.dayCount === 3, String(mbSum.dayCount));
ok('best is the track best', mbSum.best === 159.212, String(mbSum.best));
ok('the trackless recording is not a track', sum.every(t => t.name), JSON.stringify(sum.map(t => t.name)));
ok('busiest track first', sum[0].name === 'Mount Barker Time Trial', sum[0].name);

console.log('\ntwo recordings on ONE day count as one day');
F.setSessions([
    { id: 'a', name: 'morning', trackName: 'Mallala', recordedAt: T0, lapTimesS: [80.0] },
    { id: 'b', name: 'afternoon', trackName: 'Mallala', recordedAt: T0 + 3600000, lapTimesS: [79.0] }
]);
const one = F.gpLapTrackSummary()[0];
ok('two recordings, two laps', one.laps === 2, String(one.laps));
ok('but one day', one.dayCount === 1, String(one.dayCount));

console.log('\npicking a track is asking about laps');
F.setMode(null); F.setFilter({ q: '', track: null });
ok('no track picked -> recordings', F.gpSesMode() === 'recordings', F.gpSesMode());
F.setMode(null); F.setFilter({ q: '', track: 'Mallala' });
ok('a track picked -> laps', F.gpSesMode() === 'laps', F.gpSesMode());
F.setMode('recordings'); F.setFilter({ q: '', track: 'Mallala' });
ok('an explicit choice outranks that', F.gpSesMode() === 'recordings', F.gpSesMode());

console.log('\nan empty library says nothing rather than throwing');
F.setSessions([]);
ok('no laps', F.gpTrackLapRows('Mallala').length === 0);
ok('no tracks', F.gpLapTrackSummary().length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
