/* The working panel (ADR-0061): who gets the room, and what follows you.
 *
 * Analyse draws four instruments at once on a screen that fits about two.
 * Measured on a 1366 x 768 laptop — MoTeC i2's own stated minimum, so the
 * machine this class of software is expected to run on — the quad arrangement
 * wanted 756 px in a 626 px port and the page scrolled. Every panel was drawn
 * as if it were the one being read: full controls in each header, an equal
 * share of the height, and a bottom bar saying the same six numbers whatever
 * you were doing.
 *
 * So one panel is the WORKING panel — the last one you clicked. It wears its
 * own controls, the height is spent on it, and the bar along the bottom
 * belongs to it. What is pinned here is the part a later change could quietly
 * undo:
 *
 *   - a spine that already fits is NEVER re-sized (no layout that jumps
 *     around on a big screen for nothing)
 *   - a row you dragged by hand gives nothing back
 *   - nothing is ever pushed below its floor, and what cannot be covered
 *     still scrolls rather than being hidden
 *   - the focus is resolved against the tree on screen, not trusted from
 *     a remembered id
 *   - clicking a panel cannot rebuild the mosaic under the pointer
 *   - the bottom bar carries the timeline only when there is film
 *
 *   node tools/check_focus.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

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

const F = new Function(`
    ${grabFrom(SRC, 'gpSpineFocus')}
    return { focus: gpSpineFocus };
`)();

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
};
const sum = a => a.reduce((x, y) => x + y, 0);
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.5 : tol);
const nohold = n => new Array(n).fill(false);

/* ---- the measured case, which is the reason this exists ---------------- */
/* The real numbers off a 1366 x 768 window with the quad arrangement open:
   a 397 px row of instruments over a 349 px row of documents, in 616 px. */
console.log('the laptop case: 746 px of rows in a 616 px window');
{
    const sz = [397, 349], mins = [150, 150];
    const top = F.focus(sz, mins, nohold(2), 616, 0);
    ok('working in the map, the map row keeps all 397 px', near(top[0], 397), 'got ' + top[0]);
    ok('and the documents give the 130 px difference', near(top[1], 219), 'got ' + top[1]);
    ok('the whole spine now fits, so nothing scrolls', near(sum(top), 616));

    const bot = F.focus(sz, mins, nohold(2), 616, 1);
    ok('working in the report, the report row keeps all 349 px', near(bot[1], 349), 'got ' + bot[1]);
    ok('and the instruments give instead', near(bot[0], 267), 'got ' + bot[0]);
    ok('it fits either way', near(sum(bot), 616));
}

/* ---- what it must NOT do ---------------------------------------------- */
console.log('\na spine that already fits is left exactly alone');
{
    const sz = [300, 200], mins = [150, 150];
    const out = F.focus(sz, mins, nohold(2), 700, 0);
    ok('no row moves by a pixel', near(out[0], 300) && near(out[1], 200),
       'got [' + out.join(', ') + ']');
    /* The point of this rule: on a big screen clicking around the mosaic must
       not shuffle it. A layout that rearranges itself on every click is worse
       than one that sits still. */
    const same = F.focus(sz, mins, nohold(2), 700, 1);
    ok('and it does not matter which panel you clicked',
       near(same[0], 300) && near(same[1], 200));
}
{
    const exact = F.focus([300, 300], [150, 150], nohold(2), 600, 0);
    ok('a spine that fits EXACTLY is not touched either',
       near(exact[0], 300) && near(exact[1], 300));
}

console.log('\na row you dragged by hand gives nothing');
{
    /* Held rows are ADR-0043's promise from the other direction: a height you
       asked for, which quietly taking back is the same lie as quietly
       ignoring one. */
    const out = F.focus([400, 300, 300], [150, 150, 150], [false, true, false], 700, 0);
    ok('the held row keeps its exact height', near(out[1], 300), 'got ' + out[1]);
    ok('the whole shortfall comes off the unheld one', near(out[2], 0 + 150), 'got ' + out[2]);
    ok('and the working row is still whole', near(out[0], 400));
}
{
    const out = F.focus([400, 300], [150, 150], [false, true], 500, 0);
    ok('every other row held means nothing can move at all',
       near(out[0], 400) && near(out[1], 300), 'got [' + out.join(', ') + ']');
    ok('so the spine still overflows, honestly', sum(out) > 500);
}

console.log('\nnothing is pushed below its floor');
{
    /* 1000 px of rows in 400: the two giving rows can only reach their floors,
       and what is left over has to keep scrolling rather than be hidden. */
    const out = F.focus([400, 300, 300], [150, 150, 150], nohold(3), 400, 0);
    ok('the givers stop at their floor', near(out[1], 150) && near(out[2], 150),
       'got [' + out.join(', ') + ']');
    ok('the working row is untouched', near(out[0], 400));
    ok('what could not be covered still scrolls', sum(out) > 400);
}
{
    const out = F.focus([500, 160], [150, 150], nohold(2), 400, 0);
    ok('a row already at its floor gives nothing more', near(out[1], 150), 'got ' + out[1]);
}

console.log('\nthe shortfall is shared out in proportion to what each row can spare');
{
    /* 900 in 700: 200 to find, from rows with 150 and 50 to give. */
    const out = F.focus([300, 300, 300], [150, 250, 150], nohold(3), 700, 0);
    /* Row 1 has 50 px above its floor, row 2 has 150 — so row 2 pays three
       quarters of the 200 and row 1 the rest. */
    ok('the roomier row gives three times as much',
       near(out[1], 250) && near(out[2], 150), 'got [' + out.join(', ') + ']');
    ok('and together they cover it exactly', near(sum(out), 700));
}

console.log('\nno working panel, no change');
{
    const out = F.focus([400, 400], [150, 150], nohold(2), 500, -1);
    ok('an unresolved focus leaves the spine as it was',
       near(out[0], 400) && near(out[1], 400));
    const gone = F.focus([400, 400], [150, 150], nohold(2), 500, 7);
    ok('so does an index off the end of the spine',
       near(gone[0], 400) && near(gone[1], 400));
}

/* ---- the wiring, which arithmetic cannot check ------------------------- */
console.log('\nthe wiring');
ok('the measurement pass asks for it',
   /root\.sz = gpSpineFocus\(root\.sz, mins, held, avail, gpFocusRow\(root\)\)/.test(SRC),
   'gpGridLayout has to be where this happens — it is the one place row heights are decided');
ok('and only when the option is on',
   /if \(gpFocusOpt\(\)\.size\)\s*\n\s*root\.sz = gpSpineFocus/.test(SRC),
   'a layout that moves under you must be switchable off');

ok('the focus is resolved against the tree on screen',
   /function gpFocusNode\(\)[\s\S]{0,700}gpNodeLeaves\(root\)/.test(SRC),
   'panel ids are renumbered on load (gpNodeReseq), so a remembered id is only ' +
   'good within one arrangement');
ok('an instrument is the fallback, not the first panel in the tree',
   /leaves\.filter\(gpNodeElastic\)\[0\] \|\| leaves\[0\]/.test(SRC));
ok('the grid resolves it before it draws',
   /gpFocusNode\(\);\s*\n\s*\n?\s*\/\* Pull the hosted singletons/.test(SRC),
   'otherwise the mosaic renders with no working panel and the bar has nothing to follow');

ok('clicking a panel does NOT re-render the mosaic',
   /window\.gpFocusSet = function[\s\S]{0,900}gpFocusPaint\(\)/.test(SRC) &&
   !/window\.gpFocusSet = function[\s\S]{0,900}gpRenderGrid\(\)/.test(SRC),
   'the gesture is a pointerdown; rebuilding the grid under a pressed finger ' +
   'destroys the element the click was going to land on');
ok('the click listener is bound once, on the host, in capture',
   /_gpFocusBound[\s\S]{0,400}addEventListener\("pointerdown"[\s\S]{0,400}, true\)/.test(SRC),
   'Leaflet and the video element both swallow events on the way up, and the ' +
   'panels are replaced on every render while #gpGrid is not');
ok('filling the window with a panel also makes it the working one',
   /if \(want\) gp\.focus = want;/.test(SRC),
   'otherwise the panel filling the screen is the one with its controls hidden');

console.log('\nthe bottom bar follows the working panel');
ok('there is a context for it', /function gpDockCtx\(\)/.test(SRC));
ok('it is the video panel that changes it',
   /gpDockCtx[\s\S]{0,400}n\.type !== "video"[\s\S]{0,200}return "readouts"/.test(SRC));
ok('and only when there is film to show',
   /gpClips\(\)\.length \|\| \(gp\.video && gp\.video\.url\)\) \? "video" : "readouts"/.test(SRC),
   'an empty ruler where six live numbers used to be is a worse bar');
ok('the timeline it draws is the same one the panel draws',
   /gpb-docktl'>" \+ gpTlHtml\(true\)/.test(SRC),
   'one description of a timeline in the file, rendered twice');
ok('the dock timeline is bound and marked live',
   /if \(ctx === "video"\) \{[\s\S]{0,300}gpTlBind\(\);[\s\S]{0,120}gp\._tlLive = true;/.test(SRC),
   'gpTlSync writes the playhead into every timeline on screen, but only while ' +
   'the flag says one is there');
ok('and the flag is read off the document, not off the mosaic',
   /gp\._tlLive = !!document\.querySelector\("\[data-gp-tl\]"\)/.test(SRC),
   'since the bar can be the only thing carrying a timeline');

console.log('\nonly the working panel wears its own controls');
ok('the mode segments are hidden on the others',
   /#gpWorkspace \.gpb-panel:not\(\.focus\) > \.gpb-phead \.gpb-pseg \{ display: none; \}/.test(SRC),
   'five map modes and three graph modes in every header at once is eight ' +
   'controls competing for a glance, seven of them acting on something else');
ok('but the way OUT of a panel stays on every header',
   /\.gpb-panel:not\(\.focus\) > \.gpb-phead \.gpb-picon \{ opacity/.test(SRC) &&
   !/:not\(\.focus\)[^\n]*\.gpb-pacts \{ display: none/.test(SRC),
   'split, fill and close must never be the part that disappears');
ok('the working panel is marked on its header, not round the whole panel',
   /\.gpb-panel\.focus > \.gpb-phead \{[^}]*inset 3px 0 0 var\(--gpb-red\)/.test(SRC),
   'a red box round a panel at this size reads as an error state');

console.log('\nit can be switched off, where the other height rules are stated');
ok('both toggles are in the Arrange popover',
   /gpFocusSizeSet/.test(SRC) && /gpFocusDockSet/.test(SRC) &&
   /'Working panel'|>Working panel</.test(SRC),
   'a feature that moves the layout under you has to be findable and ' +
   'switchable off in the same breath');
ok('and both are remembered',
   /GP_FOCUS_LS = "rdm7_gp_focus_v1"/.test(SRC) && /function gpFocusOptSave/.test(SRC));
ok('an absent setting reads as ON, not as off',
   /size: !o \|\| o\.size !== false/.test(SRC) && /dock: !o \|\| o\.dock !== false/.test(SRC),
   'a first run should show the feature, not hide it');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
