/* Functions in the overlay that nothing ever names again.
 *
 * The file is 2.8 MB of one script, and a function that lost its last caller
 * does not look any different from one that has ten. That is not just clutter:
 * a bug was fixed in gpGlanceHtml — the lap number it printed was an index
 * into a filtered array — before anyone noticed that no screen has rendered
 * it since ADR-0025 replaced the glance strip with the panel mosaic. Time
 * spent on code nobody runs is the cheapest kind of waste to prevent.
 *
 * Deliberately NOT a check_*.js: parked scaffolding is a legitimate thing to
 * have (gpCompareAt says so in its own comment — "the decoder wiring that
 * uses them is the remaining piece"), and a harness that failed on it would
 * be asking to have real design work deleted. This is a report to read, not
 * a gate to pass.
 *
 * It counts every occurrence of the name anywhere in the file, strings
 * included, so a handler reached only from an onclick="" attribute or from
 * window["gpFoo"] still counts as reachable.
 *
 *   node tools/dead_functions.js
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    process.argv[2] || path.join(__dirname, '..', 'src/tauri-overlay.html'), 'utf8');

/* Every harness in here lifts functions out of the overlay BY NAME, so a
   function whose only caller is a test still has a caller — and deleting it
   breaks that test. gpHudNightColour was removed on this tool's word and
   check_hud stopped at "cannot run — not in this revision". The tools
   directory counts. */
const TOOLS = fs.readdirSync(__dirname)
    .filter(f => /\.js$/.test(f) && f !== path.basename(__filename))
    .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'))
    .join('\n');

function lineOf(i) { return SRC.slice(0, i).split('\n').length; }
function uses(n) {
    const re = new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b', 'g');
    return (SRC.match(re) || []).length + (TOOLS.match(re) || []).length;
}
function report(title, found, floor) {
    const dead = found.filter(f => uses(f.name) <= floor).sort((a, b) => a.line - b.line);
    console.log('\n' + title + ': ' + found.length + ' declared, ' +
                dead.length + ' never named again');
    dead.forEach(d => console.log('  ' + String(d.line).padStart(6) + '  ' + d.name));
    if (!dead.length) console.log('  (none)');
    return dead;
}

/* Plain declarations. One occurrence = the declaration itself. */
const fns = [];
let m;
const decl = /^\s*function ([A-Za-z_$][\w$]*)\s*\(/gm;
while ((m = decl.exec(SRC))) fns.push({ name: m[1], line: lineOf(m.index) });
report('functions', fns, 1);

/* Handlers hung on window. These are the interesting ones: a dead helper is
   clutter, but a dead window.gpFoo is a BUTTON that nothing can reach any
   more — the markup that used to call it went, and the handler stayed.
   `window.gpFoo` and `gpFoo` both count as the name, so the floor is two:
   the assignment mentions it once as a property and once as nothing else. */
const wins = [];
const wdecl = /^\s*window\.([A-Za-z_$][\w$]*)\s*=\s*function\s*\(/gm;
while ((m = wdecl.exec(SRC))) wins.push({ name: m[1], line: lineOf(m.index) });
report('window handlers', wins, 1);
console.log('  (a leading _ or __ marks one put on window ON PURPOSE for a ' +
            'console or a\n   test to reach — those belong in this list and ' +
            'are not findings)');

/* One more shape, and the one that cost the most to find by hand: a handler
   that is only ever called from a `bind("data-gp-x", …)` for an attribute
   nothing emits. The handler looks alive — its caller names it — but the
   caller is dead too. gpRailTabSet and its whole rail pane were reachable
   only this way. */
const bound = new Set(), emitted = new Set();
let b;
const bre = /["'](data-gp-[a-z-]+)["']/g;
while ((b = bre.exec(SRC))) bound.add(b[1]);
const ere = /\b(data-gp-[a-z-]+)\s*=\s*['"\\]/g;
while ((b = ere.exec(SRC))) emitted.add(b[1]);
const orphanAttrs = [...bound].filter(a => !emitted.has(a)).sort();
console.log('\ndata-gp attributes: ' + bound.size + ' referenced, ' +
            orphanAttrs.length + ' with no literal `attr=` anywhere');
orphanAttrs.forEach(a => console.log('  ' + a));
if (!orphanAttrs.length) console.log('  (none)');
console.log('  (an attribute whose name is PASSED to a builder — gpTrackRow ' +
            'takes it as an\n   argument — has no literal here and is a false ' +
            'positive; check before deleting)');
