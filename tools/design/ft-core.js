/* ===========================================================================
   Footage timeline design study — the model, the paint, the shell.

   Nothing here is shipping code. It exists so five designs can be judged
   against data that behaves the way a real track day behaves: a session with
   a pit stop in the middle of it, laps of different lengths, and footage that
   arrives in four files with gaps between them, one of which will not decode.
   =========================================================================== */
window.FT = (function () {
'use strict';

/* ===========================================================================
   1. The day
   =========================================================================== */

var HZ = 5;               /* the prototype's sample rate — the puck logs 25 */
var FRAME = 0.04;         /* one video frame, and the real sample quantum    */

/* What the day was made of, in order. Durations in seconds. */
var SEGS = [
    { kind: 'pit',  dur:  40 },
    { kind: 'out',  dur:  96 },
    { kind: 'lap',  dur:  94.2 },
    { kind: 'lap',  dur:  92.8 },
    { kind: 'lap',  dur:  91.6 },
    { kind: 'lap',  dur: 105.9, note: 'traffic' },
    { kind: 'pit',  dur: 132 },
    { kind: 'out',  dur:  95.4 },
    { kind: 'lap',  dur:  91.2 },
    { kind: 'lap',  dur:  90.8 },
    { kind: 'lap',  dur:  92.1 },
    { kind: 'in',   dur: 118 },
    { kind: 'pit',  dur:  40 }
];

var SESS = 0;
SEGS.forEach(function (s) { SESS += s.dur; });

/* The laps, as the app holds them: a flat list with the pit and the out/in
   laps in it, because the timeline has to draw the whole recording and not
   just the interesting parts of it. */
var LAPS = [], n = 1, at = 0;
SEGS.forEach(function (s) {
    var L = { kind: s.kind, from: at, to: at + s.dur, dur: s.dur, note: s.note || '' };
    if (s.kind === 'lap') L.num = n++;
    LAPS.push(L);
    at += s.dur;
});
var BEST = null;
LAPS.forEach(function (L) { if (L.kind === 'lap' && (!BEST || L.dur < BEST.dur)) BEST = L; });

/* ---- the speed trace ------------------------------------------------------
   A lap profile with seven corners, so the trace has the shape you actually
   line footage up against: a cliff at every braking point. A slower lap is
   the same shape at lower speeds, which is what makes lap 5 read as traffic
   rather than as a different circuit. */
var CORNERS = [
    [0.06, 74], [0.21, 52], [0.34, 112], [0.47, 44],
    [0.62, 86], [0.77, 58], [0.90, 98]
];
var TOP = 208;

function lapProfile(p, scale) {
    var v = TOP;
    for (var i = 0; i < CORNERS.length; i++) {
        var cp = CORNERS[i][0], cv = CORNERS[i][1] * scale;
        var d = Math.abs(((p - cp + 0.5) % 1 + 1) % 1 - 0.5);
        var w = 0.052;
        if (d < w) v = Math.min(v, cv + (TOP * scale - cv) * Math.pow(d / w, 1.7));
    }
    return v;
}

var N = Math.round(SESS * HZ) + 1;
var SPD = new Float32Array(N);
var DIST = new Float32Array(N);
(function build() {
    for (var i = 0; i < N; i++) {
        var t = i / HZ, L = null;
        for (var k = 0; k < LAPS.length; k++) {
            if (t >= LAPS[k].from && t < LAPS[k].to) { L = LAPS[k]; break; }
        }
        if (!L) L = LAPS[LAPS.length - 1];
        var v;
        if (L.kind === 'pit') {
            /* rolling in, stopped, rolling out — not a flat zero, because a
               flat zero is the one shape a real logger never writes */
            var q = (t - L.from) / L.dur;
            v = 34 * Math.max(0, 1 - q * 5) + 26 * Math.max(0, (q - 0.86) * 7);
        } else {
            var p = (t - L.from) / L.dur;
            var scale = L.kind === 'lap' ? Math.min(1, 91 / L.dur * 1.002)
                      : L.kind === 'out' ? 0.80 : 0.72;
            v = lapProfile(p, scale);
            if (L.kind === 'out') v *= 0.72 + 0.28 * Math.min(1, p * 2.4);
            if (L.kind === 'in') v *= Math.max(0.12, 1 - Math.max(0, p - 0.55) * 2.1);
        }
        v += Math.sin(t * 3.1) * 1.4 + Math.sin(t * 11.7) * 0.7;
        SPD[i] = Math.max(0, v);
        DIST[i] = (i ? DIST[i - 1] : 0) + SPD[i] / 3.6 / HZ;
    }
})();

function spd(t) {
    var x = Math.max(0, Math.min(N - 1.001, t * HZ));
    var i = x | 0, f = x - i;
    return SPD[i] * (1 - f) + SPD[i + 1] * f;
}
function dist(t) {
    var x = Math.max(0, Math.min(N - 1.001, t * HZ));
    var i = x | 0, f = x - i;
    return DIST[i] * (1 - f) + DIST[i + 1] * f;
}

/* ---- the footage ----------------------------------------------------------
   `start` is seconds into the recording where the first frame of the file
   sits — negative means the camera was rolling before the logger was, which
   is the normal case and the one the shipping timeline draws off the left
   edge with no indication that anything is there. */
var CLIPS = [
    { id: 'c1', name: 'GX010042.MP4', cam: 'A', lane: 0, start: -18.0, dur: 424, src: 'camera clock' },
    { id: 'c2', name: 'GX010043.MP4', cam: 'A', lane: 0, start: 411.5, dur: 402, src: 'camera clock' },
    { id: 'c3', name: 'IMG_2291.MOV', cam: 'B', lane: 1, start: 470.0, dur: 340, src: 'aligned by hand' },
    { id: 'c4', name: 'VBOX_0007.AVI', cam: 'C', lane: 2, start: 838,  dur: 268, src: 'started together', dead: true }
];
var CAMS = { A: 'GoPro, roll bar', B: 'Phone, windscreen', C: 'VBOX HD2' };

function clipAt(t) {
    for (var i = 0; i < CLIPS.length; i++) {
        var c = CLIPS[i];
        if (!c.dead && t >= c.start && t < c.start + c.dur) return c;
    }
    return null;
}
function clipsAt(t) {
    return CLIPS.filter(function (c) { return t >= c.start && t < c.start + c.dur; });
}
function nextClip(t) {
    var best = null;
    CLIPS.forEach(function (c) {
        if (c.dead || c.start <= t) return;
        if (!best || c.start < best.start) best = c;
    });
    return best;
}
/* Union of the live clips over [a,b], as a fraction. Two cameras over one lap
   count once. */
function coverage(a, b) {
    var iv = [];
    CLIPS.forEach(function (c) {
        if (c.dead) return;
        var x = Math.max(a, c.start), y = Math.min(b, c.start + c.dur);
        if (y > x) iv.push([x, y]);
    });
    if (!iv.length) return 0;
    iv.sort(function (p, q) { return p[0] - q[0]; });
    var tot = 0, ca = iv[0][0], cb = iv[0][1];
    for (var k = 1; k < iv.length; k++) {
        if (iv[k][0] > cb) { tot += cb - ca; ca = iv[k][0]; cb = iv[k][1]; }
        else if (iv[k][1] > cb) cb = iv[k][1];
    }
    return Math.min(1, (tot + cb - ca) / (b - a));
}

/* How well the clip under the playhead agrees with the trace. Real code would
   correlate the camera's own motion against the logged speed; here it is a
   smooth function of how far the clip has been dragged from its truth, which
   is enough to show what the control would DO. */
var TRUTH = { c1: -18.0, c2: 411.5, c3: 470.0, c4: 838 };
function matchOf(c) {
    if (!c) return null;
    var err = Math.abs(c.start - TRUTH[c.id]);
    return { err: err, score: Math.max(0, 1 - err / 2.5) };
}

/* ===========================================================================
   2. Format
   =========================================================================== */
function clock(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), q = s - m * 60;
    return m + ':' + (q < 10 ? '0' : '') + q.toFixed(0);
}
function clockT(s) {                 /* m:ss.t — the transport's own reading */
    var neg = s < 0; s = Math.abs(s);
    var m = Math.floor(s / 60), q = s - m * 60;
    return (neg ? '-' : '') + m + ':' + (q < 10 ? '0' : '') + q.toFixed(1);
}
function lapTime(s) {                /* m:ss.hh — a lap is read to hundredths */
    var m = Math.floor(s / 60), q = s - m * 60;
    return m + ':' + (q < 10 ? '0' : '') + q.toFixed(2);
}
function signed(s) { return (s >= 0 ? '+' : '') + s.toFixed(2) + ' s'; }

function lapAt(t) {
    for (var i = 0; i < LAPS.length; i++) if (t >= LAPS[i].from && t < LAPS[i].to) return LAPS[i];
    return LAPS[LAPS.length - 1];
}
function lapName(L) {
    return L.kind === 'lap' ? 'Lap ' + L.num
         : L.kind === 'out' ? 'Out lap'
         : L.kind === 'in'  ? 'In lap' : 'Pits';
}

/* ===========================================================================
   3. State
   =========================================================================== */
var S = {
    t: 512.4,           /* seconds into the recording                       */
    playing: false,
    rate: 1,
    sel: 'c1',          /* the section the fine controls are pointed at     */
    zoom: null,         /* {from,to} or null for the whole recording        */
    design: 'one'
};

var tickers = [];
function onTick(fn) { tickers.push(fn); return fn; }

function seek(t) { S.t = Math.max(0, Math.min(SESS, t)); runTickers(); }
function step(dt) { S.playing = false; seek(S.t + dt); }
function toggle() { if (S.t >= SESS - 0.01) S.t = 0; S.playing = !S.playing; }

/* The window a design is showing. Designs that zoom write S.zoom. */
function view() {
    if (!S.zoom) return { from: 0, to: SESS };
    return S.zoom;
}
function zoomTo(a, b) {
    var span = Math.max(4, b - a);
    if (span >= SESS - 1) { S.zoom = null; return; }
    a = Math.max(-40, a); b = a + span;
    if (b > SESS + 40) { b = SESS + 40; a = b - span; }
    S.zoom = { from: a, to: b };
}

/* ===========================================================================
   4. DOM helpers
   =========================================================================== */
function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
}
function mk(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}
function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function pct(x) { return (x * 100).toFixed(4) + '%'; }

var SVG = {
    start: "<svg viewBox='0 0 12 12'><path d='M1.5 1.5h1.6v9H1.5zM10.5 1.5v9L4 6z'/></svg>",
    back:  "<svg viewBox='0 0 12 12'><path d='M9 1.5v9L3 6z'/></svg>",
    play:  "<svg viewBox='0 0 12 12'><path d='M2.5 1.2v9.6L10.5 6z'/></svg>",
    pause: "<svg viewBox='0 0 12 12'><path d='M2.6 1.5h2.6v9H2.6zM6.8 1.5h2.6v9H6.8z'/></svg>",
    fwd:   "<svg viewBox='0 0 12 12'><path d='M3 1.5v9L9 6z'/></svg>",
    end:   "<svg viewBox='0 0 12 12'><path d='M8.9 1.5h1.6v9H8.9zM1.5 1.5v9L8 6z'/></svg>"
};

/* The five transport buttons, one definition. Every design that shows a
   transport shows THIS one — which is itself part of the argument: the
   shipping build draws them three times in three sizes. */
function transport() {
    var g = mk('div', 'tgrp');
    function b(cls, title, svg, fn) {
        var e = mk('button', 'tbtn' + (cls ? ' ' + cls : ''), svg);
        e.title = title; e.onclick = fn; g.appendChild(e); return e;
    }
    b('', 'Jump to start (Home)', SVG.start, function () { step(-1e9); });
    b('', 'Back one second', SVG.back, function () { step(-1); });
    var p = b('play', 'Play / pause (Space)', SVG.play, toggle);
    b('', 'On one second', SVG.fwd, function () { step(1); });
    b('', 'Jump to end (End)', SVG.end, function () { step(1e9); });
    onTick(function () {
        var want = S.playing ? SVG.pause : SVG.play;
        if (p._w !== want) { p.innerHTML = want; p._w = want; }
    });
    return g;
}

function rateSeg() {
    var g = mk('div', 'seg');
    [1, 2, 4, 10].forEach(function (x) {
        var b = mk('button', S.rate === x ? 'on' : '', x + '&times;');
        b.title = 'Play at ' + x + ' times real time';
        b.onclick = function () {
            S.rate = x;
            Array.prototype.forEach.call(g.children, function (c, i) {
                c.className = [1, 2, 4, 10][i] === x ? 'on' : '';
            });
        };
        g.appendChild(b);
    });
    return g;
}

/* ===========================================================================
   5. Painting
   =========================================================================== */
function fit(cv) {
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    var dpr = window.devicePixelRatio || 1;
    var w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, r.width, r.height);
    return { g: g, w: r.width, h: r.height };
}

/* The recording, as the thing footage is lined up WITH. Speed as a filled
   area, because a filled area reads as "this is the ground" and a bare line
   reads as "this is a value" — and here it is the ground. */
function paintTrace(cv, from, to, opt) {
    var c = fit(cv); if (!c) return;
    opt = opt || {};
    var g = c.g, W = c.w, H = c.h, span = to - from;
    var top = opt.top || 0, bot = opt.bot != null ? opt.bot : H;
    var hh = bot - top;

    if (opt.laps !== false) {
        LAPS.forEach(function (L) {
            var x0 = (L.from - from) / span * W, x1 = (L.to - from) / span * W;
            if (x1 < 0 || x0 > W) return;
            if (L.kind === 'pit') {
                g.fillStyle = 'rgba(0,0,0,0.30)';
                g.fillRect(x0, top, x1 - x0, hh);
            }
            g.strokeStyle = 'rgba(255,255,255,0.13)';
            g.beginPath(); g.moveTo(Math.round(x0) + 0.5, top);
            g.lineTo(Math.round(x0) + 0.5, bot); g.stroke();
        });
    }

    /* One column per pixel, min AND max of everything inside it. A whole
       session is ~2 s per column: sampling one value per column turns a lap
       into a picket fence, which is what the shipping strip does. An
       envelope — the way an editor draws audio — stays readable at any zoom
       and collapses to a plain line once you are closer than one sample per
       pixel. */
    var lo = [], hi = [];
    for (var px = 0; px <= W; px++) {
        var ta = from + span * px / W, tb = from + span * (px + 1) / W;
        if (tb < 0 || ta > SESS) { lo.push(null); hi.push(null); continue; }
        var ia = Math.max(0, Math.min(N - 1, Math.floor(ta * HZ)));
        var ib = Math.max(0, Math.min(N - 1, Math.ceil(tb * HZ)));
        var mn = Infinity, mx = -Infinity;
        for (var q = ia; q <= ib; q++) {
            if (SPD[q] < mn) mn = SPD[q];
            if (SPD[q] > mx) mx = SPD[q];
        }
        if (ib - ia < 2) { mn = mx = spd(Math.max(0, Math.min(SESS, (ta + tb) / 2))); }
        lo.push(mn); hi.push(mx);
    }
    var yOf = function (v) { return bot - (v / TOP) * (hh - 2) - 1; };

    function band(arr, style) {
        g.beginPath();
        var open = false;
        for (var i = 0; i <= W; i++) {
            if (arr[i] == null) { if (open) { g.lineTo(i, bot); open = false; } continue; }
            var y = yOf(arr[i]);
            if (!open) { g.moveTo(i, bot); g.lineTo(i, y); open = true; }
            else g.lineTo(i, y);
        }
        if (open) g.lineTo(W, bot);
        g.closePath();
        g.fillStyle = style; g.fill();
    }
    band(hi, opt.fill || 'rgba(232,232,232,0.11)');
    band(lo, opt.fill2 || 'rgba(232,232,232,0.10)');

    g.beginPath();
    var open2 = false;
    for (var j = 0; j <= W; j++) {
        if (hi[j] == null) { open2 = false; continue; }
        var y2 = yOf(hi[j]);
        if (!open2) { g.moveTo(j, y2); open2 = true; } else g.lineTo(j, y2);
    }
    g.lineWidth = 1;
    g.strokeStyle = opt.stroke || 'rgba(232,232,232,0.46)';
    g.stroke();

    if (opt.outside !== false && from < 0) {
        var xz = (0 - from) / span * W;
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, top, xz, hh);
    }
}

/* A frame of footage that never existed. Sky, horizon, road, kerbs, and
   markings that move at the speed the trace says the car was doing — so a
   filmstrip reads as motion rather than as grey boxes, and dragging one
   against the trace feels like the real job. */
function paintFrame(g, x, y, w, h, t, cam) {
    var v = spd(t), d = dist(t);
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();

    var warm = cam === 'B' ? 1 : 0;
    var hz = y + h * 0.44;
    var sky = g.createLinearGradient(0, y, 0, hz);
    sky.addColorStop(0, warm ? '#5d6f80' : '#48596a');
    sky.addColorStop(1, warm ? '#a9b6c0' : '#8ea2b2');
    g.fillStyle = sky; g.fillRect(x, y, w, hz - y);

    g.fillStyle = warm ? '#4e5a3f' : '#44513b';
    g.fillRect(x, hz, w, h - (hz - y));

    /* the road, swinging with the corner the speed says we are in */
    var swing = Math.sin(d / 260) * w * 0.16 * (1 - v / TOP);
    var cx = x + w / 2 + swing;
    var halfTop = w * 0.045, halfBot = w * 0.62;
    g.beginPath();
    g.moveTo(cx - halfTop, hz); g.lineTo(cx + halfTop, hz);
    g.lineTo(x + w / 2 + halfBot, y + h); g.lineTo(x + w / 2 - halfBot, y + h);
    g.closePath();
    g.fillStyle = '#3b3f43'; g.fill();

    /* kerbs, on the inside of the corner only */
    if (v < TOP * 0.72) {
        var side = swing > 0 ? -1 : 1;
        for (var k = 0; k < 7; k++) {
            var f = k / 7, f2 = (k + 0.5) / 7;
            var yA = hz + (h - (hz - y)) * f * f, yB = hz + (h - (hz - y)) * f2 * f2;
            var wA = halfTop + (halfBot - halfTop) * f * f;
            var wB = halfTop + (halfBot - halfTop) * f2 * f2;
            g.fillStyle = ((k + ((d / 6) | 0)) % 2) ? '#c8483f' : '#dcdcda';
            g.beginPath();
            g.moveTo(cx + side * wA, yA); g.lineTo(cx + side * wA * 1.14, yA);
            g.lineTo(x + w / 2 + side * wB * 1.14, yB); g.lineTo(x + w / 2 + side * wB, yB);
            g.closePath(); g.fill();
        }
    }

    /* centre dashes, moving with distance travelled */
    g.fillStyle = 'rgba(230,230,225,0.55)';
    var phase = (d / 14) % 1;
    for (var m = 0; m < 6; m++) {
        var p0 = (m + phase) / 6, p1 = p0 + 0.055;
        if (p1 > 1) continue;
        var yy0 = hz + (h - (hz - y)) * p0 * p0, yy1 = hz + (h - (hz - y)) * p1 * p1;
        var ww = 1 + 7 * p1 * p1;
        var cx0 = cx + (x + w / 2 - cx) * p0 * p0, cx1 = cx + (x + w / 2 - cx) * p1 * p1;
        g.beginPath();
        g.moveTo(cx0 - ww * 0.35, yy0); g.lineTo(cx0 + ww * 0.35, yy0);
        g.lineTo(cx1 + ww * 0.5, yy1); g.lineTo(cx1 - ww * 0.5, yy1);
        g.closePath(); g.fill();
    }

    /* bonnet, so the eye knows it is looking out of a car */
    g.fillStyle = warm ? '#1b1d20' : '#232629';
    g.beginPath();
    g.moveTo(x, y + h); g.lineTo(x, y + h * 0.90);
    g.quadraticCurveTo(x + w / 2, y + h * 0.78, x + w, y + h * 0.90);
    g.lineTo(x + w, y + h); g.closePath(); g.fill();

    g.restore();
}

/* A row of frames across a surface. `n` is chosen so each thumbnail keeps a
   16:9-ish shape, which is what makes the strip read as film. */
function paintStrip(cv, from, to, cam, opt) {
    var c = fit(cv); if (!c) return;
    opt = opt || {};
    var g = c.g, W = c.w, H = c.h;
    var fw = Math.max(24, H * 16 / 9);
    var n = Math.max(1, Math.round(W / fw));
    fw = W / n;
    for (var i = 0; i < n; i++) {
        var t = from + (to - from) * (i + 0.5) / n;
        paintFrame(g, i * fw, 0, fw + 0.5, H, t, cam);
        if (i) {
            g.fillStyle = 'rgba(0,0,0,0.45)';
            g.fillRect(i * fw - 0.5, 0, 1, H);
        }
    }
    if (opt.dim) { g.fillStyle = 'rgba(22,24,27,' + opt.dim + ')'; g.fillRect(0, 0, W, H); }
}

/* ===========================================================================
   6. Surfaces: click to seek, drag to seek, wheel to zoom, hover to read
   =========================================================================== */
function surface(node, o) {
    o = o || {};
    var win = o.win || view;
    function xToT(ev) {
        var r = node.getBoundingClientRect();
        var v = win();
        return v.from + (v.to - v.from) * ((ev.clientX - r.left) / r.width);
    }
    node._xToT = xToT;
    node._tToX = function (t) {
        var v = win();
        return (t - v.from) / (v.to - v.from);
    };
    if (o.seek !== false) {
        node.addEventListener('pointerdown', function (ev) {
            if (ev.target.closest('[data-nodrag]')) return;
            if (ev.button !== 0) return;
            node.setPointerCapture(ev.pointerId);
            S.playing = false;
            seek(xToT(ev));
            var mv = function (e) { seek(xToT(e)); };
            var up = function () {
                node.removeEventListener('pointermove', mv);
                node.removeEventListener('pointerup', up);
            };
            node.addEventListener('pointermove', mv);
            node.addEventListener('pointerup', up);
        });
    }
    if (o.hover !== false) {
        var lab = mk('div', 'hovlab');
        lab.style.display = 'none';
        node.appendChild(lab);
        node.addEventListener('pointermove', function (ev) {
            var r = node.getBoundingClientRect();
            var t = xToT(ev);
            lab.style.display = '';
            lab.textContent = (o.hoverText || function (x) { return clockT(x); })(t);
            var lw = lab.offsetWidth || 40;
            lab.style.left = Math.max(0, Math.min(r.width - lw, ev.clientX - r.left + 8)) + 'px';
        });
        node.addEventListener('pointerleave', function () { lab.style.display = 'none'; });
    }
    if (o.zoom) {
        node.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            var v = win(), span = v.to - v.from;
            var r = node.getBoundingClientRect();
            var f = (ev.clientX - r.left) / r.width;
            var anchor = v.from + span * f;
            var k = ev.deltaY > 0 ? 1.22 : 1 / 1.22;
            var ns = Math.max(3, Math.min(SESS + 80, span * k));
            zoomTo(anchor - ns * f, anchor - ns * f + ns);
        }, { passive: false });
    }
    return node;
}

/* Drag a clip along a surface whose pixels-per-second is known. */
function dragClip(node, clip, pxPerSec, opts) {
    opts = opts || {};
    node.addEventListener('pointerdown', function (ev) {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        S.sel = clip.id;
        node.setPointerCapture(ev.pointerId);
        node.classList.add('dragging');
        var x0 = ev.clientX, s0 = clip.start;
        var tip = mk('div', 'hovlab');
        tip.style.top = '-1px';
        node.parentNode.appendChild(tip);
        var mv = function (e) {
            var k = pxPerSec();
            var d = (e.clientX - x0) / k;
            if (e.shiftKey) d *= 0.12;              /* fine */
            var want = s0 + d;
            if (!e.altKey) want = Math.round(want / FRAME) * FRAME;
            clip.start = want;
            tip.textContent = signed(clip.start - TRUTH[clip.id]) + ' from where it landed';
            var r = node.getBoundingClientRect(), pr = node.parentNode.getBoundingClientRect();
            tip.style.left = Math.max(0, r.left - pr.left) + 'px';
            if (opts.onMove) opts.onMove();
        };
        var up = function () {
            node.classList.remove('dragging');
            node.removeEventListener('pointermove', mv);
            node.removeEventListener('pointerup', up);
            if (tip.parentNode) tip.parentNode.removeChild(tip);
            if (opts.onEnd) opts.onEnd();
        };
        node.addEventListener('pointermove', mv);
        node.addEventListener('pointerup', up);
    });
}

/* Ruler ticks that read as clock time into the recording. */
function tickStep(span) {
    var want = span / 8;
    var opts = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    for (var i = 0; i < opts.length; i++) if (opts[i] >= want) return opts[i];
    return 900;
}
function rulerHtml(from, to) {
    var span = to - from, st = tickStep(span), h = '';
    for (var s = Math.ceil(from / st) * st; s <= to; s += st) {
        h += "<div class='tick' style='left:" + pct((s - from) / span) + "'>" + clock(s) + "</div>";
    }
    return h;
}

/* ===========================================================================
   7. The mock mosaic — so a bar is judged with a picture above it
   =========================================================================== */
function mosaic() {
    var wrap = mk('div', 'mos');

    var v = mk('div', 'pan vid');
    v.innerHTML = "<div class='ph'>Video <span class='sub'></span></div>" +
                  "<div class='pb'><canvas></canvas>" +
                  "<div class='vhud'><b>0</b><i>KM/H</i></div>" +
                  "<div class='vnofilm' style='display:none'></div></div>";
    var vcv = v.querySelector('canvas'), vsub = v.querySelector('.sub');
    var vhud = v.querySelector('.vhud b'), vno = v.querySelector('.vnofilm');

    var gr = mk('div', 'pan graph');
    gr.innerHTML = "<div class='ph'>Speed <span class='sub'></span></div>" +
                   "<div class='pb'><canvas></canvas><div class='head' style='left:50%'></div></div>";
    var gcv = gr.querySelector('canvas'), ghd = gr.querySelector('.head'), gsub = gr.querySelector('.sub');
    /* The rack draws the LAP you are in, not the whole day — a day squeezed
       into 300 px is a picket fence, and it is not what Analyse shows. */
    var gwin = function () { var L = lapAt(S.t); return { from: L.from, to: L.to }; };
    surface(gr.querySelector('.pb'), { win: gwin });

    wrap.appendChild(v); wrap.appendChild(gr);

    
    onTick(function () {
        var c = clipAt(S.t);
        vsub.textContent = c ? c.name + ' · ' + clockT(S.t - c.start) + ' in' : 'no footage here';
        vno.style.display = c ? 'none' : '';
        if (!c) {
            var nx = nextClip(S.t);
            vno.innerHTML = nx ? 'No footage over this stretch.<br>Next section in ' + clock(nx.start - S.t)
                               : 'No footage over this stretch.';
        }
        vhud.textContent = Math.round(spd(S.t));
        if (c) {
            var f = fit(vcv);
            if (f) paintFrame(f.g, 0, 0, f.w, f.h, S.t, c.cam);
        }
        var L = lapAt(S.t);
        gsub.textContent = lapName(L) + (L.kind === 'lap' ? ' · ' + lapTime(L.dur) : '');
        var w = gwin();
        ghd.style.left = pct((S.t - w.from) / (w.to - w.from));
        var r = gcv.getBoundingClientRect();
        var sig = w.from.toFixed(1) + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
        if (gcv._sig !== sig) { gcv._sig = sig; paintTrace(gcv, w.from, w.to, { laps: false }); }
    });
    return wrap;
}

/* ===========================================================================
   8. The shell
   =========================================================================== */
var DESIGNS = [];
function design(d) { DESIGNS.push(d); }

var current = null;

function stageFor(d) {
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    tickers.length = 0;
    stage.appendChild(mosaic());

    if (d.panel) {
        var lab = mk('div', 'slotlab', d.panelLabel || 'Footage timeline &mdash; panel');
        var p = mk('div', 'pan');
        p.style.flex = '0 0 ' + (d.panelH || 168) + 'px';
        p.style.minHeight = '0';
        if (d.join) { p.style.marginBottom = '-10px'; }
        stage.appendChild(lab);
        stage.appendChild(p);
        d.panel(p);
    }
    var dock = mk('div', 'dock' + (d.join ? ' flush' : ''));
    stage.appendChild(dock);
    d.dock(dock);
    current = d;
    runTickers();
}

/* Everything on screen is written by the tick, so the first frame has to be
   one — otherwise the bar is briefly blank, and in a webview that has paused
   its animation frames it stays blank. */
function runTickers() {
    for (var i = 0; i < tickers.length; i++) {
        try { tickers[i](); } catch (e) {}
    }
}

function compare() {
    var stage = document.getElementById('stage');
    stage.innerHTML = '';
    tickers.length = 0;
    var wrap = mk('div', 'cmp');
    stage.appendChild(wrap);
    var rows = [];
    DESIGNS.forEach(function (d) {
        var row = mk('div', 'row');
        /* Two of these are only half a design down here. Saying so beats
           letting the row look like the whole answer. */
        var half = d.panel ? " <span style='color:var(--gpb-warn)'>&mdash; the other half is a " +
                             "panel above the bar; open tab " + d.num + " to see it</span>" : '';
        row.innerHTML = "<div class='rl'><b>" + d.num + '. ' + esc(d.name) + "</b>" +
                        "<span class='pill'>" + esc(d.kind) + "</span>" +
                        "<span>" + esc(d.tag) + half + "</span></div>";
        var host = mk('div', 'host');
        row.appendChild(host);
        wrap.appendChild(row);
        d.dock(host);
        /* What it actually costs in screen, measured rather than claimed —
           the one number that decides this on a laptop. */
        rows.push({ d: d, host: host, lab: row.querySelector('.rl') });
    });
    current = null;
    runTickers();
    requestAnimationFrame(function () {
        rows.forEach(function (r) {
            var h = Math.round(r.host.getBoundingClientRect().height);
            var p = r.d.panelH ? ' + ' + r.d.panelH + ' px panel' : '';
            var s = mk('span', 'pill', h + ' px bar' + p);
            s.style.marginLeft = 'auto';
            r.lab.appendChild(s);
        });
    });
    renderSide();
}

/* ---- picks ---------------------------------------------------------- */
var PICKS = {};
try { PICKS = JSON.parse(localStorage.getItem('rdm_ft_picks') || '{}'); } catch (e) { PICKS = {}; }
function savePicks() {
    try { localStorage.setItem('rdm_ft_picks', JSON.stringify(PICKS)); } catch (e) {}
}

function renderSide() {
    var side = document.getElementById('side');
    var d = current;
    if (!d) {
        side.innerHTML = "<h2>Compare</h2><p class='tag'>Every bar, one playhead, same moment. " +
            "Press play and watch all five move.</p>" +
            "<h4>What to look for</h4><ul>" +
            "<li><b>Where is the time?</b> Two of these put the reading where your eye already is; " +
            "two make you find it.</li>" +
            "<li><b>What happens at a gap?</b> Scrub to about 6:48 — the five seconds between the " +
            "two GoPro files — and see which bars say so. Then go past 13:35, where the only file " +
            "left is the one that will not decode.</li>" +
            "<li><b>Does the bar move?</b> The shipping one swaps its whole contents when you click " +
            "the video panel. None of these do.</li></ul>" +
            "<h4>My picks so far</h4><div id='picksum'></div>" +
            "<div class='verdict'><button class='gbtn' id='copypicks'>Copy picks</button>" +
            "<button class='gbtn' id='clearpicks'>Clear</button></div>";
        var sum = side.querySelector('#picksum');
        var txt = DESIGNS.map(function (x) {
            var p = PICKS[x.id] || {};
            var v = p.v === 'y' ? 'YES' : p.v === 'm' ? 'maybe' : p.v === 'n' ? 'no' : '—';
            return x.num + '. ' + x.name + ': ' + v + (p.note ? '\n     ' + p.note : '');
        }).join('\n');
        sum.textContent = txt;
        side.querySelector('#copypicks').onclick = function () {
            navigator.clipboard.writeText(txt);
            this.textContent = 'Copied';
            var b = this; setTimeout(function () { b.textContent = 'Copy picks'; }, 1200);
        };
        side.querySelector('#clearpicks').onclick = function () {
            PICKS = {}; savePicks(); renderSide();
        };
        return;
    }
    var p = PICKS[d.id] || {};
    var h = "<span class='kind'>" + esc(d.kind) + "</span>" +
            "<h2>" + esc(d.name) + "</h2><p class='tag'>" + d.tag + "</p>" +
            "<p>" + d.argument + "</p>" +
            "<h4>What it fixes</h4><ul>" + d.fixes.map(function (x) { return '<li>' + x + '</li>'; }).join('') + "</ul>" +
            "<h4>What it costs</h4><ul>" + d.costs.map(function (x) { return '<li>' + x + '</li>'; }).join('') + "</ul>" +
            "<h4>Try it</h4><ul>" + d.tryit.map(function (x) { return '<li>' + x + '</li>'; }).join('') + "</ul>" +
            "<h4>Verdict</h4><div class='verdict'>" +
            "<button class='gbtn" + (p.v === 'y' ? ' prim' : '') + "' data-v='y'>Yes</button>" +
            "<button class='gbtn" + (p.v === 'm' ? ' prim' : '') + "' data-v='m'>Maybe</button>" +
            "<button class='gbtn" + (p.v === 'n' ? ' prim' : '') + "' data-v='n'>No</button></div>" +
            "<textarea placeholder='What you would change'>" + esc(p.note || '') + "</textarea>" +
            "<h4>Keys</h4><div class='keys'>" +
            "<kbd>space</kbd>play &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd>step &nbsp; " +
            "<kbd>1</kbd>&hellip;<kbd>5</kbd>design &nbsp; <kbd>0</kbd>compare<br>" +
            "<kbd>wheel</kbd>zoom a timeline &nbsp; <kbd>shift</kbd>+drag a section for fine nudge</div>";
    side.innerHTML = h;
    Array.prototype.forEach.call(side.querySelectorAll('.verdict button'), function (b) {
        b.onclick = function () {
            PICKS[d.id] = PICKS[d.id] || {};
            PICKS[d.id].v = b.getAttribute('data-v');
            savePicks(); renderSide();
        };
    });
    var ta = side.querySelector('textarea');
    ta.onchange = ta.onblur = function () {
        PICKS[d.id] = PICKS[d.id] || {};
        PICKS[d.id].note = ta.value;
        savePicks();
    };
}

function show(id) {
    var d = null;
    DESIGNS.forEach(function (x) { if (x.id === id) d = x; });
    S.zoom = null;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
        b.classList.toggle('on', b.getAttribute('data-id') === id);
    });
    if (id === 'compare') { compare(); return; }
    if (!d) return;
    S.design = id;
    stageFor(d);
    renderSide();
}

function boot() {
    var tabs = document.getElementById('tabs');
    DESIGNS.forEach(function (d) {
        var b = mk('button', '', "<i>" + d.num + "</i>" + esc(d.name));
        b.setAttribute('data-id', d.id);
        b.title = d.tag;
        b.onclick = function () { show(d.id); };
        tabs.appendChild(b);
    });
    var cb = mk('button', '', 'Compare bars');
    cb.setAttribute('data-id', 'compare');
    cb.onclick = function () { show('compare'); };
    tabs.appendChild(cb);

    document.addEventListener('keydown', function (ev) {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
        if (ev.key === ' ') { ev.preventDefault(); toggle(); }
        else if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(ev.shiftKey ? -FRAME : -1); }
        else if (ev.key === 'ArrowRight') { ev.preventDefault(); step(ev.shiftKey ? FRAME : 1); }
        else if (ev.key === 'Home') seek(0);
        else if (ev.key === 'End') seek(SESS);
        else if (ev.key >= '1' && ev.key <= '5') { var d = DESIGNS[+ev.key - 1]; if (d) show(d.id); }
        else if (ev.key === '0') show('compare');
    });

    var last = 0;
    function frame(ts) {
        if (S.playing) {
            var dt = (ts - last) / 1000;
            if (dt > 0 && dt < 0.5) S.t += dt * S.rate;
            if (S.t >= SESS) { S.t = SESS; S.playing = false; }
        }
        last = ts;
        for (var i = 0; i < tickers.length; i++) {
            try { tickers[i](); } catch (e) { /* one bad ticker must not stop the rest */ }
        }
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    show(DESIGNS[0].id);
}

return {
    /* model */
    SESS: SESS, LAPS: LAPS, CLIPS: CLIPS, CAMS: CAMS, BEST: BEST, FRAME: FRAME, TOP: TOP,
    S: S, TRUTH: TRUTH,
    spd: spd, dist: dist, clipAt: clipAt, clipsAt: clipsAt, nextClip: nextClip,
    coverage: coverage, matchOf: matchOf, lapAt: lapAt, lapName: lapName,
    /* format */
    clock: clock, clockT: clockT, lapTime: lapTime, signed: signed, esc: esc, pct: pct,
    /* control */
    seek: seek, step: step, toggle: toggle, view: view, zoomTo: zoomTo, onTick: onTick,
    /* dom */
    el: el, mk: mk, transport: transport, rateSeg: rateSeg, SVG: SVG,
    /* paint */
    fit: fit, paintTrace: paintTrace, paintFrame: paintFrame, paintStrip: paintStrip,
    /* surfaces */
    surface: surface, dragClip: dragClip, rulerHtml: rulerHtml, tickStep: tickStep,
    /* shell */
    design: design, boot: boot, show: show
};
})();
