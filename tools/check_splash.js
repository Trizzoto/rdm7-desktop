/* The splash picker's one synthetic entry is a setting, not a splash.
 *
 * `splashSelect` lists the splash screens on the dash and then appends one
 * more option — "Disable (boot straight to dashboard)", value `__disable__` —
 * which turns the splash off entirely. Three places read the picker's value
 * straight as a name and built `'_splash_' + value`, so whenever that entry
 * was the selected one they addressed a splash called `__disable__`:
 *
 *   fetchSplashes      loads `_splash_` + the picker on the way in
 *   loadLayout         re-reads it whenever Splash mode reloads
 *   saveActiveLayout   writes it — this is the one that does damage
 *
 * It is selected in two ordinary situations. fetchSplashes SETS it when the
 * dash reports the splash disabled (`data.enabled === false`) — so turning
 * the splash off, editing, and saving wrote a junk file called
 * `_splash___disable__` to the device and left the splash you meant to edit
 * untouched. And it is the ONLY entry when there are no splashes at all: a
 * fresh dash, or the desktop app offline, where the editor opened Splash mode
 * by trying to load `_splash___disable__`.
 *
 * Seen offline on the dev build: switching to Splash mode with an empty store
 * put `_splash___disable__` in currentLayout.name.
 *
 *   node tools/check_splash.js
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

console.log('the picker still offers it');
ok('the synthetic option is still there', /value = '__disable__'/.test(SRC) &&
   /Disable \(boot straight to dashboard\)/.test(SRC),
   'if it is gone this harness is guarding nothing');

console.log('\none place decides what the picker means');
ok('there is a _splashPickerName', /function _splashPickerName\s*\(/.test(SRC));

const users = ['fetchSplashes', 'loadLayout', 'saveActiveLayout'];
users.forEach(function (fn) {
    const body = grab(fn);
    ok(fn + ' asks it for the name', /_splashPickerName\(/.test(body),
       'it read splashSelect.value directly');
    ok('and does not build a name from the raw value itself',
       !/'_splash_' \+ \(splashSel/.test(body) &&
       !/\(splashDisabled \? null : sel\.value\)/.test(body),
       body.match(/.{0,60}_splash_.{0,60}/) || '');
});

/* The protected-name check lists siblings to avoid colliding with, and the
   synthetic entry is not one of them. */
const resolve = grab('_resolveProtectedName');
ok('the name-collision list skips it too',
   /filter\(o => o\.value !== '__disable__'\)/.test(resolve));

console.log('\nrun it');
const pick = new Function('document',
    grab('_splashPickerName') + '\n return _splashPickerName;');
const withValue = (v) => pick({ getElementById: () => (v === null ? null : { value: v }) });

ok('a real splash comes back as itself', withValue('Boot')('x') === 'Boot');
ok('the synthetic entry never becomes a name',
   withValue('__disable__')() === 'Default',
   'got ' + JSON.stringify(withValue('__disable__')()));
ok('and falls back to what the dash says is active when there is one',
   withValue('__disable__')('Startup') === 'Startup');
ok('an empty picker falls back too', withValue('')() === 'Default');
ok('a missing picker does not throw', withValue(null)() === 'Default');

/* The old expression, so this stays a test of something real. */
const oldWay = (sel, fallback) => (sel && sel.value ? sel.value : (fallback || 'Default'));
ok('doing it the old way still addresses a splash called __disable__',
   '_splash_' + oldWay({ value: '__disable__' }) === '_splash___disable__',
   'that is the file saveActiveLayout wrote to the device');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
