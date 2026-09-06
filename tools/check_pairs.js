/* Two lists that have to agree, and nothing making them (ADR-0066).
 *
 * This is a bug CLASS, not a bug. The Setup rail was a list of section names
 * written out BESIDE the sections, matched to them by POSITION, with a comment
 * above it saying so and warning that Channels had already gone missing once.
 * By 2026-09-04 it named nine of thirteen — "Car icon", "Recording" and
 * "What's on the bus" had never been added — so every entry below Display
 * scrolled to the wrong card, and clicking "Camera" took you to Mounting.
 * Nothing failed, nothing logged, and the file the rail lives in never
 * changed: the drift came entirely from OTHER code growing a group.
 *
 * The rail is built from the headings now and cannot drift again. What this
 * file does is stop the next one: every place where a list in one part of the
 * app has to line up with a list somewhere else, checked from the source.
 *
 * A pairing belongs here when getting it wrong is SILENT. A mismatch that
 * throws does not need a test; a mismatch that quietly points a menu at the
 * wrong thing does.
 *
 *   node tools/check_pairs.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

/* ══ the Setup rail ══════════════════════════════════════════════════════ */
console.log('the Setup rail names the sections that exist');
{
    /* The rule, not the list: the rail must be DERIVED. A hardcoded array of
       names here is the thing that drifted, so what is checked is that there
       isn't one — any future edit that reintroduces it fails this. */
    const railFn = /if \(gp\.view === "setup"\) \{([\s\S]*?)\n                return;/.exec(SRC);
    ok('the setup branch of the rail is still findable', !!railFn);
    if (railFn) {
        const body = railFn[1];
        ok('it reads the groups off the page rather than listing them',
           /querySelectorAll\("#gpSetup \.ws-grp"\)/.test(body),
           'a list written beside the sections is matched to them by position, and ' +
           'every group added elsewhere silently shifts it');
        ok('…and takes each name from that group\'s own heading',
           /\.ws-gt/.test(body) && /nodeType === 3/.test(body),
           'the heading also carries a tip lamp, so textContent would drag its ' +
           'whole tooltip into the rail');
        ok('there is no hardcoded name list left in it',
           !/\["Display",/.test(body) && !/\["Mounting",/.test(body),
           (/\[\["?\w+"?,[\s\S]{0,60}/.exec(body) || [''])[0]);
    }
    /* And the other half: whatever renders Setup has to tell the rail, because
       the rail can be built before the groups exist. */
    ok('Setup rebuilds the rail once its groups are in the document',
       /box\.innerHTML = h;[\s\S]{0,400}gp\.view === "setup"[\s\S]{0,80}gpBuildRail\(\)/.test(SRC),
       'on the first entry to Setup the rail is built before gpRenderSetup has run, ' +
       'so without this it comes out empty');
}

/* ══ the panel registry ══════════════════════════════════════════════════ */
console.log('\nevery panel type can be rendered');
{
    /* GP_PTYPES is the menu. The renderer is a chain of `p.type === "x"`.
       A type in the menu with no branch renders an empty panel; a branch with
       no menu entry is unreachable. Both are silent. */
    const reg = /var GP_PTYPES = \[([\s\S]*?)\n        \];/.exec(SRC);
    ok('the registry is findable', !!reg);
    const ids = [];
    if (reg) {
        const re = /\{ id: "(\w+)"/g;
        let m;
        while ((m = re.exec(reg[1]))) ids.push(m[1]);
    }
    ok('it has entries', ids.length > 5, ids.join(','));

    /* The render chain, plus the two that are hosted rather than built as
       markup — map and video are singletons placed into the panel by the grid,
       so they legitimately have no `p.type === ` branch of their own. */
    const rendered = new Set(['map', 'video']);
    const rre = /p\.type === "(\w+)"/g;
    let r;
    while ((r = rre.exec(SRC))) rendered.add(r[1]);

    const orphanMenu = ids.filter((i) => !rendered.has(i));
    ok('every type in the menu has something that draws it', orphanMenu.length === 0,
       'offered but never drawn: ' + orphanMenu.join(', '));

    /* The other direction is looser — a branch may exist for a type that is
       deliberately not offered — so it is reported rather than failed, except
       where it looks like a menu entry someone forgot. */
    const orphanDraw = [...rendered].filter((i) => !ids.includes(i) && i !== 'map' && i !== 'video');
    ok('every type that can be drawn is offered', orphanDraw.length === 0,
       'drawn but unreachable: ' + orphanDraw.join(', '));
}

/* ══ the dock ════════════════════════════════════════════════════════════ */
console.log('\nthe dock menu offers what the dock draws');
{
    /* gpDock()'s defaults and gpDockMenu()'s list are two literals naming the
       same slots. A slot in the defaults with no menu entry can never be
       turned off; one in the menu with no default reads as off on a fresh
       install and cannot be explained. */
    const def = /gp\.dock = d \|\| \{([^}]*)\}/.exec(SRC);
    ok('the dock defaults are findable', !!def);
    const defKeys = def ? (def[1].match(/(\w+):/g) || []).map((s) => s.slice(0, -1)) : [];

    const menu = /var defs = [\s\S]{0,600}?\]\);/.exec(SRC);
    ok('the dock menu list is findable', !!menu);
    const menuKeys = menu ? (menu[0].match(/\["(\w+)",/g) || []).map((s) => s.slice(2, -2)) : [];

    ok('every slot the dock stores can be switched off',
       defKeys.every((k) => menuKeys.includes(k)),
       'in the defaults, not in the menu: ' + defKeys.filter((k) => !menuKeys.includes(k)).join(', '));
    ok('every slot the menu offers has a default',
       menuKeys.every((k) => defKeys.includes(k)),
       'in the menu, not in the defaults: ' + menuKeys.filter((k) => !defKeys.includes(k)).join(', '));
}

/* ══ the shapes ADR-0064 added, and then stopped offering ════════════════
   Four bar shapes and three panel shapes were registries you picked from, and
   this block checked that every id offered had a renderer behind it. They are
   gone: what the bar carries is a fact about the recording (gpFilmState), not
   a preference, and the panel is the track sheet. The pairing this file exists
   to check is now between the STATE and the shape, which is a shorter list and
   cannot fall out of step with a stored string. */
console.log('\nnothing is offered, so nothing can be offered and not built');
{
    ok('the registries are gone',
       !/var GP_BARS = \[/.test(SRC) && !/var GP_TLS = \[/.test(SRC) &&
       !/gpLookSet/.test(SRC),
       'a settings key is a string from disk and could always say anything');

    const look = (/function gpLook\(\) \{[\s\S]*?\n        \}/.exec(SRC) || [''])[0];
    const ids = (look.match(/"(\w+)"/g) || []).map((s) => s.slice(1, -1));
    ok('gpLook resolves to a fixed, small set', ids.length > 0 && ids.length <= 4,
       ids.join(','));

    const barFn = (/function gpBarHtml\(style\) \{[\s\S]*?\n        \}/.exec(SRC) || [''])[0];
    const missing = ids.filter((id) => id !== 'classic' && id !== 'ready' && id !== 'sheet' &&
                                       !barFn.includes('"' + id + '"') &&
                                       !/return gpBarOneHtml\(\);/.test(barFn));
    ok('and every shape it can name is dispatched', missing.length === 0,
       'named, never built: ' + missing.join(', '));
}

/* ══ the car glyph vocabulary ════════════════════════════════════════════ */
console.log('\nevery car uses the classes the engines look for');
{
    const cars = (/(var GP_CARS = \[[\s\S]*?\n        \];)/.exec(SRC) || [''])[0];
    ok('the car registry is findable', cars.length > 100);
    const entries = cars.split(/\{ id: "/).slice(1);
    ok('it has cars', entries.length >= 2, String(entries.length));

    /* Every car has to react to the recording. The rule the stylesheet states
       — "a car that reacts to nothing is a sticker" — is only true while every
       glyph carries at least one part the engines can drive. */
    const noBrake = [], oddWheels = [];
    entries.forEach((e) => {
        const id = e.slice(0, e.indexOf('"'));
        if (!/class="[^"]*\bbrake\b/.test(e)) noBrake.push(id);
        const w = (e.match(/class="wheel"/g) || []).length;
        if (w !== 0 && w !== 4) oddWheels.push(id + ' (' + w + ')');
    });
    ok('every car has brake lights', noBrake.length === 0, 'without: ' + noBrake.join(', '));
    ok('and four wheels, or none at all',
       oddWheels.length === 0,
       'gpFrontWheels takes the two with the smallest y, so three or five ' +
       'steers something that is not a front wheel: ' + oddWheels.join(', '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
