/* Every inline handler in the built page, and whether it can actually run.
 *
 * The built page has two big scripts and they follow different rules:
 *
 *   script #2  the tauri overlay, wrapped in (function () { ... })().
 *              A `function caRender()` in here is PRIVATE. An inline handler
 *              -- onclick, oninput, onchange -- is evaluated in global scope,
 *              so it can only reach names assigned as `window.caRender = ...`.
 *   script #3  the firmware base, not wrapped. Its top-level functions ARE
 *              global, which is why the same markup pattern works there.
 *
 * That asymmetry is a trap, and it caught one: the CAN analyser's filter box
 * carried oninput="caRender()" while caRender lived only inside the IIFE. Every
 * keystroke threw ReferenceError, and because the frame poll re-renders anyway
 * the box looked like it worked -- until you paused, where nothing re-renders
 * and the filter did nothing at all.
 *
 * A control that names something unreachable is dead, and dead silently: the
 * exception goes to a console nobody has open.
 *
 *   node tools/check_controls.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const DIST = path.join(ROOT, 'src/dist/index.html');

if (!fs.existsSync(DIST)) {
    console.log('src/dist/index.html is not built — run tools/merge_overlay.py first');
    process.exit(1);
}
const src = fs.readFileSync(DIST, 'utf8');

/* ---- the script blocks, and which of them are sealed ------------------- */
const blocks = [];
{
    const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(src))) {
        const body = m[1], t = body.trim();
        blocks.push({
            from: m.index, to: m.index + m[0].length, body: body,
            /* `(function () { ... })()` and friends. Anything declared inside
               is unreachable from an HTML attribute. */
            sealed: /^[;\s]*[(!+]\s*(?:async\s+)?function\s*\**\s*\(/.test(t) ||
                    /^[;\s]*\(\s*\(\s*\)\s*=>/.test(t)
        });
    }
}
const openCode = blocks.filter(b => !b.sealed).map(b => b.body).join('\n');
const sealedCode = blocks.filter(b => b.sealed).map(b => b.body).join('\n');

/* ---- what an inline handler can actually reach ------------------------ */
const reachable = new Set();
/* explicit exports, wherever they are */
for (const m of src.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=/g)) reachable.add(m[1]);
/* declarations in the UNSEALED scripts: those really are globals */
for (const m of openCode.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) reachable.add(m[1]);
for (const m of openCode.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/g))
    reachable.add(m[1]);
/* declared ONLY inside the seal — the trap this harness exists for */
const privateNames = new Set();
for (const m of sealedCode.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g))
    if (!reachable.has(m[1])) privateNames.add(m[1]);

/* Things the browser provides, plus keywords a handler body can contain. */
const HOST = new Set(`alert confirm prompt event window document console setTimeout
clearTimeout setInterval clearInterval JSON Math Number String Boolean Array Object
Date parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent
localStorage sessionStorage fetch Promise requestAnimationFrame navigator location
history URL Blob FormData Set Map WeakMap Symbol RegExp Error TypeError
if for while switch return typeof function catch try new delete void else do
var let const break continue throw class super import export in of instanceof`.split(/\s+/));

/* ---- every inline handler in the page --------------------------------- */
/* Block comments first: this file documents its own markup, and an example
   in a comment is not a control. */
const scrubbed = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

const EVENTS = 'click|change|input|submit|keydown|keyup|keypress|blur|focus|dblclick|' +
               'contextmenu|wheel|mousedown|mouseup|mouseover|mouseout|pointerdown|' +
               'pointerup|drop|dragover|dragstart|dragend|load|error|paste|toggle|scroll';
const attr = new RegExp('\\son(' + EVENTS + ')\\s*=\\s*(["\'])([\\s\\S]*?)\\2', 'g');
const call = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;

const uses = new Map();
let m;
while ((m = attr.exec(scrubbed))) {
    const body = m[3];
    const line = scrubbed.slice(0, m.index).split('\n').length;
    let c;
    call.lastIndex = 0;
    while ((c = call.exec(body))) {
        const fn = c[2];
        if (HOST.has(fn)) continue;
        /* `"... + gpEsc(id) + ..."` is string building at RENDER time, inside
           the code that owns the name — not a call the browser will make when
           the control is used. Told apart by the concatenation operator that
           has to sit immediately before it. */
        if (/\+\s*$/.test(body.slice(0, c.index + c[1].length))) continue;
        if (!uses.has(fn)) uses.set(fn, []);
        uses.get(fn).push({ ev: 'on' + m[1], line: line,
                            body: body.replace(/\s+/g, ' ').slice(0, 80) });
    }
}

let pass = 0, fail = 0;
const ok = (what, cond, detail) => {
    if (cond) { pass++; console.log('  ok   ' + what); }
    else { fail++; console.log('  FAIL ' + what + (detail ? '\n         ' + detail : '')); }
};

console.log('the built page');
ok('has an unsealed script (the firmware base)', openCode.length > 100000,
   openCode.length + ' chars');
ok('has a sealed one (the tauri overlay)', sealedCode.length > 100000,
   sealedCode.length + ' chars');
console.log('       ' + uses.size + ' distinct handler names in markup, ' +
            reachable.size + ' names reachable from an attribute, ' +
            privateNames.size + ' sealed inside the overlay');

console.log('\nevery inline handler names something an attribute can reach');
const dead = [...uses.keys()].filter(n => !reachable.has(n)).sort();
const sealedDead = dead.filter(n => privateNames.has(n));
const missing = dead.filter(n => !privateNames.has(n));

ok('none is sealed inside the overlay IIFE',
   sealedDead.length === 0,
   sealedDead.map(n => n + ' — defined only inside (function(){…})(), used at ' +
       uses.get(n).map(u => u.ev + ' line ' + u.line).join(', ') +
       '\n           add "window.' + n + ' = ' + n + ';" beside the other exports')
       .join('\n         '));

ok('none is undefined everywhere',
   missing.length === 0,
   missing.map(n => n + ' — not defined anywhere; used at ' +
       uses.get(n).map(u => u.ev + ' line ' + u.line).join(', ') +
       '\n           ' + uses.get(n)[0].body).join('\n         '));

/* A control the harness itself could stop seeing is worse than no harness, so
   assert it is still looking at a real page with real controls in it. */
console.log('\nthe harness is still looking at something');
ok('found a workable number of handlers', uses.size > 300, String(uses.size));
ok('found the GPS workspace controls', uses.has('gpSetView'));
ok('found the CAN analyser controls', uses.has('caSetMode') || uses.has('caShowAll'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
