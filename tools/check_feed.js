/* The corner feed: one card per corner, in both disciplines.
 *
 * Corners could tell you Turn 1 cost 0.43 s and then offered a button that
 * CHANGED VIEW to show you the moment. Drift said the same thing three times —
 * a hero for one corner, a numbers-only table of every corner, and a table of
 * the laps with their times in it. Both are the same screen now: a map, a
 * ranked feed of cards each carrying its own picture and its own transport,
 * one bar along the bottom. What differs between them is the SCORER, and that
 * is the thing this file is here to keep true.
 *
 * What is pinned, and why each one is a bug that has already happened:
 *
 *   - the span of a corner is walked WITHIN the lap it is on. The index
 *     walkers default to gpLapRange(), which is the lap being ANALYSED; the
 *     first cut of play-across-laps collapsed all seven spans onto lap 4 and
 *     played once before stopping.
 *   - the queue is part of a stop point, so anything that clears one clears
 *     it. A scrub mid-run that left the remainder armed would jump you to
 *     another lap three seconds later.
 *   - the ticker asks about the queue BEFORE the loop, because the two are
 *     alternatives and a queued run never sets playLoopFrom.
 *   - a card is marked, never re-rendered, from the ticker. Rebuilding the
 *     feed under a card whose button was just pressed destroys the element
 *     the next click was going to land on (ADR-0061's rule for focus).
 *   - the card's own transport must not also select the card.
 *   - every view that plays back is named ONCE (gpPlaysBack). It was written
 *     out five times, and Corners gaining a transport would have meant finding
 *     all five.
 *   - no <header> element inside a card: the app's base CSS carries a bare
 *     `header { background: #000 }` and the corner's name came out black on
 *     black.
 *   - Drift says nothing about lap TIMES. That was the one column in the view
 *     answering a question nobody drifting is asking.
 *   - the hero, the two drift tables and the nine-column corner table are
 *     gone, with no CSS left behind for them.
 *
 *   node tools/check_feed.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
function fn(name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' + name + ' = function)', 'm');
    const m = re.exec(SRC);
    if (!m) return '';
    let i = SRC.indexOf('{', m.index), d = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') d++;
        else if (SRC[j] === '}') { d--; if (!d) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}

/* ══ a corner's span, on the lap it is actually on ═══════════════════════ */
console.log('a span is walked within the lap it belongs to');
{
    const before = fn('gpIdxSecondsBefore'), after = fn('gpIdxSecondsAfter');
    ok('both walkers take the lap to stay inside',
       /function gpIdxSecondsBefore\(idx, secs, within\)/.test(before) &&
       /function gpIdxSecondsAfter\(idx, secs, within\)/.test(after),
       'they clamped to gpLapRange() — the lap being ANALYSED, not the one being walked');
    ok('…and still default to the analysed lap for every existing caller',
       /var rows = gp\.trace, r = within \|\| gpLapRange\(\);/.test(before) &&
       /var rows = gp\.trace, r = within \|\| gpLapRange\(\);/.test(after));

    const cspan = fn('gpCornerSpanOn'), dspan = fn('gpDriftSpanOn');
    ok('the circuit span passes its lap in', /gpIdxSecondsBefore\(o\.selEntry, GP_CORNER_RUNUP, lap\)/.test(cspan) &&
       /gpIdxSecondsAfter\(o\.selExit, 1\.0, lap\)/.test(cspan),
       'without this every lap in the queue got lap-4 bounds');
    ok('and so does the drift span', /gpIdxSecondsBefore\(cell\.from, GP_CORNER_RUNUP, lap\)/.test(dspan) &&
       /gpIdxSecondsAfter\(cell\.to, 1\.0, lap\)/.test(dspan));
    ok('a ghost lap has no span — it is somebody else’s drive',
       /if \(!lap \|\| !ref \|\| lap\.ghost\) return null;/.test(cspan) &&
       /if \(!lap \|\| lap\.ghost\) return null;/.test(dspan));
    ok('the reference measured against itself reads its own side of the ops',
       /if \(lapIdx === gp\.cmpLap\)[\s\S]{0,400}o = \{ selEntry: c0\.entry, selExit: c0\.exit \}/.test(cspan),
       'matching a lap to a copy of itself is a comparison with no content');
}

/* ══ the queue ═══════════════════════════════════════════════════════════ */
console.log('\nthe same corner, on every lap');
{
    const cplay = fn('gpCornerPlay'), dplay = fn('gpDriftCornerPlay');
    [['gpCornerPlay', cplay], ['gpDriftCornerPlay', dplay]].forEach(([nm, body]) => {
        ok(nm + ' fills the queue after gpPlayStop, never before',
           body.indexOf('gpPlayStop()') < body.indexOf('gp.playQueue = q.length'),
           'gpPlayStop clears the queue, so anything set before it is thrown away');
        ok(nm + ' leaves the lap being read out of its own queue',
           /if \(l\.ghost \|\| i === here\) return;/.test(body),
           'it is already playing — queueing it again would run it twice');
    });
    const clear = fn('gpPlayClearStop');
    ok('anything that clears a stop point clears the queue with it',
       /gp\.playQueue = null;/.test(clear),
       'a scrub mid-run would otherwise be followed by a jump nobody asked for');

    const tick = fn('gpPlayResumeTicker');
    ok('the ticker asks about the queue before the loop',
       tick.indexOf('gp.playQueue && gp.playQueue.length') > 0 &&
       tick.indexOf('gp.playQueue && gp.playQueue.length') <
       tick.indexOf('if (gp.playLoopFrom !== null && gp.playLoopFrom !== undefined) {'),
       'they are alternatives: a queued run never sets playLoopFrom');
    ok('…and re-anchors AFTER the analysed lap moves',
       /gp\.selLap = nx\.lap;[\s\S]{0,700}gpPlayAnchor\(\);/.test(tick),
       'the anchor is measured against gpLapRange(), which is the new lap now');
    ok('…and marks the feed rather than rebuilding it',
       /gpCornerRunSync\(\);/.test(tick) && !/gpRenderCorners\(\)/.test(tick) &&
       !/gpRenderDrift\(\)/.test(tick),
       'rebuilding under a pressed button destroys the element the next click lands on');
}

/* ══ marking, not rebuilding ═════════════════════════════════════════════ */
console.log('\nwhat the ticker is allowed to touch');
{
    const sync = fn('gpCornerRunSync');
    ok('it marks both feeds', /getElementById\("gpCorners"\)/.test(sync) &&
       /getElementById\("gpDrift"\)/.test(sync));
    ok('a drift card is keyed by the drift unit, a corner card by the corner',
       /host\.id === "gpDrift" \? gp\.driftUnit : gp\.cornerSel/.test(sync),
       'one host holds one kind, and they are different numbers');
    ok('it lights the lap chip the run has reached',
       /\[data-gp-clap\][\s\S]{0,200}=== gp\.selLap/.test(sync));
    ok('and it writes no innerHTML at all', !/innerHTML/.test(sync));
}

/* ══ the card ════════════════════════════════════════════════════════════ */
console.log('\nthe card itself');
{
    const rc = fn('gpRenderCorners'), rd = fn('gpRenderDrift');
    /* Emitted, not mentioned: the comment explaining why a div is used says
       the word too, and an assertion that trips over its own explanation is
       an assertion nobody keeps. */
    ok('neither feed builds a bare <header>',
       !/["']<header[ >]/.test(rc) && !/["']<header[ >]/.test(rd),
       'the app carries `header { background: #000 }` and the name came out black on black');
    ok('both use the same card class', /gpb-ccard/.test(rc) && /gpb-ccard/.test(rd),
       'one card, two disciplines — that is the whole point of the change');
    ok('a press on the card transport does not also select the card',
       /if \(ev\.target\.closest\("\[data-gp-cplay\],\[data-gp-cloop\],\[data-gp-claps\]"\)\) return;/.test(rc),
       'play, loop and across-laps all live inside the thing that selects');
    const dbind = fn('gpDriftBind');
    ok('…and the same guard on the drift card',
       /data-gp-dplay\],\[data-gp-dloop\],\[data-gp-dlaps\],\[data-gp-dgo\]/.test(dbind));
    ok('every card carries a picture slot',
       /data-gp-cpic/.test(rc) && /data-gp-dspark/.test(rd));
    ok('the circuit picture draws the reference under the analysed lap',
       /strand\(o\.entry, o\.exit, GP_ROLE_REF_LIGHT/.test(fn('gpCornerPicDraw')),
       'the ghost is the shape of the difference, on the card');
    ok('the drift picture is signed, so a left and a right drift mirror',
       /var mid = hh \/ 2/.test(fn('gpDriftSparks')) &&
       /Math\.max\(-1, Math\.min\(1, v \/ top2\)\)/.test(fn('gpDriftSparks')),
       'unsigned was a compromise for a 20 px table row, and that table is gone');
    ok('the selected card opens out instead of a column beside it',
       /gpCornerDetailHtml\(o\)/.test(rc) && /gpDriftPartsHtml\(r\.rating\)/.test(rd));
    ok('and the report column is off in Corners',
       /view === "corners"\) \? "none" : "";/.test(SRC),
       'two thirds of it was the selected card said again, three inches away');
}

/* ══ the transport ═══════════════════════════════════════════════════════ */
console.log('\none transport, and every view that has it');
{
    ok('the views that play back are named once',
       /function gpPlaysBack\(v\) \{/.test(SRC),
       'it was written out five times, and Corners gaining playback needed all five');
    const pb = fn('gpPlaysBack');
    ok('…and Corners is one of them',
       /v === "session" \|\| v === "drift" \|\| v === "corners"/.test(pb));
    ok('no view asks the question in its own words any more',
       !/gp\.view !== "session" && gp\.view !== "drift"\)/.test(SRC),
       (SRC.match(/gp\.view !== "session" && gp\.view !== "drift"[^\n]*/) || [''])[0]);
    ok('the handoff to another screen is gone',
       !/gpCornerToAnalyse/.test(SRC) && /window\.gpCornerWatch = function/.test(SRC),
       '"Watch it in Analyse" changed view to show you the thing it just diagnosed');
    ok('the drift play takes a mode and still honours the old boolean',
       /var loop = \(mode === true \|\| mode === "loop"\);/.test(fn('gpDriftCornerPlay')),
       'the key handler has always passed !!shift');
}

/* ══ what Drift stopped saying ═══════════════════════════════════════════ */
console.log('\nDrift is not a lap timer');
{
    const rd = fn('gpRenderDrift');
    ok('there is no lap-time column anywhere in it',
       !/gpDriftClock\(gpSpanSecs/.test(rd) && !/<th class='n'>Time<\/th>/.test(rd),
       'a drifter is not chasing the clock');
    ok('the laps table is gone', !/gpb-dlaps/.test(SRC));
    ok('the numbers-only corner table is gone', !/gpb-dcorn/.test(SRC));
    ok('the hero is gone, and so is its CSS',
       !/gpb-dhero/.test(SRC) && !/gpb-dbig/.test(SRC) && !/gpb-dtiles/.test(SRC) &&
       !/gpDriftTile/.test(SRC),
       'six tiles and a 44 px number for one corner, above a table of all of them');
    ok('the runs are chips, and they carry what the run averaged',
       /gpb-clapstrip/.test(rd) && /avg\.stars\.toFixed\(1\)/.test(rd));
    ok('the swatch still toggles whether a run is drawn',
       /data-gp-dshow='" \+ li \+ "'/.test(rd) && /gpLapShowToggle/.test(fn('gpDriftBind')));
    ok('the run picker is above the feed, not below eight cards',
       rd.indexOf('gpb-clapstrip') < rd.indexOf('gpb-cfeed'),
       'it is the only way to change run, so it cannot be the last thing on the page');
    ok('corners are ranked by what is left to find',
       /var sx = \(rx && rx\.rating\) \? rx\.rating\.stars : null;/.test(rd) &&
       /if \(sx === null\) return 1;/.test(rd),
       'ascending stars, and the unrated ones last — there is no score to be short of');
    ok('the loop light belongs to the corner being looped',
       /=== gp\.driftUnit\)/.test(fn('gpDriftToolsSync')),
       'every card has a loop button, and one run is looping');
}

/* ══ the front door ══════════════════════════════════════════════════════ */
console.log('\nwhere a recording opens');
{
    const ov = fn('gpOpenView');
    ok('there is one decision, and it reads the recording',
       /function gpOpenView\(\)/.test(SRC) && /ops = gpCornerOps\(\)/.test(ov));
    ok('corners that can be ranked win', /if \(ops && ops\.length\) return "corners";/.test(ov));
    ok('and where they cannot, something is still selected',
       /if \(gp\.selLap < 0\)/.test(ov) && /window\.gpSelectLap\(best\)/.test(ov),
       'the mosaic opening on "pick a lap" is the whole complaint');
    ok('every route in goes through it',
       (SRC.match(/gpSetView\(gpOpenView\(\)\)/g) || []).length >= 4,
       'gpSessOpen, gpOpenLap, gpLapGhost and the download all landed on "session"');
    ok('Corners leads the Analyse section, and the mosaic is Data',
       /views: \["corners", "session"\][\s\S]{0,120}\[\["corners", "Corners"\], \["session", "Data"\]\]/.test(SRC),
       'the only screen that answers something without being configured was a sub-tab');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
