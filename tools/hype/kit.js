/* The look: Industry light, RDM brand (ADR-0024), lifted to poster scale.
 *
 * Ground #f2f2f3, ink #1d1f20, hairline dividers, square corners, Barlow and
 * Barlow Condensed, and RDM red spent only where it means something. Same
 * rules the GPS workspace lives by — the artwork should look like the app
 * because it IS the app's palette.
 */
const path = require('path');
const ROOT = path.join(__dirname, '..', '..').replace(/\\/g, '/');

const C = {
    bg: '#f2f2f3', surface: '#ffffff', ink: '#1d1f20',
    muted: 'rgba(29,31,32,0.55)', soft: 'rgba(29,31,32,0.72)',
    div: 'rgba(29,31,32,0.16)', divLt: 'rgba(29,31,32,0.08)',
    red: '#d2232a', red100: '#fdeeec', red200: '#fbd6d3', red600: '#c02026',
    red700: '#9c1a1f', red800: '#6e1317',
    bar: '#0c0d0e', barMuted: '#9a9a9e', barDiv: '#26282a',
    ok: '#2e7d43', teal: '#0f7a68',
    n200: '#e7e7ea', n300: '#d4d4d7', n400: '#b7b7ba', n600: '#7a7a7d'
};

/* The app's own speed ramp — GP_SPEED_RAMP in src/tauri-overlay.html. */
const RAMP = [[62, 10, 16], [142, 22, 32], [192, 32, 38], [242, 84, 45], [255, 158, 61], [255, 224, 138]];
function speedColour(x) {
    x = Math.max(0, Math.min(1, x));
    const f = x * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(f));
    const t = f - i, a = RAMP[i], b = RAMP[i + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
/* gpLineColour: teal one side of the reference, brand red the other. */
function lineColour(x) {
    x = Math.max(-1, Math.min(1, x));
    const a = Math.abs(x), to = x < 0 ? [15, 122, 104] : [192, 32, 38];
    return `rgb(${Math.round(152 + (to[0] - 152) * a)},${Math.round(152 + (to[1] - 152) * a)},${Math.round(152 + (to[2] - 152) * a)})`;
}

/* ---- geometry ---------------------------------------------------------- */

/* Equirectangular, scaled at the mean latitude. Both axes in the same units
   before the fit, or the circuit comes out as a streak — the mistake the
   share card shipped with once. */
function project(pts, w, h, pad, latI, lonI) {
    latI = latI === undefined ? 0 : latI; lonI = lonI === undefined ? 1 : lonI;
    const lat0 = pts.reduce((s, p) => s + p[latI], 0) / pts.length;
    const k = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(p => p[lonI] * k), ys = pts.map(p => -p[latI]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
    const ox = (w - (x1 - x0) * s) / 2 - x0 * s, oy = (h - (y1 - y0) * s) / 2 - y0 * s;
    return { xy: pts.map((p, i) => [xs[i] * s + ox, ys[i] * s + oy]), scale: s };
}

/* A smooth-ish polyline. Straight segments at this density read fine and a
   spline would move the line off the road, which is the one thing a trace
   must not do. */
function poly(xy) { return xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(''); }

/* Per-segment colouring: one short path per pair, drawn with a dark casing
   underneath so the ramp holds up against the ground. */
function ribbon(xy, colours, width, casing) {
    let s = '';
    if (casing) s += `<path d="${poly(xy)}" fill="none" stroke="${casing}" stroke-width="${width + 5}" stroke-linecap="round" stroke-linejoin="round"/>`;
    /* Runs of one colour go out as ONE path, not one path per sample.
       Round caps make every segment overlap its neighbours by half a stroke,
       so a translucent colour compounded its own alpha at every joint: the
       26% grey the drift map asks for arrived on the page as near-black, and
       nothing in the source said why. Joining the run draws the overlap once. */
    for (let i = 1; i < xy.length;) {
        let j = i;
        while (j + 1 < xy.length && colours[j + 1] === colours[i]) j++;
        const run = xy.slice(i - 1, j + 1);
        s += `<path d="${poly(run)}" fill="none" stroke="${colours[i]}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
        i = j + 1;
    }
    return s;
}

/* A vertical fade for a filled area: full strength at the far edge of the
   plot, gone at the baseline. An area chart's ink is its magnitude, and a
   flat wash spends the same ink on a 5 ms wobble as on a quarter of a
   second. The gradient makes the amount of colour mean the amount of time. */
let gradN = 0;
function fade(colour, from, to, a0, a1) {
    const id = 'fd' + (++gradN);
    return {
        id, url: `url(#${id})`,
        def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${from}" x2="0" y2="${to}">
      <stop offset="0" stop-color="${colour}" stop-opacity="${a0 === undefined ? 0.42 : a0}"/>
      <stop offset="1" stop-color="${colour}" stop-opacity="${a1 === undefined ? 0.03 : a1}"/>
    </linearGradient>`
    };
}

/* A road in perspective, for the two posts that show the overlay over
   footage. Both used to draw one horizon rule straight across the frame at
   readout height — through the lap time, in post 12's case — which reads as
   a scratch on the picture rather than as a road. Converging edges and
   foreshortened centre dashes cost the same ink and read as a road. */
function road(w, h, hzF) {
    const hz = h * (hzF || 0.40), vx = w * 0.56;
    let s = `<path d="M0 ${h}L${(vx - w * 0.055).toFixed(0)} ${hz.toFixed(0)}L${(vx + w * 0.055).toFixed(0)} ${hz.toFixed(0)}L${w} ${h}Z" fill="#0e1215"/>
  <path d="M0 ${hz.toFixed(0)}L${w} ${hz.toFixed(0)}" stroke="#2b333a" stroke-width="2"/>
  <path d="M0 ${h}L${(vx - w * 0.055).toFixed(0)} ${hz.toFixed(0)}" stroke="#3b444c" stroke-width="3"/>
  <path d="M${w} ${h}L${(vx + w * 0.055).toFixed(0)} ${hz.toFixed(0)}" stroke="#3b444c" stroke-width="3"/>`;
    for (let k = 0; k < 7; k++) {
        const t0 = Math.pow(k / 7, 2.1), t1 = Math.pow((k + 0.45) / 7, 2.1);
        const yA = h - (h - hz) * t0, yB = h - (h - hz) * t1;
        const xA = w / 2 + (vx - w / 2) * t0, xB = w / 2 + (vx - w / 2) * t1;
        s += `<path d="M${xA.toFixed(0)} ${yA.toFixed(0)}L${xB.toFixed(0)} ${yB.toFixed(0)}" stroke="#39424a" stroke-width="${(w / 143 * (1 - t0) + 1.2).toFixed(1)}"/>`;
    }
    return s;
}

/* The key for a colour ramp. "Colour is speed" is not a legend — it says
   there is a mapping without saying which way round it runs, and the app's
   ramp goes dark for slow, which is the opposite of most people's instinct.
   So print the ends. */
function rampKey(x, y, w, lo, hi, unit, steps) {
    steps = steps || 48;
    let bars = '';
    for (let i = 0; i < steps; i++)
        bars += `<rect x="${(x + i * w / steps).toFixed(2)}" y="${y}" width="${(w / steps + 0.6).toFixed(2)}" height="15" fill="${speedColour(i / (steps - 1))}"/>`;
    const t = (tx, an, s) => `<text x="${tx}" y="${y + 33}" text-anchor="${an}" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.3" fill="${C.muted}">${s}</text>`;
    return `<g>${bars}${t(x, 'start', lo + ' ' + unit)}${t(x + w, 'end', hi + ' ' + unit)}</g>`;
}

/* ---- words ------------------------------------------------------------- */

function lapTime(s) {
    const m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(3);
}
function signed(v, dp) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp === undefined ? 3 : dp); }

/* ---- the page ---------------------------------------------------------- */

const W = 1080, H = 1350;

const CSS = `
@font-face{font-family:'Barlow';src:url('file:///${ROOT}/src/fonts/Barlow-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Barlow';src:url('file:///${ROOT}/src/fonts/Barlow-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Barlow';src:url('file:///${ROOT}/src/fonts/Barlow-600.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Barlow';src:url('file:///${ROOT}/src/fonts/Barlow-700.woff2') format('woff2');font-weight:700}
@font-face{font-family:'Barlow Condensed';src:url('file:///${ROOT}/src/fonts/BarlowCondensed-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Barlow Condensed';src:url('file:///${ROOT}/src/fonts/BarlowCondensed-600.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Barlow Condensed';src:url('file:///${ROOT}/src/fonts/BarlowCondensed-700.woff2') format('woff2');font-weight:700}
*{margin:0;padding:0;box-sizing:border-box;border-radius:0}
html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:${C.bg};color:${C.ink};font-family:'Barlow',system-ui,sans-serif;
     -webkit-font-smoothing:antialiased;position:relative}
.page{width:${W}px;height:${H}px;position:relative;display:flex;flex-direction:column}

/* the black brand bar, exactly as the workspace wears it */
.bar{height:96px;background:${C.bar};color:#fff;display:flex;align-items:center;
     gap:18px;padding:0 40px;flex:none}
.bar img{height:38px;display:block}
.bar .ws{font-family:'Barlow Condensed';font-weight:700;font-size:31px;letter-spacing:.06em;
         text-transform:uppercase;color:#fff;line-height:1}
.bar .sep{width:1px;height:38px;background:${C.barDiv}}
.bar .tag{font-family:'Barlow Condensed';font-weight:600;font-size:23px;letter-spacing:.17em;
          text-transform:uppercase;color:${C.barMuted};line-height:1}
.bar .right{margin-left:auto;display:flex;align-items:center;gap:12px}
.bar .rec{width:11px;height:11px;border-radius:50%;background:${C.red}}

.body{flex:1;display:flex;flex-direction:column;padding:0 40px;min-height:0;position:relative}

.kicker{font-family:'Barlow Condensed';font-weight:600;font-size:24px;letter-spacing:.2em;
        text-transform:uppercase;color:${C.red};margin-top:34px}
.kicker.mut{color:${C.muted}}
h1{font-family:'Barlow Condensed';font-weight:700;font-size:88px;line-height:.92;
   letter-spacing:.005em;text-transform:uppercase;margin-top:10px}
h1.sm{font-size:70px}
h1.xs{font-size:58px}
.sub{font-size:25px;line-height:1.34;color:${C.soft};margin-top:16px;max-width:850px;font-weight:400}
.rule{height:1px;background:${C.div};margin:24px 0}
.grow{flex:1 1 auto;min-height:0}
.rule.hard{background:${C.ink};height:2px}

/* the huge readouts */
.big{font-family:'Barlow Condensed';font-weight:700;line-height:.84;letter-spacing:-.005em;
     font-variant-numeric:tabular-nums}
.unit{font-family:'Barlow Condensed';font-weight:600;color:${C.muted};letter-spacing:.06em;
      text-transform:uppercase}

/* ruled tables: one fact per column, labelled — never prose */
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th{font-family:'Barlow Condensed';font-weight:600;font-size:20px;letter-spacing:.15em;
   text-transform:uppercase;color:${C.muted};text-align:left;padding:0 0 9px;
   border-bottom:2px solid ${C.ink}}
td{font-size:29px;padding:13px 0;border-bottom:1px solid ${C.divLt};font-weight:500}
td.n{font-family:'Barlow Condensed';font-weight:700;font-size:34px}
.r{text-align:right}

.foot{flex:none;border-top:1px solid ${C.div};padding:20px 40px 30px;display:flex;
      align-items:flex-end;gap:20px;background:${C.bg}}
.foot .l{font-family:'Barlow Condensed';font-weight:600;font-size:22px;letter-spacing:.16em;
         text-transform:uppercase;color:${C.ink}}
.foot .s{font-size:19px;color:${C.muted};margin-top:3px;line-height:1.3;font-weight:400}
.foot .r{margin-left:auto;text-align:right;font-family:'Barlow Condensed';font-weight:600;
         font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:${C.red};
         white-space:nowrap;flex:none}

.chip{display:inline-block;font-family:'Barlow Condensed';font-weight:600;font-size:20px;
      letter-spacing:.13em;text-transform:uppercase;padding:5px 11px 4px;
      background:${C.ink};color:#fff}
.chip.red{background:${C.red}}
.chip.line{background:transparent;color:${C.muted};border:1px solid ${C.div}}
`;

function page(inner, opt) {
    opt = opt || {};
    return `<!doctype html><meta charset="utf-8"><title>${opt.title || 'RDM'}</title>
<style>${CSS}${opt.css || ''}</style>
<div class="page">${inner}</div>`;
}

function bar(tag, right) {
    return `<div class="bar">
  <img src="file:///${ROOT}/src/rdm_logo.png" alt="RDM">
  <div class="ws">Studio</div>
  <div class="sep"></div>
  <div class="tag">${tag}</div>
  ${right ? `<div class="right">${right}</div>` : ''}
</div>`;
}

function foot(left, sub, right) {
    return `<div class="foot"><div><div class="l">${left}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>${right ? `<div class="r">${right}</div>` : ''}</div>`;
}

module.exports = { C, RAMP, speedColour, lineColour, project, poly, ribbon, fade, rampKey, road,
                   lapTime, signed, page, bar, foot, W, H, ROOT, CSS };
