/* The dash editor's brand shell, and the contract it depends on.
 *
 * The lap timer and the keypad wear the brand because their markup was
 * rewritten. The editor's could not be: it is the firmware's own page, synced
 * verbatim from RDM-7_Dash/main/web/index.html, and ADR-0007 forbids editing
 * it here. So the shell is built at runtime by the overlay and the firmware
 * header's controls are MOVED into it.
 *
 * That works, and it has exactly one failure mode, which is silent: the
 * overlay moves controls BY ID, and a firmware re-sync can rename one, drop
 * one, or wrap one in something new. Nothing throws. `_dsbMove` on a missing
 * element is a no-op, so the control simply stays behind in a header that is
 * `display: none` — and the editor loses its Save button, or its connection
 * picker, with no error anywhere. You would find out when somebody could not
 * save.
 *
 * So this harness is mostly a drift detector against the firmware base:
 * every id the shell reaches for has to still be there, the two structural
 * assumptions (no JS depends on header ancestry; the mode is readable from a
 * class) have to still hold, and the theme class has to be cleared on every
 * path that leaves the editor.
 *
 *   node tools/check_dash.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const OVERLAY = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');
const BASE = fs.readFileSync(path.join(ROOT, 'src/firmware-base.html'), 'utf8');
/* The shell moves controls from BOTH sources — the mode switcher and the
   layout pickers are the firmware's, while the connection bar and the
   save-state pill are the overlay's own additions. So "does this control
   exist" is a question about the BUILT page, not about either half. */
const DIST_PATH = path.join(ROOT, 'src/dist/index.html');
if (!fs.existsSync(DIST_PATH)) {
    console.log('src/dist/index.html is not built — run tools/merge_overlay.py first');
    process.exit(1);
}
const DIST = fs.readFileSync(DIST_PATH, 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}
/* Comments carry the reasoning and name the things they describe; searching
   them alongside the code makes "we no longer do X" checks fail on their own
   explanation. Same scrub, same reason, as check_controls.js. */
const scrub = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const CODE = scrub(OVERLAY);

console.log('the shell exists and is built from the overlay');
ok('there is a build step', /function _dsbBuild\s*\(/.test(CODE));
ok('it moves rather than copies', /function _dsbMove\s*\(/.test(CODE) &&
   /into\.appendChild\(el\)/.test(CODE));
/* Two bands, not three: the page band was merged into the tab row (its
   headline only ever restated the active tab). The tools and the save-state
   group are still built here, they just live in the nav now. */
ok('the two bands are built', /className = "dsb-bar"/.test(CODE) &&
   /className = "dsb-nav"/.test(CODE));
ok('the page band is gone, not orphaned', !/className = "dsb-page"/.test(CODE) &&
   !/\.dsb-page/.test(OVERLAY),
   'a leftover .dsb-page rule means the merge was half-done');
ok('its two groups moved into the tab row',
   /tools\.className = "dsb-tools"/.test(CODE) && /act\.className = "pact"/.test(CODE) &&
   /nav\.appendChild\(tools\)/.test(CODE) && /nav\.appendChild\(act\)/.test(CODE));
ok('it is idempotent', /_dsbBuilt/.test(CODE) && /if \(_dsbBuilt\) return;/.test(CODE));

/* ---- the re-parenting contract ---------------------------------------- */
console.log('\nevery control the shell moves still exists in the firmware base');
/* Pulled out of the overlay rather than typed here, so adding a control to
   the shell automatically adds it to what this checks. */
const moved = new Set();
for (const m of CODE.matchAll(/_dsbMove\(byId\("([A-Za-z0-9_]+)"\)/g)) moved.add(m[1]);
for (const m of CODE.matchAll(/\[([^\]]*)\]\s*\.forEach\(function \(id\) \{ _dsbMove\(byId\(id\)/g))
    for (const q of m[1].matchAll(/"([A-Za-z0-9_]+)"/g)) moved.add(q[1]);

ok('the harness found the moved ids', moved.size >= 15, moved.size + ' found');
const missing = [...moved].filter(id => !new RegExp('id="' + id + '"').test(DIST));
ok('all of them are in the built page', missing.length === 0,
   missing.join(', ') + '\n         — _dsbMove no-ops on a missing element, so the control stays ' +
   'in the hidden header with nothing thrown');
/* Of those, the ones that come from the FIRMWARE are the drift risk: a
   re-sync can rename them and this repo would never know. */
const fromFirmware = [...moved].filter(id => new RegExp('id="' + id + '"').test(BASE));
ok('most of them come from the firmware base, and are still there',
   fromFirmware.length >= 12, fromFirmware.length + ' of ' + moved.size);

/* The two that are matched structurally rather than by id. */
ok('the header still has a .header-toggles group', /class="header-toggles"/.test(BASE));
ok('the header still has a .top-controls row', /class="top-controls"/.test(BASE));
ok('undo and redo still carry the glyphs the shell matches on',
   BASE.indexOf('↶') > -1 && BASE.indexOf('↷') > -1,
   'the overlay finds them by glyph because the firmware gives them no id');
ok('the mode buttons still carry data-mode',
   /class="studio-mode-btn"[^>]*data-mode="setup"/.test(BASE) &&
   /data-mode="channels"/.test(BASE) && /data-mode="design"/.test(BASE));

/* ---- the two structural assumptions ------------------------------------ */
console.log('\nthe assumptions that make re-parenting safe');
{
    /* Re-parenting breaks anything that walks up to <header>. Nothing did
       when this was written; a re-sync could add one, and this is the only
       thing that would notice. */
    const js = scrub(BASE);
    const anc = [
        ...js.matchAll(/closest\(\s*['"]header/g),
        ...js.matchAll(/querySelector(?:All)?\(\s*['"]header[\s.>#[]/g),
    ].map(m => js.slice(Math.max(0, m.index - 50), m.index + 40).replace(/\s+/g, ' '));
    ok('no firmware JS reaches for a control through <header>', anc.length === 0,
       anc.join('\n         '));
}
/* The overlay no longer tracks the mode in JS at all — the headline that
   needed it went with the page band, and what is left (hiding the canvas
   tools outside Design) is CSS on the body class. The rule that mattered
   still holds: never wrap the firmware's own setStudioMode, because a
   re-sync drops the wrapper and nothing tells you. */
ok('the firmware’s own function is not wrapped', !/setStudioMode\s*=/.test(CODE),
   'wrapping setStudioMode would be dropped by the next sync');
ok('the firmware still toggles the body class the CSS depends on',
   /classList\.add\('studio-' \+ mode\)/.test(BASE));
ok('and the overlay still styles off that class',
   /body\.dsb-on\.studio-setup .dsb-tools/.test(OVERLAY));

/* ---- the theme class ---------------------------------------------------- */
console.log('\nthe light theme is on only while the editor is');
ok('it goes on when the editor opens',
   /_suiteOpenDash = function[\s\S]{0,400}_dsbOn\(true\)/.test(CODE));
ok('it comes off on the way Home',
   /_suiteHomeShow = function[\s\S]{0,300}_dsbOn\(false\)/.test(CODE));
ok('and on the way into any workspace',
   /function _wsCloseAll[\s\S]{0,900}_dsbOn\(false\)/.test(CODE),
   'every workspace open routes through _wsCloseAll');
/* The analyzer and the IO expander never joined the brand and do not re-bind
   these tokens for themselves, so a class left on by some path nobody thought
   of would half-convert them. They are pinned instead of trusted. (Home used
   to be in this list; it binds for itself now.) */
ok('the workspaces that do not re-bind are pinned',
   /body\.dsb-on #caWorkspace, body\.dsb-on #ioWorkspace/.test(OVERLAY));
ok('and Home binds for itself instead of being pinned',
   /#suiteHome \{[\s\S]{0,700}--panel: var\(--ind-surface\)/.test(OVERLAY));
ok('the two that do re-bind still do',
   /#gpWorkspace \{[\s\S]{0,1600}--gpb-ink:/.test(OVERLAY) &&
   /#kpWorkspace \{[\s\S]{0,1600}--gpb-ink:/.test(OVERLAY));

/* ---- what the re-parent costs ------------------------------------------- */
console.log('\nthe styling the moved controls lost is restated');
/* `header .header-pill, header .btn, header select` set the height and
   padding that made the row line up. Moved out, they match none of it. */
ok('the bands restate the control sizing',
   /\.dsb-navacts \.btn \{[^}]*height: 28px/.test(OVERLAY) &&
   /\.dsb-tools select, body\.dsb-on \.dsb-tools \.btn,[\s\S]{0,120}height: 28px/.test(OVERLAY));
ok('the mode buttons are restyled as tabs, not left as a segmented switch',
   /\.dsb-nav \.studio-mode-btn \{[^}]*text-transform: uppercase/.test(OVERLAY));
ok('the active tab is underlined in the brand red',
   /\.dsb-nav \.studio-mode-btn\.active \{[^}]*border-bottom-color: var\(--accent\)/.test(OVERLAY));
ok('Setup and Channels do not show the canvas tools',
   /body\.dsb-on\.studio-setup \.dsb-tools[\s\S]{0,80}display: none/.test(OVERLAY));

/* ---- the polish pass, where it leans on firmware markup ------------------ */
console.log('\nthe polish rules that depend on firmware markup');
/* Both of these reach into the firmware's own structure and go quietly
   inert if it changes: the Channels title is sized away by a selector that
   assumes a first-child span with an inline font-size, and the align bar is
   restyled by class name. Neither breaks anything when it stops matching —
   the page just goes back to saying Channels twice, or to a light strip
   sandwiched between two seams. */
ok('the Channels topbar still has the title span the hide targets',
   /<div class="ch2-topbar">\s*<span[^>]*>Channels <span id="chCount"/.test(BASE),
   'the title-hide selector expects .ch2-topbar > span:first-child holding #chCount');
ok('and the hide outranks the inline font-size it has to beat',
   /\.ch2-topbar > span:first-child \{ font-size: 0 !important; \}/.test(OVERLAY));
/* The stage colour is --ind-stage now, not the literal it used to be — the
   point of the check is that the align bar still gets the dark stage, by
   whichever name. */
ok('the align bar still carries the class the stage restyle targets',
   /class="align-bar"/.test(BASE) &&
   /body\.dsb-on \.align-bar \{[^}]*var\(--ind-stage\)/.test(OVERLAY));
ok('the accordion summary the dark smear is lifted from still exists',
   /\.inspector-accordion > summary \{/.test(BASE) &&
   /body\.dsb-on \.inspector-accordion > summary \{[^}]*background: transparent/.test(OVERLAY));

/* ---- one palette, three scopes ------------------------------------------ */
console.log('\nthe palette is defined once');
/* The light end used to be copied into #gpWorkspace, #kpWorkspace and
   body.dsb-on. The day it had to move (white → grey) that was three edits
   that had to agree. It lives in :root now; a scope that goes back to a
   literal is a scope that will be left behind next time. */
ok('there is a shared --ind-* palette', /:root \{[^}]*--ind-bg:[^}]*--ind-surface:/.test(OVERLAY));
['#gpWorkspace', '#kpWorkspace', 'body.dsb-on'].forEach(function (scope) {
    /* The lap timer's block opens with two paragraphs of comment, so the
       window has to be generous; the lazy quantifier still stops at the
       first closing brace on its own line. */
    const re = new RegExp(scope.replace(/[.#]/g, '\\$&') + ' \\{([\\s\\S]{0,4000}?)\\n        \\}');
    const m = re.exec(OVERLAY);
    ok(scope + ' takes its ground and surface from it',
       !!m && /--bg:\s*var\(--ind-/.test(m[1]) && /--panel:\s*var\(--ind-/.test(m[1]) &&
       !/--bg:\s*#|--panel:\s*#/.test(m[1]),
       m ? 'a literal colour crept back into ' + scope : scope + ' block not found');
});
ok('and it is grey, not white', /--ind-surface:\s*#[0-9a-e]/.test(OVERLAY) && !/--ind-surface:\s*#f{3,6}\b/i.test(OVERLAY));

/* ---- the editor is never reached without the shell ---------------------- */
console.log('\nthere is one way in');
ok('boot lands on Home, not in the editor',
   /function bootSuite[\s\S]{0,4000}window\._suiteHomeShow\(\);/.test(CODE));
ok('and the editor is only opened by _suiteOpenDash',
   (CODE.match(/_suiteOpenDash/g) || []).length >= 2);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
