/* The dash is not always 800×480, and the editor's numbers have to know it.
 *
 * SCREEN_PRESETS carries four screens — the 7 inch rectangle and three round
 * panels at 720, 800 and 480 — and applyScreenDimensions resizes the canvas,
 * the interaction layer and the preview layer for whichever is chosen. Seven
 * places went on using the 7 inch numbers anyway:
 *
 *   updateWidgetField   x ±400, y ±240, w ≤800, h ≤480
 *   _eventToDeviceXY    a click mapped through 800×480 and clamped to 799,479
 *   the meter's square cap (three sites)
 *   the image importer's "fit the screen" default, and its caption
 *   the image editor's W/H caps and their max= attributes
 *
 * Measured on the dev build, all four presets, before the fix: on the 720
 * round panel, asking the inspector for y=360 — the bottom edge — got 240,
 * so the bottom third of the screen could not be typed into; H stopped at
 * 480 on a 720-tall screen. On the 800 round panel, the same, worse. On the
 * 480 one the clamps were the other way round: x accepted 400, which is 160
 * px past its right edge, and a click in the MIDDLE of the live preview was
 * sent to the dash as x=400 — off the screen it was aimed at.
 *
 * What is pinned here:
 *   - those numbers are read from CANVAS_W/CANVAS_H/ORIGIN_X/ORIGIN_Y
 *   - the clamp chain and the click mapping, lifted verbatim and run against
 *     every preset, land exactly on each screen's own edge
 *   - the 7 inch screen still behaves exactly as it always did
 *
 *   node tools/check_screensize.js
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

/* The four screens the editor offers, read out of the page rather than
   retyped — if a fifth is added this harness covers it for free. */
const PRESETS = (() => {
    const m = /const SCREEN_PRESETS = \[([\s\S]*?)\];/.exec(SRC);
    if (!m) throw new Error('SCREEN_PRESETS not found');
    return m[1].split('\n').map(l => {
        const q = /id: '([^']+)',\s*w: (\d+), h: (\d+)/.exec(l);
        return q ? { id: q[1], w: +q[2], h: +q[3] } : null;
    }).filter(Boolean);
})();

console.log('the editor offers ' + PRESETS.length + ' screens');
ok('and the 7 inch one is among them', PRESETS.some(p => p.w === 800 && p.h === 480));
ok('and so is a screen taller than 480', PRESETS.some(p => p.h > 480),
   'without one, none of this matters and the harness is testing nothing');

console.log('\nthe numbers come from the screen, not from the 7 inch one');

const upd = grab('updateWidgetField');
ok('the inspector clamps against ORIGIN_X / ORIGIN_Y',
   /Math\.max\(-ORIGIN_X, Math\.min\(ORIGIN_X, finalVal\)\)/.test(upd) &&
   /Math\.max\(-ORIGIN_Y, Math\.min\(ORIGIN_Y, finalVal\)\)/.test(upd));
ok('and sizes against CANVAS_W / CANVAS_H',
   /Math\.min\(CANVAS_W, finalVal\)/.test(upd) && /Math\.min\(CANVAS_H, finalVal\)/.test(upd));

const ev = grab('_eventToDeviceXY');
ok('a click on the live preview is scaled by the connected screen',
   /cx \* CANVAS_W \/ rect\.width/.test(ev) && /cy \* CANVAS_H \/ rect\.height/.test(ev));
ok('and clamped to its last pixel, not to 799,479',
   /Math\.min\(CANVAS_W - 1, x\)/.test(ev) && /Math\.min\(CANVAS_H - 1, y\)/.test(ev));

ok('the meter has one square cap, and it is screen-sized',
   /function _meterMaxSide\(\) \{ return Math\.max\(CANVAS_W, CANVAS_H\); \}/.test(SRC),
   'three separate sites capped a meter at 800');
ok('and all three sites use it', (SRC.match(/_meterMaxSide\(\)/g) || []).length === 4,
   'expected the definition plus three call sites, found ' +
   (SRC.match(/_meterMaxSide\(\)/g) || []).length);

ok('the image importer fits the screen it is importing for',
   /const SCREEN_W = CANVAS_W, SCREEN_H = CANVAS_H;/.test(SRC));
ok('the image editor caps at the screen too',
   /if \(tw > CANVAS_W \|\| th > CANVAS_H\)/.test(SRC) &&
   /Math\.min\(CANVAS_W, parseInt\(wInput\.value\)/.test(SRC) &&
   /Math\.min\(CANVAS_H, parseInt\(hInput\.value\)/.test(SRC));
ok('including the boxes the user types into',
   /id="imgEditW"[^>]*max="\$\{CANVAS_W\}"/.test(SRC) &&
   /id="imgEditH"[^>]*max="\$\{CANVAS_H\}"/.test(SRC));

console.log('\nrun against every screen the editor offers');

/* The clamp chain, lifted verbatim out of updateWidgetField — the shipped
   expressions, not a copy of them. */
const chain = (() => {
    const a = upd.indexOf("if (field === 'x')");
    const b = upd.indexOf('\n', upd.indexOf("field === 'h'"));
    if (a < 0 || b < 0) throw new Error('clamp chain not found in updateWidgetField');
    return upd.slice(a, b);
})();
const clampFor = new Function('field', 'finalVal', 'ORIGIN_X', 'ORIGIN_Y', 'CANVAS_W', 'CANVAS_H',
    chain + '\n return finalVal;');

/* And the click mapping, whole, with the one DOM call it makes stubbed to a
   rectangle of a known size. */
const mapFor = (() => {
    const f = new Function('document', 'CANVAS_W', 'CANVAS_H', 'rectW', 'rectH',
        ev + '\n return _eventToDeviceXY;');
    return (cw, ch, rectW, rectH, cx, cy) => f(
        { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: rectW, height: rectH }) }) },
        cw, ch, rectW, rectH)({ clientX: cx, clientY: cy });
})();

let bad = [];
PRESETS.forEach(p => {
    const ox = Math.round(p.w / 2), oy = Math.round(p.h / 2);
    const say = (what, got, want) => {
        if (got !== want) bad.push(p.id + ' ' + what + ': ' + got + ' (wanted ' + want + ')');
    };
    /* Far past every edge lands exactly on it. */
    say('x far', clampFor('x', 9999, ox, oy, p.w, p.h), ox);
    say('x near', clampFor('x', -9999, ox, oy, p.w, p.h), -ox);
    say('y far', clampFor('y', 9999, ox, oy, p.w, p.h), oy);
    say('y near', clampFor('y', -9999, ox, oy, p.w, p.h), -oy);
    say('w max', clampFor('w', 9999, ox, oy, p.w, p.h), p.w);
    say('h max', clampFor('h', 9999, ox, oy, p.w, p.h), p.h);
    say('w min', clampFor('w', 0, ox, oy, p.w, p.h), 1);
    /* A value inside the screen is left alone. */
    say('y inside', clampFor('y', oy - 7, ox, oy, p.w, p.h), oy - 7);

    /* A click in the middle of the preview is the middle of the dash, at
       whatever size the preview happens to be drawn on screen. */
    const mid = mapFor(p.w, p.h, 640, 640 * p.h / p.w, 320, 320 * p.h / p.w);
    say('click middle x', mid.x, Math.round(p.w / 2));
    say('click middle y', mid.y, Math.round(p.h / 2));
    const past = mapFor(p.w, p.h, 640, 480, 99999, 99999);
    say('click past the edge x', past.x, p.w - 1);
    say('click past the edge y', past.y, p.h - 1);
});
ok('every screen clamps and maps to its own edges', bad.length === 0,
   bad.join('\n         '));

/* The 7 inch screen is the one people have. It must not have moved. */
const seven = PRESETS.find(p => p.w === 800 && p.h === 480);
ok('and the 7 inch screen still behaves exactly as it did',
   clampFor('x', 9999, 400, 240, 800, 480) === 400 &&
   clampFor('y', 9999, 400, 240, 800, 480) === 240 &&
   clampFor('w', 9999, 400, 240, 800, 480) === 800 &&
   clampFor('h', 9999, 400, 240, 800, 480) === 480 &&
   mapFor(800, 480, 800, 480, 799, 479).x === 799,
   'the old constants were ±400 / ±240 / 800 / 480 and this screen is why');

/* The negative half: the numbers that used to be there, against the screens
   that used to break. Pinned so this stays a test of something real. */
const oldClamp = (field, v) => {
    if (field === 'x') return Math.max(-400, Math.min(400, v));
    if (field === 'y') return Math.max(-240, Math.min(240, v));
    if (field === 'w') return Math.max(1, Math.min(800, v));
    return Math.max(1, Math.min(480, v));
};
const tall = PRESETS.find(p => p.h > 480);
ok('doing it the old way still loses the bottom of a tall screen',
   tall && oldClamp('y', 9999) === 240 && Math.round(tall.h / 2) > 240,
   tall ? 'y capped at 240 on a ' + tall.h + '-tall screen' : 'no tall preset');
ok('and still lets a widget off the side of a small one',
   (() => { const s = PRESETS.find(p => p.w < 800); return s && oldClamp('x', 9999) > Math.round(s.w / 2); })(),
   'x capped at 400 on a 480-wide screen is 160 px past the edge');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
