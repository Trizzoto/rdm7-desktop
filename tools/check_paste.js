/* Load Layout JSON says what is wrong with what you pasted.
 *
 * The page exists to take "the same shape an export produces, or what an AI
 * builder generates" and preview it with no device attached. It checked one
 * thing: that `widgets` was an array. Everything past that loaded.
 *
 * Measured on the dev build, pasting four widgets — one good, one of a type
 * that does not exist, one with x: "far", one with no type at all:
 *
 *   status bar    Loaded layout "bad" (4 widgets)
 *   layers panel  a row reading `undefined`
 *   the payload   text far,down widextall   /   undefined 0,0 10x10
 *
 * That last line is what Save would have sent to the dash.
 *
 * The rule now: refuse what cannot be represented — not an object, no type,
 * a coordinate that is a word — one line per problem, naming the widget. An
 * unknown TYPE is NOT refused: it may be a layout for a newer dash, and
 * eating somebody's file is worse than drawing it short. It loads, and the
 * status line says which type is blank and why.
 *
 *   node tools/check_paste.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const DIST = path.join(ROOT, 'src/dist/index.html');
if (!fs.existsSync(DIST)) {
    console.log('src/dist/index.html is not built — run tools/merge_overlay.py first');
    process.exit(1);
}
const SRC = fs.readFileSync(DIST, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}
function grab(name) {
    const re = new RegExp('^        (?:async )?function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}

console.log('the page checks before it loads');
const load = grab('loadJsonFromText');
ok('the paste is examined', /_layoutProblems\(data\)/.test(load));
ok('and a real problem stops the load', /if \(problems\.bad\.length\)/.test(load) &&
   load.indexOf('problems.bad.length') < load.indexOf('firmwareToWebFormat'),
   'the check has to come BEFORE currentLayout is replaced');
ok('the reasons are listed, not summarised', /problems\.bad\.slice\(0, 6\)/.test(load) &&
   /and ' \+ \(problems\.bad\.length - shown\.length\) \+ ' more/.test(load));
ok('an unknown type is reported, not refused',
   /problems\.unknown\.length/.test(load) && !/problems\.unknown\.length\) \{[\s\S]{0,40}return/.test(load),
   'a layout for a newer dash is still somebody\'s file');
ok('and the status line says which type went blank',
   /nothing here can draw/.test(load));

console.log('\nrun it');
/* WIDGET_DEFS is only asked whether it has a key, so a two-entry stand-in is
   the whole of what the function needs. */
const problems = new Function('WIDGET_DEFS',
    grab('_layoutProblems') + '\n return _layoutProblems;')({ text: {}, panel: {} });

const P = (widgets) => problems({ widgets });

ok('a clean layout has nothing to say',
   P([{ type: 'text', id: 'a', x: 0, y: 0, w: 10, h: 10 }]).bad.length === 0);
ok('a widget with no type is refused by name',
   P([{ id: 'a' }]).bad[0] === 'Widget 1 ("a") does not say what type it is.',
   JSON.stringify(P([{ id: 'a' }]).bad));
ok('and one with no id is still located',
   /^Widget 2 does not say/.test(P([{ type: 'text' }, {}]).bad[0]),
   JSON.stringify(P([{ type: 'text' }, {}]).bad));
/* Anything that is not an object has to be caught by the FIRST test in the
   loop — the rest of it reads w.id and w.type, so a null that gets past
   throws rather than reporting, which is what this used to do inside
   loadJsonFromText's try/catch ("Cannot read properties of null"). */
const safe = (w) => { try { return P(w); } catch (e) { return { threw: String(e.message || e) }; } };
ok('a null in the list is not a widget',
   (safe([null]).bad || [])[0] === 'Widget 1 is not a widget.',
   JSON.stringify(safe([null])));
ok('nor is a bare string, or an array',
   (safe(['text']).bad || []).length === 1 && (safe([[1, 2]]).bad || []).length === 1,
   JSON.stringify([safe(['text']), safe([[1, 2]])]));

const words = P([{ type: 'text', id: 'a', x: 'far', y: 'down', w: 'wide', h: 'tall' }]).bad;
ok('every non-numeric coordinate is named, one line each', words.length === 4 &&
   words[0] === 'Widget 1 ("a") has x set to "far", which is not a number.',
   JSON.stringify(words));
ok('a numeric STRING is allowed through', P([{ type: 'text', x: '40' }]).bad.length === 0,
   'an export can quote its numbers; Number("40") is 40 and the editor coerces it');
ok('a missing coordinate is not a problem', P([{ type: 'text', id: 'a' }]).bad.length === 0,
   'absent means "default to 0", which is what addWidget does');
ok('NaN and Infinity are',
   P([{ type: 'text', x: 'NaN' }]).bad.length === 1 &&
   P([{ type: 'text', y: 1e999 }]).bad.length === 1);

const unk = P([{ type: 'flux_capacitor', x: 0 }, { type: 'flux_capacitor' }, { type: 'ansible' }]);
ok('an unknown type is collected, not refused', unk.bad.length === 0 &&
   unk.unknown.join() === 'flux_capacitor,ansible', JSON.stringify(unk));
ok('and it is listed once however many use it', unk.unknown.length === 2);

/* The old rule, so this stays a test of something real. */
const oldRule = (data) => (data && typeof data === 'object' && Array.isArray(data.widgets));
ok('doing it the old way still accepts every one of these',
   [[null], ['text'], [{ id: 'a' }], [{ type: 'text', x: 'far' }]]
       .every(w => oldRule({ widgets: w })),
   'the only check was that widgets was an array');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
