/* Analyse panels: does each one get the height its contents actually need?
 *
 * A scrollbar inside a panel is the panel lying about its size. The lap list
 * proved it — it opened parked on Lap 2, with Lap 1 above its own fold and
 * nothing on screen saying so, because the mosaic had handed the row a share
 * of the window rather than the height the list needed.
 *
 * So a panel holding a DOCUMENT is measured and given exactly that height,
 * and the page is the only thing that scrolls. A panel holding an INSTRUMENT
 * has no natural height to measure, so it takes what is left over instead.
 * These are the three pieces of that:
 *
 *   gpFlowH       where the content actually ends, whether or not it overflows
 *   gpNodeWantH   the same question asked of a whole subtree
 *   gpSpineFill   who gets the window's spare height, and who gives it back
 *
 *   node tools/check_gridfit.js
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

function grabConst(src, name) {
    const re = new RegExp('^        var ' + name + ' = [^;]+;', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: ' + name);
    return m[0];
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const WANT = ['gpFlowH', 'gpNodeMinH', 'gpNodeWantH', 'gpNodeElastic', 'gpSpineFill'];
const CONSTS = ['GP_ROW_MIN', 'GP_GAP', 'GP_SNAP'];
const parts = [], missing = [];
for (const n of CONSTS) parts.push(grabConst(src, n));
for (const n of WANT) {
    try { parts.push(grabFrom(src, n)); } catch (e) { missing.push(n); }
}

/* gpNodeWantH leans on gpPanelWantH, which is a DOM measurement — stubbed so
   the composition (a column sums, a row maxes) is what is under test here. */
const F = new Function(`
    var gp = { video: null };
    var PANEL_H = {};
    function gpPanelWantH(n) { return PANEL_H[n.type] === undefined ? 150 : PANEL_H[n.type]; }
    ${parts.join('\n')}
    return {
        setPanelH: function (m) { PANEL_H = m; },
        setVideo: function (v) { gp.video = v; },
        flow: typeof gpFlowH === 'function' ? gpFlowH : null,
        want: typeof gpNodeWantH === 'function' ? gpNodeWantH : null,
        min: typeof gpNodeMinH === 'function' ? gpNodeMinH : null,
        elastic: typeof gpNodeElastic === 'function' ? gpNodeElastic : null,
        fill: typeof gpSpineFill === 'function' ? gpSpineFill : null,
        GP_ROW_MIN: GP_ROW_MIN, GP_GAP: GP_GAP, GP_SNAP: GP_SNAP,
    };
`)();

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.5 : tol);

if (missing.length) console.log('(not in this revision: ' + missing.join(', ') + ')\n');
if (!F.flow || !F.want || !F.fill) { console.log('the sizing helpers are missing'); process.exit(1); }

/* ---- gpFlowH: where does the content END ------------------------------- */
/* A scrollport with children, faked far enough for the function under test:
   it reads getBoundingClientRect, scrollTop, scrollHeight, clientHeight and
   the computed bottom padding, and nothing else. */
function port(opts) {
    const boxTop = 100;
    const el = {
        scrollTop: opts.scrollTop || 0,
        clientHeight: opts.clientHeight,
        scrollHeight: opts.scrollHeight === undefined ? opts.clientHeight : opts.scrollHeight,
        getBoundingClientRect: () => ({ top: boxTop }),
        children: (opts.rows || []).map(r => ({
            getBoundingClientRect: () => ({
                top: boxTop - (opts.scrollTop || 0) + r[0],
                bottom: boxTop - (opts.scrollTop || 0) + r[1],
                height: r[1] - r[0], width: r[1] > r[0] ? 300 : 0,
            }),
        })),
    };
    global.window = { getComputedStyle: () => ({ paddingBottom: (opts.padBottom || 0) + 'px' }) };
    return el;
}

console.log('content shorter than its box measures the CONTENT');
/* The whole reason this is not just scrollHeight: at rest scrollHeight IS the
   box, so a panel would ratchet up to whatever height it last had and never
   come back down. Open a 7-lap session after a 40-lap one and the list would
   keep the taller session's height forever. */
ok('a 200 px list in a 400 px box wants 200, not 400',
   near(F.flow(port({ clientHeight: 400, rows: [[0, 200]] })), 200),
   'got ' + F.flow(port({ clientHeight: 400, rows: [[0, 200]] })));

console.log('\ncontent taller than its box measures the OVERFLOW');
ok('a list that overflows reports the whole list',
   near(F.flow(port({ clientHeight: 223, scrollHeight: 312, rows: [[0, 312]] })), 312),
   'got ' + F.flow(port({ clientHeight: 223, scrollHeight: 312, rows: [[0, 312]] })));
ok('and it is right even scrolled away from the top',
   near(F.flow(port({ clientHeight: 223, scrollHeight: 312, scrollTop: 89, rows: [[0, 312]] })), 312));

console.log('\nthe bits around the content count too');
ok('bottom padding is part of the height',
   near(F.flow(port({ clientHeight: 400, padBottom: 10, rows: [[0, 200]] })), 210));
ok('several stacked children measure to the last one',
   near(F.flow(port({ clientHeight: 400, rows: [[0, 40], [40, 90], [90, 260]] })), 260));
ok('a child with no box at all is ignored',
   near(F.flow(port({ clientHeight: 400, rows: [[0, 200], [900, 900]] })), 200));
ok('nothing in it wants nothing',
   near(F.flow(port({ clientHeight: 400, rows: [] })), 0));

/* ---- gpNodeWantH: the same question, asked of a subtree ---------------- */
const panel = (type, id) => ({ id: id || type, type: type });
const col = (kids) => ({ id: 'c', dir: 'col', kids: kids, sz: kids.map(() => 1) });
const row = (kids) => ({ id: 'r', dir: 'row', kids: kids, sz: kids.map(() => 1) });

console.log('\na row is as tall as its tallest panel; a column is the sum');
F.setPanelH({ map: 350, graph: 400, times: 320, report: 260, video: 150 });
ok('a row of map and graph wants the graph',
   F.want(row([panel('map'), panel('graph')])) === 400,
   'got ' + F.want(row([panel('map'), panel('graph')])));
ok('a stack of graph over times wants both, plus the divider between them',
   F.want(col([panel('graph'), panel('times')])) === 400 + 320 + F.GP_GAP,
   'got ' + F.want(col([panel('graph'), panel('times')])));
ok('a stack inside a row makes the row as tall as the stack',
   F.want(row([panel('map'), col([panel('graph'), panel('times')])])) === 400 + 320 + F.GP_GAP);
ok('nothing is ever shorter than the floor a panel can be drawn in',
   F.want(panel('nothing-here')) >= F.GP_ROW_MIN);

console.log('\nwhich rows can USE more height');
ok('a map can', F.elastic(panel('map')) === true);
ok('a rack can', F.elastic(panel('graph')) === true);
ok('a lap list cannot — 80 more pixels of it is 80 pixels of nothing',
   F.elastic(panel('times')) === false);
ok('a row counts as elastic if anything in it is',
   F.elastic(row([panel('times'), panel('map')])) === true);
ok('and not if nothing is',
   F.elastic(row([panel('times'), panel('report')])) === false);
ok('an EMPTY video panel is not worth growing', F.elastic(panel('video')) === false);
F.setVideo({ url: 'file:///x.mp4' });
ok('a loaded one is', F.elastic(panel('video')) === true);
F.setVideo(null);

/* ---- gpSpineFill: who gets the slack ----------------------------------- */
console.log('\nspare height goes to the rows that can use it');
let out = F.fill([400, 300], [150, 150], [true, false], 800);
ok('the elastic row takes all 100 of it', near(out[0], 500) && near(out[1], 300),
   JSON.stringify(out));
out = F.fill([400, 300], [150, 150], [true, true], 800);
ok('two elastic rows split it', near(out[0], 450) && near(out[1], 350), JSON.stringify(out));
out = F.fill([400, 300], [150, 150], [false, false], 800);
ok('with nothing elastic nobody is stretched', out[0] === 400 && out[1] === 300,
   JSON.stringify(out));

console.log('\na few pixels short is absorbed, not turned into a scrollbar');
out = F.fill([397, 349], [150, 150], [true, false], 733);
ok('13 px over the window comes off the rack instead', near(out[0], 384) && near(out[1], 349),
   JSON.stringify(out));
ok('and the total then lands exactly on the window',
   near(out[0] + out[1], 733), (out[0] + out[1]).toFixed(2));

console.log('\na real shortfall is left alone, and the page scrolls');
out = F.fill([400, 300, 300], [150, 150, 150], [true, false, false], 800);
ok('200 px over one elastic row is not squashed away',
   out[0] === 400 && out[1] === 300 && out[2] === 300, JSON.stringify(out));
ok('exactly at the snap it is still left alone',
   F.fill([400, 300], [150, 150], [true, false], 700 - F.GP_SNAP)[0] === 400);
ok('one pixel inside it is absorbed',
   F.fill([400, 300], [150, 150], [true, false], 700 - F.GP_SNAP + 1)[0] < 400);

console.log('\nan instrument is never squashed below what it can be drawn in');
/* 40 px short, so the snap guard hands the shortfall to the elastic row —
   which would take it under the height a panel can be drawn in, and does not. */
out = F.fill([160, 300], [150, 150], [true, false], 420);
ok('the elastic row stops at its own floor', out[0] === 150, JSON.stringify(out));
ok('and the page scrolls the rest rather than the floor being ignored',
   out[0] + out[1] > 420, JSON.stringify(out));

console.log('\nthe input is never mutated');
const before = [400, 300];
F.fill(before, [150, 150], [true, false], 800);
ok('the caller keeps its own array', before[0] === 400 && before[1] === 300);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
