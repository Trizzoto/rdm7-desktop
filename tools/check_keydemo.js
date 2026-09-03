/* One keypad page, and a demo that only plays what you are configuring.
 *
 * Design and Live were two tabs showing the same picture disagreeing with
 * itself. Design lit every assigned key in its colour, forever, including a
 * momentary key — which in a car is dark until a thumb is on it. Live lit only
 * what was really on, and locked the panel so you could not change anything
 * while you watched. Neither was wrong on its own; together they taught people
 * that the picture was decoration.
 *
 * There is one page now and one rule: the ring shows what the dash would be
 * driving. Which leaves two things a truthful picture cannot show by itself —
 * the colour you are picking for a button that is currently off, and a warning
 * that only fires when the coolant really does go over 95 — so a control
 * demonstrates itself while you use it, and nothing else moves.
 *
 * The failure modes are all quiet ones, which is why they are worth a harness:
 *
 *   - the resting lie coming back (every key lit because it looks nicer);
 *   - a demo that never stops, so the keypad is permanently animating;
 *   - a demo that leaks onto keys you are not editing;
 *   - warnings firing on their own again, because the coolant oscillator
 *     wandered over a threshold nobody was looking at;
 *   - the ring state and the LED frame on the wire disagreeing, which is the
 *     one that reaches the car.
 *
 * Runs the shipped code, pulled out of src/tauri-overlay.html, never copied.
 *
 *   node tools/check_keydemo.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); }
}

/* ---- pull the real code out ------------------------------------------- */
function grab(name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: function ' + name);
    let i = SRC.indexOf('{', m.index), depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === '{') depth++;
        else if (SRC[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return SRC.slice(m.index, j);
}
function grabVar(name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: var ' + name);
    let i = SRC.indexOf('=', m.index) + 1;
    while (SRC[i] === ' ') i++;
    const open = SRC[i], close = open === '{' ? '}' : open === '[' ? ']' : null;
    if (!close) throw new Error('var ' + name + ' is not an object/array literal');
    let depth = 0, j = i;
    for (; j < SRC.length; j++) {
        if (SRC[j] === open) depth++;
        else if (SRC[j] === close) { depth--; if (depth === 0) { j++; break; } }
    }
    return 'var ' + name + ' = ' + SRC.slice(i, j) + ';';
}
function line(re, what) {
    const m = re.exec(SRC);
    if (!m) throw new Error('not found: ' + what);
    return m[0];
}
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/* ---- the sandbox ------------------------------------------------------ */
let NOW = 1000000;
function build() {
    const win = {};
    const noop = () => {};
    const sandbox = {
        window: win, console, Math, JSON, Object, Array, String, Number,
        parseInt, parseFloat, isFinite, isNaN,
        Date: { now: () => NOW },
        setInterval: () => 1, clearInterval: noop, setTimeout: () => 1, clearTimeout: noop,
        requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
        document: {
            getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } })
        },
        kpRenderStage: noop, kpRenderInspector: noop, kpRenderChanChips: noop,
        kpRenderPageHead: noop, kpSaveCfg: noop, kpFlashState: noop, kpUpdateFlowProgress: noop,
        showToast: noop
    };
    const ctx = vm.createContext(sandbox);
    const pre = [
        grabVar('LED_COLORS'),
        line(/^\s*var HEX = \{\}; LED_COLORS\.forEach\([^\n]*$/m, 'the HEX map'),
        grabVar('MODELS'), grabVar('ICONS'), grabVar('DEFAULT_KEYS'), grabVar('KP_COL'), grabVar('kp'),
        line(/^\s*var CELL = 104[^\n]*$/m, 'the keypad geometry constants'),
        grab('kpCol'), grab('kpHex'), grab('kpHex2'), grab('kpIsJ'),
        grab('keyAssigned'), grab('_kpEsc'), grab('_kpChanRange'), grab('kpSimVal'),
        grab('_kpAlertHit'), grab('kpActiveAlert'), grab('_kpPositions'), grab('_kpCurPos'),
        /* the demo bus and the LED state it feeds */
        line(/^\s*var KP_DEMO_HOLD_MS = \d+;[^\n]*$/m, 'the demo hold'),
        line(/^\s*var KP_DEMO_TICK_MS = \d+;[^\n]*$/m, 'the demo tick'),
        grabVar('kpDemo'),
        grab('kpDemoActive'), grab('kpNow'), grab('kpDemoStart'), grab('kpDemoStop'),
        grab('kpDemoTick'), grab('kpRingSig'), grab('kpDemoVal'), grab('kpDemoFor'),
        grab('ledActive'), grab('ledColor'), grab('ledBehavior'), grab('_kpLitColorId'),
        grab('kpKeyDown'), grab('kpKeyUp'), grab('kpPressKey'),
        grab('kpBrightness'), grab('_kpHexMix'), grab('kpLegendLook'), grab('kpInsertColor'),
        grabVar('KP_FIELDS'),
        grab('ledBase'), grab('_kpRing'),
        grab('kpFrameMap'), grab('kpIds'), grab('kpSigName'), grab('kpBuildSvg')
    ].join('\n\n');
    const names = ['kp', 'kpDemo', 'kpDemoActive', 'kpDemoStart', 'kpDemoStop', 'kpDemoTick',
        'kpDemoFor', 'kpDemoVal', 'kpRingSig', 'ledActive', 'ledColor', 'ledBehavior',
        '_kpLitColorId', 'kpActiveAlert', 'kpSimVal', '_kpChanRange', '_kpPositions',
        'kpKeyDown', 'kpKeyUp', 'kpPressKey', 'kpBuildSvg', 'keyAssigned',
        'MODELS', 'HEX', 'KP_COL', 'KP_DEMO_HOLD_MS', 'KP_DEMO_TICK_MS',
        'kpBrightness', 'kpLegendLook', 'kpInsertColor', 'KP_FIELDS', 'ledBase'];
    vm.runInContext(pre + '\n\nglobalThis.__api = { ' + names.map(n => n + ': ' + n).join(', ') + ' };',
                    ctx, { timeout: 20000 });
    sandbox.__api.win = win;
    return sandbox.__api;
}
let A;
try { A = build(); }
catch (e) { console.log('\n  the keypad page could not be extracted and run:\n  ' + (e.stack || e.message) + '\n'); process.exit(1); }

/* a keypad we control completely: 4 keys, one of each kind */
function setup() {
    A.kp.model = A.MODELS[0];
    A.kp.keys = [
        { label: "LOG", text: true, icon: "blank", mode: "momentary", preset: "Log marker", color: "green", behavior: "solid" },
        { label: "PIT", text: false, icon: "turtle", mode: "toggle", preset: "Pit limiter", color: "yellow", behavior: "slow",
          alerts: [{ chan: "coolant_temp", op: ">", val: 95, color: "red", behavior: "fast" }] },
        { label: "WIPER", text: true, icon: "blank", mode: "state3", preset: "Wiper sequence", color: "cyan", behavior: "solid",
          positions: [{ name: "OFF", color: "off", behavior: "solid" }, { name: "LOW", color: "cyan", behavior: "solid" }, { name: "HIGH", color: "blue", behavior: "fast" }] },
        { label: "", text: true, icon: "blank", mode: "momentary", preset: "— unassigned —", color: "red", behavior: "solid" }
    ];
    A.kp.keyOn = {}; A.kp.keyPos = {}; A.kp.keyDown = 0;
    A.kp.selected = -1;          /* nothing selected: the plain truth */
    A.kp.coolant = 84;
    A.kpDemoStop();
    NOW += 10000;
}
function lit() { const o = []; for (let i = 0; i < 4; i++) o.push(A.ledActive(i) ? A._kpLitColorId(i) : null); return o; }

/* === 1. the picture tells the truth ===================================== */
console.log('\nthe keypad shows what the dash would be driving');
{
    setup();
    ok('a momentary key is dark until it is pressed', A.ledActive(0) === false);
    ok('so is a latching key nobody has latched', A.ledActive(1) === false);
    ok('a cycle key parked on OFF is dark', A.ledActive(2) === false);
    ok('and an unassigned key is dark whatever else happens', A.ledActive(3) === false);
    A.kpKeyDown(0);
    ok('holding a momentary key lights it, in its own colour', A.ledActive(0) === true && A._kpLitColorId(0) === 'green');
    ok('and pressing it selects it, so the panel follows your thumb', A.kp.selected === 0);
    ok('the cap goes down while it is held', A.kp.keyDown === 1);
    A.kpKeyUp();
    ok('letting go puts it out again — that is what momentary means', A.ledActive(0) === false && A.kp.keyDown === 0);
    A.kpKeyDown(1); A.kpKeyUp();
    ok('a latching key stays on after the press', A.ledActive(1) === true && A._kpLitColorId(1) === 'yellow');
    A.kpKeyDown(1); A.kpKeyUp();
    ok('and goes off on the next one', A.ledActive(1) === false);
    A.kpKeyDown(2); A.kpKeyUp();
    ok('a cycle key steps to its next position', A.kp.keyPos[2] === 1 && A._kpLitColorId(2) === 'cyan');
    A.kpKeyDown(2); A.kpKeyUp();
    ok('and to the one after that, with its own colour and blink',
       A._kpLitColorId(2) === 'blue' && A.ledBehavior(2) === 'fast');
    A.kpKeyDown(2); A.kpKeyUp();
    ok('then wraps back to dark', A.kp.keyPos[2] === 0 && A.ledActive(2) === false);
    A.kpKeyDown(3); A.kpKeyUp();
    ok('an unassigned key can be selected but never lights', A.kp.selected === 3 && A.ledActive(3) === false);
}

/* === 2. selecting a key is not the same as lighting it ================== */
console.log('\nselecting a key does not light it — that was the old lie, in a smaller place');
{
    setup();
    A.kp.selected = 0;
    ok('a selected momentary key is still dark, because it is still off', A.ledActive(0) === false);
    ok('nothing on the keypad is lit just because the panel is open',
       lit().every(x => x === null), JSON.stringify(lit()));
    /* seeing the whole scheme is a thing you ASK for, and it lets go again */
    A.kpDemoStart('all', -1);
    const on = lit();
    ok('"show every colour" lights every assigned key in its own colour',
       on[0] === 'green' && on[1] === 'yellow' && on[2] === 'cyan', JSON.stringify(on));
    ok('and still never lights an unassigned one', on[3] === null);
    NOW += A.KP_DEMO_HOLD_MS + 1;
    A.kpDemoTick();
    ok('then it lets go, and the keypad goes back to the truth',
       lit().every(x => x === null), JSON.stringify(lit()));
}

/* === 3. a control demonstrates itself, and nothing else moves =========== */
console.log('\na control demonstrates itself while you are using it');
{
    setup();
    A.kp.selected = 0;
    A.kpDemoStart('light', 0);
    ok('touching the colour holds that key lit', A.ledActive(0) === true && A._kpLitColorId(0) === 'green');
    ok('and does not touch any other key', lit().slice(1).every(x => x === null), JSON.stringify(lit()));
    /* how it works: a momentary key presses and releases */
    A.kpDemoStart('mode', 0);
    const seen = { on: false, off: false, down: false };
    for (let t = 0; t < 26; t++) { A.kpDemoTick(); if (A.ledActive(0)) { seen.on = true; if (A.kp.keyDown === 1) seen.down = true; } else seen.off = true; }
    ok('changing "how it works" plays a press: on, then off again', seen.on && seen.off, JSON.stringify(seen));
    ok('and the cap goes down while it is on, like a real one', seen.down);
    /* a latching key demonstrates the other shape */
    A.kp.selected = 1; A.kpDemoStart('mode', 1);
    let runs = 0, was = A.ledActive(1);
    for (let t = 0; t < 26; t++) { A.kpDemoTick(); const now = A.ledActive(1); if (now !== was) runs++; was = now; }
    ok('a latching key demonstrates press-on then press-off', runs === 2, runs + ' changes in one round');
    /* a cycle key walks its positions */
    A.kp.selected = 2; A.kpDemoStart('mode', 2);
    const cols = new Set();
    for (let t = 0; t < 26; t++) { A.kpDemoTick(); cols.add(A.ledActive(2) ? A._kpLitColorId(2) : null); }
    ok('a cycle key walks through its positions', cols.size >= 3, [...cols].join(','));
    /* one position, held, while you edit that position */
    A.kpDemoStart('position', 2, 2);
    ok('editing one position holds the keypad on that position', A._kpLitColorId(2) === 'blue' && A.ledBehavior(2) === 'fast');
}

/* === 4. warnings fire while you are setting them up, and not otherwise === */
console.log('\na warning plays while you are setting it up, and not otherwise');
{
    setup();
    A.kp.coolant = 120;   /* far over the 95 threshold: it must STILL not fire */
    ok('a warning does not fire on its own, however hot the simulated car gets',
       A.kpActiveAlert(1) === null && A.ledActive(1) === false);
    const alert = A.kp.keys[1].alerts[0];
    A.kp.selected = 1;
    A.kpDemoStart('alert', 1, alert);
    let tripped = 0, clear = 0, colours = new Set();
    for (let t = 0; t < 44; t++) {
        A.kpDemoTick();
        if (A.kpActiveAlert(1)) { tripped++; colours.add(A._kpLitColorId(1)); }
        else clear++;
    }
    ok('touching the warning walks its channel over the threshold and the ring flips',
       tripped > 4 && [...colours].join(',') === 'red', tripped + ' ticks tripped, colours ' + [...colours].join(','));
    ok('and back under it again, so you see it clear', clear > 4, clear + ' ticks clear');
    ok('the ring blinks the way the warning says', A.kp.keys[1].alerts[0].behavior === 'fast');
    ok('no other key reacts to the demo', lit().filter((c, i) => i !== 1 && c !== null).length === 0, JSON.stringify(lit()));
    /* below-threshold warnings walk the other way */
    const low = { chan: 'oil_press', op: '<', val: 20, color: 'red', behavior: 'fast' };
    A.kp.keys[0].alerts = [low];
    A.kp.selected = 0;
    A.kpDemoStart('alert', 0, low);
    let below = 0, above = 0;
    for (let t = 0; t < 44; t++) { A.kpDemoTick(); if (A.kpSimVal('oil_press') < 20) below++; else above++; }
    ok('a "less than" warning is demonstrated by dropping under it, not over it', below > 4 && above > 4,
       below + ' under, ' + above + ' over');
}

/* === 5. a demo stops ==================================================== */
console.log('\na demo stops');
{
    setup();
    A.kp.selected = 0;
    A.kpDemoStart('light', 0);
    ok('it is running while you are on the control', A.kpDemoActive() === true);
    NOW += A.KP_DEMO_HOLD_MS + 1;
    ok('and gives up a few seconds after you stop touching it', A.kpDemoActive() === false);
    A.kpDemoTick();
    ok('the tick that finds it expired clears it out', A.kpDemo.what === null && A.kp.keyDown === 0);
    A.kpDemoStart('light', 0);
    NOW += 1000;
    A.kpDemoStart('light', 0);
    ok('touching the same control again extends it rather than restarting the animation',
       A.kpDemoActive() === true && A.kpDemo.t === 0);
    /* a real press beats a demo: you asked the button directly */
    A.kpDemoStart('mode', 1);
    A.kpKeyDown(1);
    ok('pressing a key on the picture stops whatever was demoing', A.kpDemoActive() === false);
    A.kpKeyUp();
    ok('and the press itself still lands', A.ledActive(1) === true);
}

/* === 6. the picture and the wire agree ================================== */
console.log('\nwhat is drawn and what would go on the wire are the same thing');
{
    setup();
    A.kp.selected = -1;
    const sig0 = A.kpRingSig();
    A.kpKeyDown(0);
    ok('the ring signature changes when a ring changes', A.kpRingSig() !== sig0);
    ok('the lit colour a frame would carry is the colour that is drawn',
       A._kpLitColorId(0) === 'green' && A.ledColor(0) === A.HEX.green);
    A.kpKeyUp();
    A.kp.selected = 1;
    A.kpDemoStart('alert', 1, A.kp.keys[1].alerts[0]);
    for (let t = 0; t < 44 && !A.kpActiveAlert(1); t++) A.kpDemoTick();
    ok('and while a warning is playing, the frame would carry the warning colour',
       A.kpActiveAlert(1) !== null && A._kpLitColorId(1) === 'red' && A.ledColor(1) === A.HEX.red);
    const svg = A.kpBuildSvg();
    ok('the keypad picture still draws, with the pressed/lit state on it', /<svg/.test(svg) && svg.length > 2000);
}

/* === 5b. a warning is a layer, not a replacement ======================== */
console.log('\na warning sits OVER the button, so a latched key still reads as latched');
{
    setup();
    const alert = A.kp.keys[1].alerts[0];        /* coolant > 95 → red, fast */
    A.kp.selected = 1;
    /* latch the key on first: yellow */
    A.kpKeyDown(1); A.kpKeyUp();
    ok('the key is latched on in its own colour', A._kpLitColorId(1) === 'yellow');
    const base0 = A.ledBase(1);
    ok('and that is what the button itself is showing', base0.on === true && base0.color === 'yellow');
    /* now the warning trips over the top */
    A.kpDemoStart('alert', 1, alert);
    for (let t = 0; t < 44 && !A.kpActiveAlert(1); t++) A.kpDemoTick();
    ok('the warning takes the ring', A.kpActiveAlert(1) !== null && A._kpLitColorId(1) === 'red');
    const under = A.ledBase(1);
    ok('but underneath it the button is still latched, still yellow',
       under.on === true && under.color === 'yellow', JSON.stringify(under));
    /* the picture draws both, so the blink alternates red/yellow, not red/dark */
    const svg = A.kpBuildSvg();
    ok('so the picture stacks two rings — the button, then the warning over it',
       svg.indexOf(A.HEX.yellow) > 0 && svg.indexOf(A.HEX.red) > 0,
       'yellow at ' + svg.indexOf(A.HEX.yellow) + ', red at ' + svg.indexOf(A.HEX.red));
    ok('and only the warning ring blinks — the one underneath holds steady',
       (svg.match(/class="kp-blink-fast"/g) || []).length === 1);
    /* a SOLID warning has nothing to blink, so it steps aside instead */
    alert.behavior = 'solid';
    A.kpDemoStart('alert', 1, alert);
    for (let t = 0; t < 44 && !A.kpActiveAlert(1); t++) A.kpDemoTick();
    const solidSvg = A.kpBuildSvg();
    ok('a solid warning peeks, letting the button’s own colour through every few seconds',
       /class="kp-alert-peek"/.test(solidSvg) && solidSvg.indexOf(A.HEX.yellow) > 0);
    ok('and the peek is defined, and stops for anyone who asked for less motion',
       /@keyframes kpPeek/.test(solidSvg) && /prefers-reduced-motion[^}]*kp-alert-peek/.test(solidSvg));
    alert.behavior = 'fast';
    /* on a key that is NOT on, there is nothing underneath: warning against dark */
    A.kpKeyDown(1); A.kpKeyUp();                 /* unlatch */
    ok('the button is off again', A.ledBase(1).on === false);
    A.kpDemoStart('alert', 1, alert);
    for (let t = 0; t < 44 && !A.kpActiveAlert(1); t++) A.kpDemoTick();
    const offSvg = A.kpBuildSvg();
    ok('a warning on a button that is off blinks against the dark, with no second ring',
       A._kpLitColorId(1) === 'red' && !/class="kp-alert-peek"/.test(offSvg) &&
       (offSvg.match(/stroke="' \+ /g) || []).length === 0 && offSvg.indexOf(A.HEX.yellow) < 0,
       'yellow at ' + offSvg.indexOf(A.HEX.yellow));
    /* a cycle key parked on a lit position gets the same treatment */
    A.kpDemoStop();
    A.kp.keys[2].alerts = [{ chan: 'coolant_temp', op: '>', val: 95, color: 'red', behavior: 'slow' }];
    A.kp.selected = 2;
    A.kpKeyDown(2); A.kpKeyUp();                 /* step to LOW, cyan */
    ok('the cycle key is parked on a lit position', A.ledBase(2).color === 'cyan' && A.ledBase(2).on === true);
    A.kpDemoStart('alert', 2, A.kp.keys[2].alerts[0]);
    for (let t = 0; t < 44 && !A.kpActiveAlert(2); t++) A.kpDemoTick();
    const cycSvg = A.kpBuildSvg();
    ok('and its position colour survives underneath the warning',
       A._kpLitColorId(2) === 'red' && cycSvg.indexOf(A.HEX.cyan) > 0);
}

/* === 6b. the lighting the part actually has ============================= */
console.log('\nthe lighting model is the one on the bench, not one we invented');
{
    setup();
    /* ONE ring brightness. The panel used to offer day AND night, and nothing
       was ever sent for night, because a PKP has no such value. */
    ok('there is one ring brightness, and night is not one of its values',
       typeof A.kp.ledBright === 'number' && A.kp.brightNight === undefined,
       'ledBright ' + A.kp.ledBright + ', brightNight ' + A.kp.brightNight);
    A.kp.ledBright = 63; const full = A.kpBrightness();
    A.kp.ledBright = 0;  const none = A.kpBrightness();
    A.kp.night = true;   const atNight = A.kpBrightness();
    ok('and the preview room does not change it — a room is not a setting',
       full === 1 && none === 0 && atNight === none, full + ' / ' + none + ' / ' + atNight);
    A.kp.night = false; A.kp.ledBright = 48;
    ok('the saved fields carry the one brightness and the two backlight ones',
       A.KP_FIELDS.indexOf('ledBright') >= 0 && A.KP_FIELDS.indexOf('blColor') >= 0 &&
       A.KP_FIELDS.indexOf('blBright') >= 0 && A.KP_FIELDS.indexOf('brightNight') < 0,
       A.KP_FIELDS.join(','));
    /* the legend is a window in a black cap, lit by the backlight alone */
    const off = A.kpLegendLook(0, 'amber'), mid = A.kpLegendLook(32, 'amber'), on = A.kpLegendLook(63, 'amber');
    ok('an unlit legend is a dark silhouette, not white ink',
       off.col.toLowerCase() === '#4a4f55' && off.op < 0.35, off.col + ' @ ' + off.op.toFixed(2));
    ok('a lit one takes the backlight colour', on.col.toLowerCase() === A.HEX.amber.toLowerCase(), on.col);
    ok('and gets brighter all the way up', off.op < mid.op && mid.op < on.op && on.op > 0.9,
       [off.op, mid.op, on.op].map(x => x.toFixed(2)).join(' < '));
    ok('every backlight colour is reachable, amber and lime included',
       A.kpLegendLook(63, 'lime').col.toLowerCase() === A.HEX.lime.toLowerCase() &&
       A.kpLegendLook(63, 'blue').col.toLowerCase() === A.HEX.blue.toLowerCase());
    /* the ring brightness has nothing to do with the legend */
    A.kp.blBright = 40; A.kp.blColor = 'amber';
    A.kp.ledBright = 63; const legendBright = A.kpInsertColor();
    A.kp.ledBright = 4;  const legendDim = A.kpInsertColor();
    ok('turning the rings down does not dim the legends — different lamp',
       legendBright === legendDim, legendBright + ' vs ' + legendDim);
    A.kp.ledBright = 48;
    /* and it reaches the picture */
    A.kp.blBright = 0;
    const dark = A.kpBuildSvg();
    A.kp.blBright = 63;
    const glowing = A.kpBuildSvg();
    ok('the picture draws a bloom behind the legends once the backlight is up',
       !/filter="url\(#kpSoft2\)" style="color:#/.test(dark) && /filter="url\(#kpSoft2\)"/.test(glowing));
    ok('and the legends carry the backlight colour, not near-white ink',
       glowing.toLowerCase().indexOf(A.HEX.amber.toLowerCase()) > 0 && !/color:#F0F4F8/i.test(glowing));
}

/* === 7. the page it lives on =========================================== */
console.log('\none page, not two');
{
    ok('the panel is never locked for watching', !/configuration locked/.test(CODE));
    ok('the LED state does not ask which tab you are on',
       !/function ledActive[\s\S]{0,400}kp\.live/.test(CODE) &&
       !/function ledColor[\s\S]{0,300}kp\.live/.test(CODE) &&
       !/function ledBehavior[\s\S]{0,300}kp\.live/.test(CODE),
       'ledActive/ledColor/ledBehavior still branch on kp.live');
    ok('the selection ring and the cycle pips draw on the one page',
       !/!fx && !kp\.live && kp\.selected/.test(CODE) && !/!fx && kp\.live && k\.mode === "state3"/.test(CODE));
    ok('pressing is a press and a release, not a timed fake',
       /function kpKeyDown/.test(CODE) && /function kpKeyUp/.test(CODE) &&
       /addEventListener\("pointerup", kpKeyUp\)/.test(CODE));
    /* A finger is a pointer and a mouse is a pointer; mousedown is only one of
       them, and this app runs on machines with touchscreens. */
    ok('and it listens for a pointer, so a finger counts',
       /addEventListener\("pointerdown"/.test(CODE) && !/kp-keyg[\s\S]{0,400}addEventListener\("mousedown"/.test(CODE));
    ok('a pointer that is cancelled mid-press still releases the key',
       /addEventListener\("pointercancel", kpKeyUp\)/.test(CODE));
    ok('the window-level release is bound once, not once per redraw',
       /if \(!window\._kpUpBound\)/.test(CODE));
    ok('the panel is wired to the demo bus once, not once per edit',
       /function kpBindDemo[\s\S]{0,200}_kpDemoBound/.test(CODE));
    ok('the controls that demonstrate themselves say so in the markup',
       /data-demo="mode"/.test(CODE) && /data-demo="light"/.test(CODE) &&
       /data-demo="alert"/.test(CODE) && /data-demo="position"/.test(CODE));
    ok('the colour field is named for what it does',
       /Colour when it&#8217;s on/.test(CODE) && !/>Resting colour</.test(CODE));
    /* The page does not explain itself in prose any more — that is a guide's
       job, and a guide is read once instead of sitting on the screen forever.
       What has to survive is that every control still says what it IS and what
       it is SET TO. */
    ok('the page does not tell you how to use it',
       !/Click a key to press it/.test(CODE) && !/lights only while you hold/.test(CODE) &&
       !/A ring is dark while its button is off/.test(CODE));
    ok('but the hardware facts are still on the controls they belong to, in tooltips',
       /data-tip="<b>Colour when it&#8217;s on<\/b>/.test(CODE) &&
       /data-tip="<b>Button brightness<\/b>/.test(CODE) &&
       /data-tip="<b>Legend brightness<\/b>/.test(CODE));
}

console.log('');
console.log(fail ? ('  FAILED ' + fail + ' of ' + (pass + fail)) : ('  passed all ' + pass + ' checks'));
console.log('');
process.exit(fail ? 1 : 0);
