/* A key pressed into a control belongs to the control, not to the canvas.
 *
 * The editor has two keyboard handlers and both decided that with one test:
 * `tagName === 'INPUT'`. Everything else a key means something to was left
 * out, and it showed:
 *
 *   window.onkeydown — the shortcuts. With an inspector's font picker
 *     focused, Down changed the font AND nudged the widget a pixel, and
 *     Delete removed the widget outright. Someone who tabbed to a dropdown
 *     and pressed Delete lost their work and got no dialog.
 *
 *   Space-to-pan — cancels the keystroke to grab the canvas. Measured on the
 *     dev build: the space bar was swallowed in BOTH of the editor's
 *     textareas, the Load-JSON paste box and the CAN-trace notes field
 *     ("anything that'd help debug" — a prose field you cannot put a space
 *     in), it would not press a focused button, and it would not open a
 *     focused dropdown.
 *
 * Two rules now, because they are two different questions. _keyGoesToField
 * is "this keystroke is editing a value" — a button does not qualify, so
 * Delete still works with one focused. _spaceGoesToControl is the wider one:
 * everything the space bar already operates.
 *
 *   node tools/check_keys.js
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

console.log('both handlers ask, and neither asks by tag name');

const spaceHandler = (() => {
    const i = SRC.indexOf("if (e.code === 'Space'");
    return SRC.slice(i, SRC.indexOf('});', i));
})();
ok('space-to-pan asks whether the space bar is already spoken for',
   /!_spaceGoesToControl\(e\.target\)/.test(spaceHandler),
   'it asked tagName !== INPUT, which swallowed the space bar in every textarea');

const shortcuts = (() => {
    const i = SRC.indexOf('window.onkeydown = (e) => {');
    return SRC.slice(i, i + 600);
})();
ok('the shortcut handler asks whether a value is being edited',
   /if \(_keyGoesToField\(e\.target\)\) return;/.test(shortcuts),
   'it listed INPUT and TEXTAREA and stopped there');
ok('and nothing is left testing tagName against INPUT by hand',
   !/tagName === 'INPUT' \|\| e\.target\.tagName === 'TEXTAREA'/.test(SRC) &&
   !/e\.target\.tagName !== 'INPUT'/.test(SRC));

console.log('\nrun the two rules');

const F = new Function(grab('_keyGoesToField') + '\n return _keyGoesToField;')();
const S = new Function(grab('_keyGoesToField') + '\n' + grab('_spaceGoesToControl') +
                       '\n return _spaceGoesToControl;')();

const el = (tag, extra) => Object.assign({
    tagName: tag, isContentEditable: false, getAttribute: () => null
}, extra || {});

/* A keystroke that is editing a value. */
[['INPUT', true], ['TEXTAREA', true], ['SELECT', true], ['OPTION', true],
 ['BUTTON', false], ['DIV', false], ['CANVAS', false], ['SUMMARY', false], ['A', false]]
    .forEach(([tag, want]) => {
        ok('a key in a ' + tag.toLowerCase() + (want ? ' is the control\'s' : ' is not'),
           F(el(tag)) === want, tag + ' → ' + F(el(tag)));
    });
ok('and so is one in anything contenteditable', F(el('DIV', { isContentEditable: true })) === true);
ok('nothing at all is not a control', F(null) === false && S(null) === false);

/* Delete has to keep working with a button focused — that is the difference
   between the two rules, and the reason there are two. */
ok('Delete still reaches the canvas with a button focused', F(el('BUTTON')) === false);

/* What the space bar already operates. */
[['INPUT', true], ['TEXTAREA', true], ['SELECT', true], ['BUTTON', true],
 ['A', true], ['SUMMARY', true], ['DIV', false], ['CANVAS', false]]
    .forEach(([tag, want]) => {
        ok('space in a ' + tag.toLowerCase() + (want ? ' is spoken for' : ' is free for panning'),
           S(el(tag)) === want, tag + ' → ' + S(el(tag)));
    });
ok('and a div that says it is a button is too',
   S(el('DIV', { getAttribute: (k) => (k === 'role' ? 'button' : null) })) === true);
ok('while the canvas itself still pans', S(el('DIV')) === false);

/* The old rule, so this stays a test of something real. */
const oldRule = (tag) => tag !== 'INPUT';
ok('doing it the old way still swallows the space bar in a textarea',
   oldRule('TEXTAREA') === true && oldRule('SELECT') === true && oldRule('BUTTON') === true,
   'the guard was tagName !== INPUT, so every one of these lost the keystroke');
const oldShortcut = (tag) => tag === 'INPUT' || tag === 'TEXTAREA';
ok('and still lets Delete through a focused dropdown',
   oldShortcut('SELECT') === false,
   'which is how Delete on a font picker deleted the widget');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
