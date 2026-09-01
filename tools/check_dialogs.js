/* The dash editor's own dialogs — the two that shipped as browser dialogs,
 * and the markup they write somebody's typing into.
 *
 * ADR-0016 converted all nineteen confirm() guards in the editor and left
 * prompt() alone, on the understanding that it "opened nothing". It is worse
 * than that. Measured 2026-09-02 against the dev build over CDP: window.prompt
 * in the Tauri webview is the webview's own (`function prompt() { [native
 * code] }`, not the dialog plugin's shim), the webview does not implement it,
 * and the call NEVER RETURNS. After it, `Runtime.evaluate` of `1+1` in the
 * same page never answered again, and EnumWindows over the process found no
 * dialog window of any kind — one Tauri Window and three hidden IME helpers.
 * The editor freezes where it stands and Task Manager is the way out.
 *
 * Two shipped controls did this, both of them ordinary:
 *   - the layout menu's "New dashboard…"  (layoutEditorNew)
 *   - "Custom…" in a channel's unit list  (_chUnitSelect)
 *
 * The replacement is promptAsync(), which wraps the editor's own overlay the
 * way confirmAsync() wraps the confirm one. And because that overlay now
 * carries free text — a unit label is allowed to be °F/min or in-lb — the
 * markup around it has to escape, which the unit field never did.
 *
 * What is pinned here:
 *   - neither call site has gone back to the browser dialog
 *   - the overlay has one exit, an onCancel, and a capture-phase key hook
 *   - it finds its own input instead of the first one in the document
 *   - a unit label carrying a quote survives the trip into the markup,
 *     measured by building the field both ways
 *
 *   node tools/check_dialogs.js
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

/* ---- lifting, the same rule as every harness here ----------------------- */
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
function constBlock(name) {
    const re = new RegExp('^        const ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: const ' + name);
    let i = SRC.indexOf('=', m.index) + 1, d = 0, j = i;
    for (; j < SRC.length; j++) {
        const c = SRC[j];
        if (c === '[' || c === '{' || c === '(') d++;
        else if (c === ']' || c === '}' || c === ')') d--;
        else if (c === ';' && d === 0) { j++; break; }
    }
    return SRC.slice(m.index, j);
}

console.log('neither control asks the browser any more');

const newLayout = grab('layoutEditorNew');
/* There are two: the plain one and the ECU-aware override that replaces it.
   grab() finds the first; the override is the one that shipped the bug. */
const overrideAt = SRC.indexOf('layoutEditorNew = async function');
const override = overrideAt < 0 ? '' : SRC.slice(overrideAt, SRC.indexOf('\n        }', overrideAt));
ok('the layout menu\'s New dashboard… is the ECU-aware override', override.length > 200);
ok('and it awaits the editor\'s own prompt', /await promptAsync\(/.test(override),
   'a bare prompt() here freezes the app on the first click of New dashboard…');
ok('nothing in it calls the browser prompt', !/(?:(?<![.\w$])|window\.)prompt\s*\(/.test(override));

const unitSel = grab('_chUnitSelect');
ok('the unit list\'s Custom… awaits the editor\'s own prompt',
   /await promptAsync\(/.test(unitSel));
ok('and asks for it raw', /raw:\s*true/.test(unitSel),
   'the name sanitiser turns °F/min into __F_min — a unit label is not a name');
ok('a cancelled Custom… writes nothing', /if \(typed == null\) \{ _renderChannelDetail\(\); return; \}/.test(unitSel));

console.log('\nthe overlay behaves like the confirm one');
const overlay = grab('_showPromptOverlay');
ok('there is a promise form', /function promptAsync\s*\(/.test(SRC));
ok('cancelling resolves rather than vanishing', /_opts\.onCancel/.test(overlay),
   'without a cancel callback, promptAsync would never settle and the ' +
   'caller would wait forever on a dialog the user already dismissed');
ok('every exit goes through one close()', /const close = \(value\) =>/.test(overlay) &&
   /if \(!overlay\.parentNode\) return;/.test(overlay));
ok('the key hook is registered at capture and removed on the way out',
   /addEventListener\('keydown', onKey, true\)/.test(overlay) &&
   /removeEventListener\('keydown', onKey, true\)/.test(overlay),
   'the editor has its own Escape — deselect, close the modal — and it must ' +
   'not fire behind the dialog');
ok('Escape and Enter are both answered', /e\.key === 'Escape'/.test(overlay) &&
   /e\.key === 'Enter'/.test(overlay));
ok('the backdrop closes on mousedown, not click', /addEventListener\('mousedown'/.test(overlay) &&
   !/addEventListener\('click'/.test(overlay),
   'a click that STARTED on the input and ended on the backdrop is not a dismissal');
/* The id → class change. Two of these can be open at once — a prompt raised
   from a modal that is itself one — and getElementById handed the second
   overlay the first one's input box. */
ok('it finds its own controls, not the document\'s first',
   /overlay\.querySelector\('\._promptInput'\)/.test(overlay) &&
   !/getElementById\('_promptInput'\)/.test(overlay));

console.log('\na unit label carrying a quote, built both ways');

/* Lift the field builder and the conversion table it reads. No DOM needed:
   the question is what STRING comes out. */
const sandbox = new Function(
    constBlock('_UNIT_CONVS') + '\n' +
    grab('_chUnitOptions') + '\n' +
    grab('_chUnitFieldHTML') + '\n' +
    'return { _chUnitFieldHTML: _chUnitFieldHTML, _chUnitOptions: _chUnitOptions };')();

/* The attribute a browser would actually read: everything up to the next
   double quote. That is the whole bug — the old template ended the value
   early and spilled the rest of the label into the tag as attributes. */
function attrValue(html, attr) {
    const m = new RegExp(attr + '="([^"]*)"').exec(html);
    return m ? m[1] : null;
}

const LABEL = 'deg "C"/s';
const conv = { id: 'clt', units_native: '°C', units_display: LABEL };
const plain = { id: 'x', units_native: 'widgets', units_display: LABEL };

const gotConv = sandbox._chUnitFieldHTML(conv);
const gotPlain = sandbox._chUnitFieldHTML(plain);

ok('a convertible channel gets a list', /^<select/.test(gotConv.trim()),
   'expected the °C → °F/K list; got ' + gotConv.slice(0, 60));
ok('and an unconvertible one gets a box', /^<input/.test(gotPlain.trim()));

/* The measurement: the label comes back whole. The custom entry is the one
   labelled "(custom)" — take the <option ...> tag it sits in. */
const customTag = (() => {
    const end = gotConv.indexOf('(custom)');
    if (end < 0) return '';
    return gotConv.slice(gotConv.lastIndexOf('<option', end), end);
})();
ok('the custom entry keeps the whole label',
   attrValue(customTag, 'value') === 'deg &quot;C&quot;/s',
   'option value read back as ' + JSON.stringify(attrValue(customTag, 'value')) +
   ' from ' + JSON.stringify(customTag.slice(0, 80)));
ok('so does the free-text box', attrValue(gotPlain, 'value') === 'deg &quot;C&quot;/s',
   'read back ' + JSON.stringify(attrValue(gotPlain, 'value')));

/* And the same two templates without the escaping, which is what shipped —
   pinned so this stays a test of something real. */
const oldOption = '<option value="' + LABEL + '" selected>' + LABEL + ' (custom)</option>';
const oldInput = '<input type="text" value="' + LABEL + '" placeholder="unit">';
ok('doing it the old way cuts the label at the first quote',
   attrValue(oldOption, 'value') === 'deg ' && attrValue(oldInput, 'value') === 'deg ',
   'old option read back as ' + JSON.stringify(attrValue(oldOption, 'value')));
ok('and leaves the rest of it loose in the tag',
   oldOption.indexOf('value="deg "C"/s"') > -1 && oldInput.indexOf('value="deg "C"/s"') > -1,
   'the tail after the truncated value parses as further attributes');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
