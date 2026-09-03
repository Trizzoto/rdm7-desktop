/* The lap timer's shell: two bands, four sections, and nothing deleted.
 *
 * One bar was doing navigation, identity, device status and actions at once.
 * When it ran out of room the rule that fired deleted IDENTITY — the circuit
 * name and whose drive it was — so at 1440 px the one fact worth reading was
 * gone and twelve controls remained. The bar is two bands now: the black one
 * carries the app, the device AND what is open, and the light one carries the
 * four sections, this section's views and its actions. One job each, one line
 * each — the height above the data belongs to the data. Identity is back in
 * the black bar, which is only safe because that bar has three controls in it
 * now: it is the flexible thing in there, not the thing that gets pushed out,
 * and gpIdFit decides what gives before anything is clipped.
 *
 * What is pinned here is the part a later change could quietly undo:
 *   - the two bands still exist, in order, and identity is IN the black one
 *   - the black bar has not started collecting controls again
 *   - nothing deletes the session identity at any width
 *   - the four sections still cover every view gpSetView knows
 *   - every handler the generated bars emit is reachable from an attribute
 *   - the page head has not collided with the panel head again
 *
 *   node tools/check_shell.js
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src/tauri-overlay.html'), 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}

/* The workspace's own markup, from its opening div to the body below it. */
const wsStart = SRC.indexOf('<div id="gpWorkspace"');
const wsBody = SRC.indexOf('<div class="ws-body">', wsStart);
const HEAD = SRC.slice(wsStart, wsBody);

console.log('two bands, one job each');
const bands = ['<div class="ws-topbar">', 'class="gpb-id"', '<div class="gpb-nav">', 'class="gpb-subnav"'];
let at = 0, order = true;
bands.forEach(function (b) {
    const i = HEAD.indexOf(b, at);
    if (i < 0) order = false; else at = i;
});
ok('the black bar carrying the identity, then the nav band and its views', order,
   'expected ' + bands.join(' then ') + ' between #gpWorkspace and .ws-body');
/* The band that was deleted, and the reason this file exists: identity rides
   in a bar that is already there, not in a strip of its own above the data. */
const blackBand = HEAD.slice(HEAD.indexOf('<div class="ws-topbar">'),
                             HEAD.indexOf('<div class="gpb-nav">'));
ok('the identity is inside the black bar, not a band of its own',
   /class="gpb-id"/.test(blackBand) && !/class="gpb-page/.test(HEAD),
   'a third band costs ~100 px of height on every screen');
ok('it can flex, so a full bar shortens it instead of deleting it',
   /#gpWorkspace \.gpb-id \{[^}]*flex:\s*1/.test(SRC) &&
   /#gpWorkspace \.gpb-id \{[^}]*min-width:\s*0/.test(SRC),
   'this is the whole difference from #gpCtx, which was flex: none in a nowrap bar');

/* The regression this whole change exists to prevent: the bar filling up
   again. Counting elements rather than characters, because a long comment is
   not clutter and a fifth control is. */
const topStart = HEAD.indexOf('<div class="ws-topbar">');
const topEnd = HEAD.indexOf('<div class="gpb-nav">');
const TOP = HEAD.slice(topStart, topEnd);
const topCtrls = (TOP.match(/<button/g) || []).length;
/* home, the device pill, the gear — and the four parked chips, which are not
   in the bar so much as stored in it (gpDevPop re-parents them into the
   popover). Those four are counted separately below. */
const parked = TOP.slice(TOP.indexOf('id="gpDevHold"'));
const parkedCtrls = (parked.match(/<button/g) || []).length;
ok('the black bar itself carries three controls', topCtrls - parkedCtrls === 3,
   'found ' + (topCtrls - parkedCtrls) + ' — it used to carry twelve, and that is ' +
   'what made it delete the circuit name to fit');
ok('the four device controls are still parked in it', parkedCtrls === 2 &&
   /id="gpChipDev"/.test(parked) && /id="gpChipFix"/.test(parked) &&
   /id="gpChipRec"/.test(parked) && /id="gpConnectBtn"/.test(parked),
   'gpUpdateChips writes to all four by id — they must stay in the document');

console.log('\nnothing deletes the session identity');
/* The two rules that used to fire at 1579 px and 1399 px. A media query that
   hides part of the gpWorkspace chrome is how the old bar coped, and coping
   that way is the bug. */
const gpCss = SRC.slice(SRC.indexOf('GPS workspace — Industry light'), wsStart);
const hides = [];
const mq = /@media[^{]*\{([\s\S]*?)\n        \}/g;
let m;
while ((m = mq.exec(gpCss))) {
    if (/display:\s*none/.test(m[1]) &&
        /\.ws-brand|\.gpb-sesbar|\.gpb-id|\.gpb-secs|\.gpb-subnav/.test(m[1]))
        hides.push(m[0].slice(0, 90).replace(/\s+/g, ' '));
}
ok('no width hides the brand, the page name or the navigation', hides.length === 0,
   hides.join('\n         '));
ok('the session identity is a named strip, not the old bar chip',
   /class="gpb-id"/.test(HEAD) && !/id="gpCtx"/.test(SRC),
   'gpCtx was the chip the bar deleted when it ran out of room; it should be gone');
ok('what does not fit stays readable in the tooltip',
   /el\.title = \[name, meta, tags/.test(SRC) && /function gpIdFit\(/.test(SRC),
   'the line ellipsises and drops its lowest tags, so the whole of it has to ' +
   'live in the tooltip');
ok('the tag that never drops is the session best',
   /for \(i = tags\.length - 1; i >= 1; i--\)/.test(SRC),
   'gpIdFit drops from the right and stops before the first tag');

console.log('\nfour sections, covering every view');
const secBlock = /var GP_SECTIONS = \[([\s\S]*?)\n        \];/.exec(SRC);
ok('GP_SECTIONS is there', !!secBlock);
const known = /var KNOWN = \[([^\]]*)\]/.exec(SRC);
ok('gpSetView still knows its views', !!known);
if (secBlock && known) {
    const KNOWN = known[1].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
    const claimed = [];
    const vre = /views:\s*\[([^\]]*)\]/g;
    let v;
    while ((v = vre.exec(secBlock[1])))
        v[1].split(',').forEach(s => { s = s.trim().replace(/"/g, ''); if (s) claimed.push(s); });
    const ids = (secBlock[1].match(/id:\s*"([a-z]+)"/g) || []).length;
    ok('there are four of them', ids === 4, 'found ' + ids);
    /* Setup is deliberately unclaimed — it is reached from the gear, not from
       a tab, because a 62-control settings page is not a peer of Analyse. */
    const want = KNOWN.filter(k => k !== 'setup').sort();
    ok('every view except Setup belongs to exactly one section',
       claimed.slice().sort().join(',') === want.join(','),
       'sections claim [' + claimed.sort().join(', ') + '], gpSetView knows [' +
       KNOWN.join(', ') + ']');
    ok('Setup is not a section', claimed.indexOf('setup') < 0);
    /* His call, and worth stating so a later tidy-up does not quietly undo it:
       Drift needs an open recording exactly the way Corners does, so by
       structure it belongs under Analyse — and it stays top level anyway. */
    ok('Drift is top level, not a sub-view of Analyse',
       /id:\s*"drift"/.test(secBlock[1]) &&
       !/subs:[^\]]*"drift"/.test(secBlock[1]));
}

console.log('\nevery generated handler is reachable from an attribute');
/* check_controls.js scans onclick ATTRIBUTES. The two bars build their buttons
   in JS, so their handlers are invisible to it — and an unreachable one is a
   button that does nothing at all. Collected from the render functions here
   instead. */
const gen = SRC.slice(SRC.indexOf('var GP_SECTIONS = ['),
                      SRC.indexOf('function gpDevPillSync'));
const names = new Set();
/* Two shapes: written straight into the onclick (gpRenderNav), and carried in
   a `go:` field the sub-tab row interpolates (GP_SECTIONS). */
[/onclick=[\\"']+([a-zA-Z_$][\w$]*)\s*\(/g,
 /\bgo:\s*"([a-zA-Z_$][\w$]*)\s*\(/g].forEach(function (re) {
    let h;
    while ((h = re.exec(gen))) names.add(h[1]);
});
/* and the one hand-written handler inside the generated page head */
names.add('gpSetupDone');
ok('found the generated handlers', names.size >= 4, [...names].join(', '));
const unreachable = [...names].filter(function (n) {
    return !new RegExp('window\\.' + n + '\\s*=').test(SRC);
});
ok('all of them are exported onto window', unreachable.length === 0,
   unreachable.map(n => n + ' — generated into an onclick but never ' +
       'window.' + n + ' = ' + n + ', so the button is dead').join('\n         '));

console.log('\nthe page head is not the panel head');
/* .gpb-phead was already taken — it is the drag header on every Analyse panel.
   Reusing the name gave the page head `display:flex` from the panel rules and
   laid its name, meta line and sub-tabs out side by side in one 48 px strip,
   and pushed the page head's own rules onto every panel in the mosaic. */
ok('the page head has a class of its own', /class="gpb-id"/.test(HEAD));
ok('it does not reuse the panel header class', !/class="gpb-phead/.test(HEAD),
   'gpb-phead is the Analyse panel drag header — see gpRenderGrid');
ok('the page head states its own display',
   /#gpWorkspace \.gpb-id \{[^}]*display:\s*flex/.test(SRC),
   'it is a flex item of the nav band and lays its own contents out in a row');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
