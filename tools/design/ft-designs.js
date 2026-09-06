/* ===========================================================================
   Five designs for the footage timeline and the transport bar.

   Two of them fold the timeline INTO the bar (1, 3), one folds the bar into
   the timeline (4), and two keep them apart on purpose (2, 5). They are
   deliberately not variations on each other — the point is to find out which
   shape the job actually wants, not which shade of blue.
   =========================================================================== */
(function (F) {
'use strict';

var mk = F.mk, pct = F.pct, esc = F.esc, S = F.S;

/* Repaint only when something that affects the picture changed. A trace
   repaint per animation frame is affordable but pointless. */
function repaintOn(cv, sig, paint) {
    F.onTick(function () {
        var r = cv.getBoundingClientRect();
        var k = sig() + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
        if (cv._sig === k) return;
        cv._sig = k;
        paint();
    });
}
function viewSig() { var v = F.view(); return v.from.toFixed(2) + ',' + v.to.toFixed(2); }

/* Where the pointer is, in seconds, for a surface using the shared view. */
function ppsOf(node) {
    return function () {
        var v = F.view();
        return node.getBoundingClientRect().width / (v.to - v.from);
    };
}

/* The three words under the playhead that the shipping build only prints in
   one of its two timeline forms. */
function footageWord() {
    var c = F.clipAt(S.t);
    if (c) return esc(c.name) + ' &middot; ' + F.clockT(S.t - c.start) + ' in';
    var n = F.nextClip(S.t);
    if (n) return "<span style='color:var(--gpb-warn)'>no footage &mdash; next in " +
                  F.clock(n.start - S.t) + '</span>';
    return "<span style='color:var(--gpb-ghost)'>no footage here</span>";
}

/* A shared "whole recording" escape for the designs that zoom. */
function zoomOut(btn) {
    F.onTick(function () { btn.style.display = S.zoom ? '' : 'none'; });
    btn.onclick = function () { S.zoom = null; };
}

/* ===========================================================================
   1 — ONE BAR
   ===========================================================================
   The timeline and the transport are the same object, full width, always
   present, never swapping its contents for six readouts. One surface carries
   three things on three bands: which lap (top), what the car was doing
   (middle), what film exists (bottom).
   =========================================================================== */
F.design({
    id: 'one', num: 1, name: 'One Bar', kind: 'combined',
    tag: 'The timeline IS the scrubber. One surface, always there.',
    argument: 'The shipping build has a transport bar that swaps its whole contents ' +
        'for a timeline when you click the video panel, a second compact timeline ' +
        'inside the video panel’s control row, and a third transport that appears ' +
        'when the picture goes Free. This is all three, once. The strip is the scrub: ' +
        'there is no separate slider to disagree with it.',
    fixes: [
        'One transport on screen instead of three.',
        'The bar never changes shape, so the play button never moves.',
        '<b>Laps, speed and footage share one axis</b> — you line a clip up against the braking point directly under it.',
        'A gap in the footage is drawn as a gap, not as a player that stopped.',
        'One hue for film plus state, instead of blue / green / pink / red‑brown with no legend.'
    ],
    costs: [
        'A third camera is a 4 px ribbon — easy to see, and grabbable only because it carries a hidden 10 px target.',
        'Serious multi‑cam arranging still wants a taller surface.',
        'The bar is 74 px tall — about 30 px more than today’s.'
    ],
    tryit: [
        'Scrub to ~6:48 — the five seconds between the two GoPro files — and watch the bar say so.',
        'Drag the light ribbon under the trace — that is aligning a section.',
        'Hold <b>shift</b> while dragging for hundredths.',
        'Wheel over the strip to zoom into a braking point.'
    ],
    dock: function (host) {
        var row = mk('div', 'd1');

        row.appendChild(F.transport());

        var tb = mk('div');
        tb.style.cssText = 'flex:none;min-width:132px';
        tb.innerHTML = "<div class='big'><b class='tt'></b><small class='ll'></small></div>" +
                       "<div style='font-size:10.5px;color:var(--gpb-muted);white-space:nowrap;" +
                       "overflow:hidden;text-overflow:ellipsis' class='fw'></div>";
        row.appendChild(tb);
        var tt = tb.querySelector('.tt'), ll = tb.querySelector('.ll'), fw = tb.querySelector('.fw');

        var strip = mk('div', 'surf strip');
        strip.style.height = '58px';
        row.appendChild(strip);

        var LAPH = 14, FILMH = 15;
        var cv = mk('canvas', 'back');
        cv.style.top = LAPH + 'px';
        cv.style.height = 'calc(100% - ' + (LAPH + FILMH) + 'px)';
        cv.style.bottom = 'auto';
        strip.appendChild(cv);

        /* lap bands: the only place in the app where "which lap is this bit"
           is answered on the timeline itself */
        var bands = mk('div');
        bands.style.cssText = 'position:absolute;left:0;right:0;top:0;height:' + LAPH + 'px;z-index:2';
        strip.appendChild(bands);

        var films = mk('div');
        films.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + FILMH + 'px;z-index:4';
        strip.appendChild(films);

        var head = mk('div', 'head');
        strip.appendChild(head);

        F.surface(strip, { zoom: true, hoverText: function (t) {
            return F.clockT(t) + '  ' + Math.round(F.spd(t)) + ' km/h';
        } });

        var pps = ppsOf(strip);
        var bandEls = [], filmEls = [];

        function layout() {
            var v = F.view(), span = v.to - v.from;
            bands.innerHTML = ''; bandEls = [];
            F.LAPS.forEach(function (L) {
                var b = mk('div', 'lapband' + (L.kind !== 'lap' ? ' px' : ''));
                b.style.left = pct((L.from - v.from) / span);
                b.style.width = pct(L.dur / span);
                b.textContent = L.kind === 'lap' ? 'L' + L.num : F.lapName(L);
                b.title = F.lapName(L) + (L.kind === 'lap' ? ' — ' + F.lapTime(L.dur) : '') +
                          (L.note ? ' (' + L.note + ')' : '') + '  — click to jump here';
                b.setAttribute('data-nodrag', '1');
                b.onclick = function (e) { e.stopPropagation(); F.seek(L.from + 0.1); };
                bands.appendChild(b); bandEls.push({ el: b, L: L });
            });

            films.innerHTML = ''; filmEls = [];
            F.CLIPS.forEach(function (c) {
                var f = mk('div', 'film' + (c.dead ? ' dead' : ''));
                f.style.height = '4px';
                f.style.bottom = (1 + c.lane * 5) + 'px';
                f.title = c.name + ' — ' + F.CAMS[c.cam] + ' — ' +
                          F.clock(c.dur) + ' long, lined up by ' + c.src +
                          (c.dead ? ' — this file will not decode here' : '') +
                          '  — drag to move it';
                films.appendChild(f);
                F.dragClip(f, c, pps, { onMove: place });
                filmEls.push({ el: f, c: c });
            });
            place();
        }

        function place() {
            var v = F.view(), span = v.to - v.from;
            bandEls.forEach(function (o) {
                o.el.style.left = pct((o.L.from - v.from) / span);
                o.el.style.width = pct(o.L.dur / span);
            });
            filmEls.forEach(function (o) {
                o.el.style.left = pct((o.c.start - v.from) / span);
                o.el.style.width = pct(o.c.dur / span);
            });
        }

        layout();
        repaintOn(cv, viewSig, function () {
            var v = F.view();
            F.paintTrace(cv, v.from, v.to, { laps: false });
            place();
        });

        var zo = mk('button', 'gbtn', 'Whole');
        zo.title = 'Back to the whole recording';
        zoomOut(zo);
        row.appendChild(zo);
        row.appendChild(F.rateSeg());

        F.onTick(function () {
            var v = F.view(), span = v.to - v.from;
            head.style.left = pct((S.t - v.from) / span);
            tt.textContent = F.clockT(S.t);
            var L = F.lapAt(S.t);
            ll.textContent = ' ' + (L.kind === 'lap' ? 'L' + L.num : F.lapName(L));
            fw.innerHTML = footageWord();
            var cur = F.lapAt(S.t);
            bandEls.forEach(function (o) { o.el.classList.toggle('on', o.L === cur); });
            var live = F.clipsAt(S.t);
            filmEls.forEach(function (o) { o.el.classList.toggle('on', live.indexOf(o.c) >= 0); });
        });

        host.appendChild(row);
    }
});

/* ===========================================================================
   2 — TRACK SHEET
   ===========================================================================
   A real NLE panel, with the two things every NLE has and this one does not:
   a named gutter down the left, and an inspector for the selected clip. The
   toolbar drops from twelve controls to four because the fine controls
   belong to the thing they act on.
   =========================================================================== */
F.design({
    id: 'sheet', num: 2, name: 'Track Sheet', kind: 'panel + plain bar',
    tag: 'A proper editor upstairs; a transport that never changes downstairs.',
    panelLabel: 'Footage timeline &mdash; panel (takes a mosaic slot)',
    panelH: 246,
    argument: 'Arranging footage is editing, and editing wants an editor: named ' +
        'lanes, filmstrips, a selected clip with an inspector. The bottom bar then ' +
        'goes back to being a transport and stops swapping itself out. The twelve‑control ' +
        'toolbar collapses to four, because Nudge and Sync belong to the clip you clicked, ' +
        'not to the panel.',
    fixes: [
        '<b>Lanes have names.</b> Today they are unlabelled 16‑ or 30‑px strips.',
        'Clips carry a filmstrip, so you can see which camera and roughly where you are.',
        'The nudge cluster and the sync source move into an inspector for the selected clip — they never act on a clip you did not choose.',
        'The bottom bar stops mutating: same six controls in Analyse, Drift and Corners.',
        'A clip that starts before the recording is drawn, not hidden off the left edge.'
    ],
    costs: [
        'It eats a mosaic slot — 246 px of a laptop screen.',
        'Two surfaces to look at while syncing: the panel and the bar.',
        'Most sessions have one camera, and this is a lot of furniture for one camera.'
    ],
    tryit: [
        'Click a clip — the inspector below names it and points the nudge at it.',
        'Drag <b>VBOX_0007</b> (the amber one, lane C): a file that will not decode still has a place on the sheet.',
        'Watch the coverage figure in the toolbar as you drag.'
    ],
    panel: function (host) {
        var RUL = 16, REC = 52, LANE = 34, ADD = 20;
        var lanes = 3;
        var wrap = mk('div', 'd2');

        var bar = mk('div', 'bar');
        bar.innerHTML = "<button class='gbtn prim'>+ Footage</button>";
        var zsl = mk('input');
        zsl.type = 'range'; zsl.min = 0; zsl.max = 100; zsl.value = 0;
        zsl.style.cssText = 'width:120px;accent-color:#e8e8e8';
        zsl.title = 'Zoom — whole recording to ten seconds';
        zsl.oninput = function () {
            var f = zsl.value / 100;
            var span = F.SESS * Math.pow(10 / F.SESS, f);
            if (f < 0.02) { S.zoom = null; return; }
            F.zoomTo(S.t - span / 2, S.t + span / 2);
        };
        bar.appendChild(mk('span', 'kap', 'Zoom'));
        bar.appendChild(zsl);
        var snap = mk('button', 'gbtn on', 'Snap');
        snap.title = 'Snap a dragged section to the start of the recording, to the playhead ' +
                     'and to the other sections. Hold Alt to ignore it once.';
        snap.onclick = function () { snap.classList.toggle('on'); };
        bar.appendChild(snap);
        bar.appendChild(mk('span', '', '')).style.flex = '1';
        var cov = mk('span', 'kap');
        bar.appendChild(cov);
        wrap.appendChild(bar);

        var body = mk('div', 'body');
        var gut = mk('div', 'gut');
        var tracks = mk('div', 'tracks surf');
        body.appendChild(gut); body.appendChild(tracks);
        wrap.appendChild(body);

        var insp = mk('div', 'insp');
        wrap.appendChild(insp);
        host.appendChild(wrap);

        /* the gutter: one row per track, the same heights as the tracks */
        function gutRow(h, cls, html) {
            var r = mk('div', 'r' + (cls ? ' ' + cls : ''), html);
            r.style.height = h + 'px';
            gut.appendChild(r);
            return r;
        }
        gutRow(RUL, 'rul', '');
        gutRow(REC, '', "<span class='sw' style='background:#e8e8e8'></span>" +
                        "<span class='n'>Recording</span><small>" + F.clock(F.SESS) + "</small>");
        ['A', 'B', 'C'].forEach(function (cam, i) {
            gutRow(LANE, '', "<span class='sw' style='background:var(--film)'></span>" +
                   "<span class='n'>Camera " + cam + "</span>");
            gut.lastChild.title = F.CAMS[cam];
        });
        gutRow(ADD, 'add', '+ drop a file');

        var rul = mk('div', 'tickrow');
        rul.style.height = RUL + 'px';
        rul.style.borderBottom = '1px solid var(--gpb-div)';
        tracks.appendChild(rul);

        var cv = mk('canvas', 'back');
        cv.style.top = RUL + 'px';
        cv.style.height = REC + 'px';
        cv.style.bottom = 'auto';
        tracks.appendChild(cv);

        var laneEls = [];
        for (var i = 0; i < lanes; i++) {
            var L = mk('div', 'lane');
            L.style.top = (RUL + REC + i * LANE) + 'px';
            L.style.height = LANE + 'px';
            tracks.appendChild(L);
            laneEls.push(L);
        }
        var drop = mk('div', 'lane drop');
        drop.style.top = (RUL + REC + lanes * LANE) + 'px';
        drop.style.height = ADD + 'px';
        tracks.appendChild(drop);

        var head = mk('div', 'head');
        tracks.appendChild(head);

        F.surface(tracks, { zoom: true });
        var pps = ppsOf(tracks);

        var clipEls = F.CLIPS.map(function (c) {
            var e = mk('div', 'clip' + (c.dead ? ' dead' : ''));
            e.style.top = (RUL + REC + c.lane * LANE + 2) + 'px';
            e.style.height = (LANE - 5) + 'px';
            e.style.bottom = 'auto';
            e.innerHTML = "<canvas></canvas><span class='nm'>" + esc(c.name) + "</span>" +
                          "<span class='dr'>" + F.clock(c.dur) + "</span>";
            e.title = c.name + ' — ' + F.CAMS[c.cam];
            tracks.appendChild(e);
            F.dragClip(e, c, pps, { onMove: place, onEnd: paintStrips });
            e.addEventListener('click', function (ev) { ev.stopPropagation(); S.sel = c.id; drawInsp(); });
            return { el: e, c: c, cv: e.querySelector('canvas') };
        });

        function place() {
            var v = F.view(), span = v.to - v.from;
            clipEls.forEach(function (o) {
                o.el.style.left = pct((o.c.start - v.from) / span);
                o.el.style.width = pct(o.c.dur / span);
                o.el.classList.toggle('sel', S.sel === o.c.id);
            });
        }
        function paintStrips() {
            clipEls.forEach(function (o) {
                if (o.c.dead) return;
                F.paintStrip(o.cv, 0, o.c.dur, o.c.cam, { dim: 0.15 });
            });
        }

        repaintOn(cv, viewSig, function () {
            var v = F.view();
            F.paintTrace(cv, v.from, v.to, {});
            rul.innerHTML = F.rulerHtml(v.from, v.to);
            place();
        });
        var ro = new ResizeObserver(function () { paintStrips(); });
        ro.observe(tracks);
        setTimeout(paintStrips, 30);

        /* ---- the inspector: everything that acts on ONE clip ---- */
        function drawInsp() {
            var c = null;
            F.CLIPS.forEach(function (x) { if (x.id === S.sel) c = x; });
            insp.innerHTML = '';
            if (!c) {
                insp.appendChild(mk('span', 'hint', 'Click a section to line it up.'));
                place();
                return;
            }
            insp.appendChild(mk('span', 'nm', esc(c.name)));
            insp.appendChild(mk('span', 'kap', 'Camera ' + c.cam));
            insp.appendChild(mk('div', 'vr2'));
            insp.appendChild(mk('span', 'kap', 'Nudge'));
            var nz = mk('div', 'nudge');
            [[-1, '◀◀', 'A second earlier'], [-0.1, '◀', 'A tenth earlier'],
             [-F.FRAME, '‹', 'One frame earlier']].forEach(function (b) {
                var e = mk('button', '', b[1]); e.title = b[2];
                e.onclick = function () { c.start += b[0]; place(); drawInsp(); };
                nz.appendChild(e);
            });
            var box = mk('input');
            box.type = 'number'; box.step = '0.01';
            box.value = (c.start - F.TRUTH[c.id]).toFixed(2);
            box.title = 'Seconds this section is later than where it landed';
            box.onchange = function () { c.start = F.TRUTH[c.id] + (+box.value || 0); place(); drawInsp(); };
            nz.appendChild(box);
            [[F.FRAME, '›', 'One frame later'], [0.1, '▶', 'A tenth later'],
             [1, '▶▶', 'A second later']].forEach(function (b) {
                var e = mk('button', '', b[1]); e.title = b[2];
                e.onclick = function () { c.start += b[0]; place(); drawInsp(); };
                nz.appendChild(e);
            });
            insp.appendChild(nz);
            insp.appendChild(mk('div', 'vr2'));
            insp.appendChild(mk('span', 'kap', 'Lined up by'));
            insp.appendChild(mk('span', '', esc(c.src))).style.fontSize = '11.5px';
            var m = F.matchOf(c);
            var mm = mk('div', 'match');
            mm.innerHTML = "<span class='kap'>Match</span><span class='bar2" +
                (m.score < 0.6 ? ' poor' : '') + "'><i style='width:" +
                Math.round(m.score * 100) + "%'></i></span>";
            insp.appendChild(mm);
            var sp = mk('span'); sp.style.flex = '1'; insp.appendChild(sp);
            var al = mk('button', 'gbtn', 'Align here');
            al.title = 'Say that the frame on screen is the moment the playhead is on';
            al.onclick = function () { c.start = F.TRUTH[c.id]; place(); drawInsp(); };
            insp.appendChild(al);
            var rm = mk('button', 'gbtn', 'Remove');
            rm.title = 'Take this section off the recording. The file is not touched.';
            insp.appendChild(rm);
            place();
        }
        drawInsp();

        F.onTick(function () {
            var v = F.view(), span = v.to - v.from;
            head.style.left = pct((S.t - v.from) / span);
            cov.textContent = Math.round(F.coverage(0, F.SESS) * 100) + '% of the recording has film';
        });
    },
    dock: function (host) {
        var row = mk('div', 'd2dock');
        row.appendChild(F.transport());

        var tb = mk('div');
        tb.style.cssText = 'flex:none;min-width:150px';
        tb.innerHTML = "<div class='kap ln'></div><div class='big'><b class='tt'></b>" +
                       "<small> / " + F.clock(F.SESS) + "</small></div>";
        row.appendChild(tb);
        var tt = tb.querySelector('.tt'), ln = tb.querySelector('.ln');

        var sc = mk('div', 'surf scrub');
        row.appendChild(sc);
        var cv = mk('canvas', 'back');
        sc.appendChild(cv);
        F.LAPS.forEach(function (L) {
            if (!L.num) return;
            var t = mk('div', 'lp');
            t.style.left = pct(L.from / F.SESS);
            sc.appendChild(t);
        });
        var covrow = mk('div', 'cov');
        sc.appendChild(covrow);
        var head = mk('div', 'head');
        sc.appendChild(head);
        F.surface(sc, { win: function () { return { from: 0, to: F.SESS }; } });

        function drawCov() {
            covrow.innerHTML = '';
            F.CLIPS.forEach(function (c) {
                if (c.dead) return;
                var i = mk('i');
                i.style.left = pct(Math.max(0, c.start) / F.SESS);
                i.style.width = pct((Math.min(F.SESS, c.start + c.dur) - Math.max(0, c.start)) / F.SESS);
                covrow.appendChild(i);
            });
        }
        repaintOn(cv, function () { return 'x'; }, function () {
            F.paintTrace(cv, 0, F.SESS, { fill: 'rgba(232,232,232,0.09)', stroke: 'rgba(232,232,232,0.32)' });
        });

        row.appendChild(F.rateSeg());
        host.appendChild(row);

        F.onTick(function () {
            head.style.left = pct(S.t / F.SESS);
            tt.textContent = F.clockT(S.t);
            var L = F.lapAt(S.t);
            ln.textContent = F.lapName(L) + (L.kind === 'lap' ? '  ·  ' + F.lapTime(L.dur) : '');
            drawCov();
        });
    }
});

/* ===========================================================================
   3 — FILMSTRIP JOG
   ===========================================================================
   Centre-locked. The playhead never moves; the day runs under it. Two named
   modes, because the bar is being asked to do two different jobs and today
   it pretends they are one.
   =========================================================================== */
F.design({
    id: 'jog', num: 3, name: 'Filmstrip Jog', kind: 'combined',
    tag: 'The playhead stands still and the day runs under it. Watch, or Sync.',
    argument: 'Lining footage up is a two‑handed job: find a moment you can name in ' +
        'the picture, find it in the trace, and close the gap. So the picture IS the ' +
        'timeline here — real frames at real scale — with the trace directly beneath ' +
        'it on the same axis. The seven nudge buttons become one jog wheel, and the mode ' +
        'switch says out loud which of the two jobs you are doing.',
    fixes: [
        '<b>You can see the footage on the timeline.</b> Every other design draws a coloured box where the film is.',
        'Frame‑accurate work has a control shaped for it — a jog, not seven buttons.',
        'Watch / Sync names the two jobs the bar currently blurs (Following vs Free, plus a second hidden transport).',
        'A gap is a hatched hole with the wait printed in it.',
        'The overview strip keeps the whole day visible while you work at ±10 s.'
    ],
    costs: [
        'The whole‑day view is a 12 px overview, not the main surface.',
        'Decoding real thumbnails costs work — needs a cached strip per clip.',
        'Centre‑lock takes getting used to if you expect a left‑to‑right scrub.'
    ],
    tryit: [
        'Drag the filmstrip left and right — in <b>Watch</b> that scrubs.',
        'Switch to <b>Sync</b> and drag: now the film moves against the trace and the match meter answers.',
        'Drag the jog wheel and let go — it springs back.',
        'Wheel over the strip to change how much time it shows.'
    ],
    dock: function (host) {
        var row = mk('div', 'd3');
        var half = 12;              /* seconds either side of the playhead */
        var mode = 'watch';

        row.appendChild(F.transport());

        var tb = mk('div');
        tb.style.cssText = 'flex:none;min-width:120px;align-self:center';
        tb.innerHTML = "<div class='big'><b class='tt'></b></div>" +
                       "<div class='kap ln'></div>";
        row.appendChild(tb);
        var tt = tb.querySelector('.tt'), ln = tb.querySelector('.ln');

        var mid = mk('div', 'mid');
        row.appendChild(mid);

        /* the overview: the whole day, 12 px tall, always */
        var over = mk('div', 'surf over');
        mid.appendChild(over);
        F.CLIPS.forEach(function (c) {
            if (c.dead) return;
            var i = mk('div', 'cv');
            i.style.left = pct(Math.max(0, c.start) / F.SESS);
            i.style.width = pct((Math.min(F.SESS, c.start + c.dur) - Math.max(0, c.start)) / F.SESS);
            over.appendChild(i);
        });
        var win = mk('div', 'win'), ohd = mk('div', 'hd');
        over.appendChild(win); over.appendChild(ohd);
        F.surface(over, { win: function () { return { from: 0, to: F.SESS }; }, hover: false });

        /* the film, centre-locked */
        var strip = mk('div', 'surf strip');
        mid.appendChild(strip);
        /* A canvas is a replaced element: `height:auto` keeps its INTRINSIC
           aspect, which fit() rewrites every frame — so it grows without
           bound. Both of these state their box outright. */
        var fcv = mk('canvas', 'back');
        fcv.style.cssText = 'position:absolute;left:0;top:0;width:100%;' +
                            'height:calc(100% - 22px);display:block';
        strip.appendChild(fcv);
        var tcv = mk('canvas', 'trace');
        tcv.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:22px;display:block';
        strip.appendChild(tcv);
        var gapEl = mk('div', 'gap');
        gapEl.style.display = 'none';
        strip.appendChild(gapEl);
        var ctr = mk('div', 'ctr');
        strip.appendChild(ctr);

        function swin() { return { from: S.t - half, to: S.t + half }; }

        /* dragging the strip: scrub in Watch, move the clip in Sync */
        strip.addEventListener('pointerdown', function (ev) {
            if (ev.button !== 0) return;
            strip.setPointerCapture(ev.pointerId);
            strip.classList.add('dragging');
            S.playing = false;
            var x0 = ev.clientX, t0 = S.t;
            var c = F.clipAt(S.t), s0 = c ? c.start : 0;
            var mv = function (e) {
                var k = strip.getBoundingClientRect().width / (half * 2);
                var d = (e.clientX - x0) / k;
                if (e.shiftKey) d *= 0.12;
                if (mode === 'watch') F.seek(t0 - d);
                else if (c) c.start = s0 + d;
            };
            var up = function () {
                strip.classList.remove('dragging');
                strip.removeEventListener('pointermove', mv);
                strip.removeEventListener('pointerup', up);
            };
            strip.addEventListener('pointermove', mv);
            strip.addEventListener('pointerup', up);
        });
        strip.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            half = Math.max(1.5, Math.min(300, half * (ev.deltaY > 0 ? 1.25 : 0.8)));
        }, { passive: false });

        /* the right-hand cluster */
        var rgt = mk('div', 'rgt');
        row.appendChild(rgt);

        var ms = mk('div', 'seg');
        [['watch', 'Watch'], ['sync', 'Sync']].forEach(function (m) {
            var b = mk('button', m[0] === mode ? 'on' : '', m[1]);
            b.title = m[0] === 'watch' ? 'Dragging the film moves you through the day'
                                       : 'Dragging the film moves the film against the data';
            b.onclick = function () {
                mode = m[0];
                Array.prototype.forEach.call(ms.children, function (x, i) {
                    x.className = i === (m[0] === 'watch' ? 0 : 1) ? 'on' : '';
                });
                drawJogLab();
            };
            ms.appendChild(b);
        });
        var r1 = mk('div'); r1.style.cssText = 'display:flex;gap:6px;align-items:center';
        r1.appendChild(ms);
        r1.appendChild(F.rateSeg());
        rgt.appendChild(r1);

        var jog = mk('div', 'jog');
        jog.innerHTML = "<canvas class='knurl'></canvas><div class='zero'></div><div class='lab'></div>";
        jog.title = 'Drag to run. In Watch it moves you; in Sync it moves the film. Let go to stop.';
        rgt.appendChild(jog);
        var jcv = jog.querySelector('canvas'), jlab = jog.querySelector('.lab');
        var jofs = 0, jdrag = false;

        jog.addEventListener('pointerdown', function (ev) {
            jog.setPointerCapture(ev.pointerId);
            jdrag = true; S.playing = false;
            var x0 = ev.clientX;
            var mv = function (e) { jofs = Math.max(-1, Math.min(1, (e.clientX - x0) / 70)); };
            var up = function () {
                jdrag = false; jofs = 0;
                jog.removeEventListener('pointermove', mv);
                jog.removeEventListener('pointerup', up);
                drawJogLab();
            };
            jog.addEventListener('pointermove', mv);
            jog.addEventListener('pointerup', up);
        });

        function drawJogLab() {
            if (!jdrag) {
                var c = F.clipAt(S.t);
                if (mode === 'sync' && c) {
                    var m = F.matchOf(c);
                    jlab.innerHTML = F.signed(c.start - F.TRUTH[c.id]) + ' · match ' +
                                     Math.round(m.score * 100) + '%';
                } else jlab.textContent = 'jog';
            }
        }

        var jknurl = 0;
        var lastTs = 0;
        F.onTick(function () {
            var now = performance.now(), dt = lastTs ? (now - lastTs) / 1000 : 0;
            lastTs = now;
            if (jdrag && dt > 0 && dt < 0.4) {
                var v = Math.sign(jofs) * Math.pow(Math.abs(jofs), 2.2) * 16;
                if (mode === 'watch') F.seek(S.t + v * dt);
                else { var c = F.clipAt(S.t); if (c) c.start += v * dt; }
                jknurl += v * dt * 22;
                jlab.textContent = (mode === 'watch' ? 'shuttle ' : 'nudge ') +
                                   (v >= 0 ? '+' : '') + v.toFixed(2) + '×';
            }
            var jf = F.fit(jcv);
            if (jf) {
                var g = jf.g;
                g.fillStyle = 'rgba(232,232,232,0.22)';
                for (var x = ((jknurl % 8) + 8) % 8 - 8; x < jf.w; x += 8) g.fillRect(x, 0, 1, jf.h);
                g.fillStyle = 'rgba(232,232,232,0.10)';
                for (x = ((jknurl % 32) + 32) % 32 - 32; x < jf.w; x += 32) g.fillRect(x, 0, 2, jf.h);
            }

            var w = swin();
            tt.textContent = F.clockT(S.t);
            var L = F.lapAt(S.t);
            ln.textContent = F.lapName(L) + '  ·  ±' + half.toFixed(0) + ' s';
            win.style.left = pct(Math.max(0, w.from) / F.SESS);
            win.style.width = pct((w.to - w.from) / F.SESS);
            ohd.style.left = pct(S.t / F.SESS);

            var c2 = F.clipAt(S.t);
            gapEl.style.display = c2 ? 'none' : '';
            if (!c2) {
                gapEl.style.left = '0'; gapEl.style.right = '0';
                var nx = F.nextClip(S.t);
                gapEl.textContent = nx ? 'no footage — next section in ' + F.clock(nx.start - S.t)
                                       : 'no footage over this stretch';
            }
            drawJogLab();
        });

        repaintOn(fcv, function () {
            var c = F.clipAt(S.t);
            return (c ? c.id : 'none') + ':' + (S.t / 0.25 | 0) + ':' + half.toFixed(1);
        }, function () {
            var w = swin(), c = F.clipAt(S.t);
            if (!c) { var f = F.fit(fcv); return; }
            F.paintStrip(fcv, w.from, w.to, c.cam, {});
        });
        repaintOn(tcv, function () { return (S.t / 0.2 | 0) + ':' + half.toFixed(1); }, function () {
            var w = swin();
            F.paintTrace(tcv, w.from, w.to, {
                fill: 'rgba(232,232,232,0.16)', stroke: 'rgba(232,232,232,0.55)', laps: true
            });
        });

        host.appendChild(row);
    }
});

/* ===========================================================================
   4 — ONE RULER
   ===========================================================================
   The panel and the bar are one column with one ruler and one playhead line
   running the whole height of it. Nothing is on a second time scale.
   =========================================================================== */
F.design({
    id: 'ruler', num: 4, name: 'One Ruler', kind: 'panel fused to the bar',
    tag: 'Laps, trace, film and transport in one column under one playhead.',
    panelLabel: 'Footage timeline &mdash; fused to the bar below it',
    panelH: 172, join: true,
    argument: 'The complaint the shipping code writes in its own comments — "you cannot ' +
        'line a clip up against a trace you have to look away from" — taken all the way. ' +
        'One ruler at the top, one red line straight down through the lap strip, the trace, ' +
        'every camera lane and into the bar. The transport is furniture at the foot of the ' +
        'same object, so there is no second scrubber that can disagree with it.',
    fixes: [
        '<b>One playhead, one scale</b>, from the lap strip to the transport.',
        'Laps are a named strip, not 1‑px ticks on a hatched grey bar.',
        'No second scrub slider — the surface above IS the scrub, so they cannot drift apart.',
        'The match meter and Auto‑align give a reason to trust an alignment instead of eyeballing it.',
        'Clicking a lap in the strip zooms the whole column to that lap.'
    ],
    costs: [
        'Tall: 172 px of panel plus the bar, and it wants to be at the bottom of the screen.',
        'Fusing the bar to a panel means the bar is only right in Analyse.',
        'With one camera, two thirds of the lanes are empty.'
    ],
    tryit: [
        'Click a lap in the top strip — the whole column zooms to it, transport included.',
        'Drag a clip and watch <b>Match</b> in the bar fall, then press <b>Auto‑align</b>.',
        'Follow the red line down: lap strip, ruler, trace, lanes, bar.'
    ],
    panel: function (host) {
        var wrap = mk('div', 'd4');
        var laps = mk('div', 'lapstrip');
        F.LAPS.forEach(function (L) {
            var c = mk('div', 'c' + (L.kind !== 'lap' ? ' px' : ''));
            c.style.flex = L.dur + ' 1 0';
            c.textContent = L.kind === 'lap'
                ? 'Lap ' + L.num + '  ' + F.lapTime(L.dur) + (L === F.BEST ? '  ★' : '')
                : F.lapName(L);
            c.title = F.lapName(L) + (L.note ? ' — ' + L.note : '') +
                      '  — click to zoom the whole column to it';
            c.onclick = function () { F.zoomTo(L.from - 4, L.to + 4); F.seek(L.from + 0.1); };
            c._L = L;
            laps.appendChild(c);
        });
        wrap.appendChild(laps);

        var col = mk('div', 'surf');
        col.style.cssText = 'flex:1;min-height:0;display:block';
        wrap.appendChild(col);
        host.appendChild(wrap);

        var RUL = 16, LANE = 21, LANES = 3;
        var rul = mk('div', 'tickrow');
        rul.style.height = RUL + 'px';
        rul.style.borderBottom = '1px solid var(--gpb-div-lt)';
        col.appendChild(rul);

        var cv = mk('canvas', 'back');
        cv.style.top = RUL + 'px';
        cv.style.bottom = 'auto';
        cv.style.height = 'calc(100% - ' + (RUL + LANES * LANE) + 'px)';
        col.appendChild(cv);

        for (var i = 0; i < LANES; i++) {
            var L2 = mk('div', 'lane');
            L2.style.bottom = ((LANES - 1 - i) * LANE) + 'px';
            L2.style.height = LANE + 'px';
            col.appendChild(L2);
        }
        var head = mk('div', 'head grab');
        col.appendChild(head);
        F.surface(col, { zoom: true, hoverText: function (t) {
            return F.clockT(t) + '  ' + Math.round(F.spd(t)) + ' km/h';
        } });
        var pps = ppsOf(col);

        var clipEls = F.CLIPS.map(function (c) {
            var e = mk('div', 'clip' + (c.dead ? ' dead' : ''));
            e.style.bottom = ((LANES - 1 - c.lane) * LANE + 2) + 'px';
            e.style.top = 'auto';
            e.style.height = (LANE - 5) + 'px';
            e.style.lineHeight = (LANE - 7) + 'px';
            e.textContent = c.name + (c.dead ? '  — will not decode' : '');
            e.title = c.name + ' — ' + F.CAMS[c.cam] + '  — drag to move it';
            col.appendChild(e);
            F.dragClip(e, c, pps, { onMove: place });
            return { el: e, c: c };
        });
        function place() {
            var v = F.view(), span = v.to - v.from;
            clipEls.forEach(function (o) {
                o.el.style.left = pct((o.c.start - v.from) / span);
                o.el.style.width = pct(o.c.dur / span);
            });
        }
        repaintOn(cv, viewSig, function () {
            var v = F.view();
            F.paintTrace(cv, v.from, v.to, {});
            rul.innerHTML = F.rulerHtml(v.from, v.to);
            place();
        });
        F.onTick(function () {
            var v = F.view(), span = v.to - v.from;
            head.style.left = pct((S.t - v.from) / span);
            var cur = F.lapAt(S.t), live = F.clipsAt(S.t);
            Array.prototype.forEach.call(laps.children, function (c) {
                c.classList.toggle('on', c._L === cur);
            });
            clipEls.forEach(function (o) { o.el.classList.toggle('on', live.indexOf(o.c) >= 0); });
        });
    },
    dock: function (host) {
        var row = mk('div', 'd4dock');
        row.appendChild(F.transport());

        var tb = mk('div');
        tb.style.cssText = 'flex:none;min-width:150px';
        tb.innerHTML = "<div class='kap ln'></div><div class='big'><b class='tt'></b>" +
                       "<small> / " + F.clock(F.SESS) + "</small></div>";
        row.appendChild(tb);
        var tt = tb.querySelector('.tt'), ln = tb.querySelector('.ln');

        row.appendChild(mk('div', 'vr2'));

        var fb = mk('div');
        fb.style.cssText = 'flex:1;min-width:0';
        fb.innerHTML = "<div class='kap'>Under the playhead</div>" +
                       "<div class='fw' style='font-size:12px;white-space:nowrap;overflow:hidden;" +
                       "text-overflow:ellipsis'></div>";
        row.appendChild(fb);
        var fw = fb.querySelector('.fw');

        var mm = mk('div', 'match');
        mm.innerHTML = "<span class='kap'>Match</span><span class='bar2'><i></i></span>" +
                       "<span class='kap mv'></span>";
        row.appendChild(mm);
        var mbar = mm.querySelector('.bar2'), mfill = mm.querySelector('i'), mval = mm.querySelector('.mv');

        var al = mk('button', 'gbtn', 'Auto‑align');
        al.title = 'Slide the section under the playhead until its motion agrees with the trace';
        al.onclick = function () {
            var c = F.clipAt(S.t);
            if (c) c.start = F.TRUTH[c.id];
        };
        row.appendChild(al);
        var zo = mk('button', 'gbtn', 'Whole');
        zoomOut(zo);
        row.appendChild(zo);
        row.appendChild(F.rateSeg());
        host.appendChild(row);

        F.onTick(function () {
            tt.textContent = F.clockT(S.t);
            var L = F.lapAt(S.t);
            ln.textContent = F.lapName(L) + (L.kind === 'lap' ? '  ·  ' + F.lapTime(L.dur) : '');
            fw.innerHTML = footageWord();
            var c = F.clipAt(S.t), m = F.matchOf(c);
            if (!m) { mm.style.opacity = '0.35'; mfill.style.width = '0'; mval.textContent = '—'; al.disabled = true; }
            else {
                mm.style.opacity = '1';
                mfill.style.width = Math.round(m.score * 100) + '%';
                mbar.classList.toggle('poor', m.score < 0.6);
                mval.textContent = m.err < 0.05 ? 'aligned' : F.signed(c.start - F.TRUTH[c.id]);
                al.disabled = false;
            }
        });
    }
});

/* ===========================================================================
   5 — CHAPTERS
   ===========================================================================
   The opposite bet: footage is not a thing you arrange, it is a property of a
   lap. The bar is the lap list. Arranging is a mode you enter on purpose.
   =========================================================================== */
F.design({
    id: 'chapters', num: 5, name: 'Chapters', kind: 'combined, reduced',
    tag: 'The bar is the laps. Footage is something a lap either has or does not.',
    argument: 'Ninety‑five per cent of the time nobody wants an NLE — they want lap 7. ' +
        'So the bar is one chip per lap, sized by lap time, and the film is a rule under ' +
        'each chip saying how much of that lap the cameras caught. Arranging footage is a ' +
        'job you go and do: press Sync and you get one focused surface with one question ' +
        'on it, instead of twenty‑five controls wrapped over the picture forever.',
    fixes: [
        '<b>The bar answers the question people actually ask</b>: which lap, how quick, is there film of it.',
        'No editing furniture on screen while you are watching.',
        'Coverage is per lap, where it matters, instead of one "62% of the recording" figure.',
        'The best lap and the traffic lap are visible without opening a panel.',
        'The sync job gets a surface of its own, with one Align button and nothing else.'
    ],
    costs: [
        '<b>Multi‑camera arranging has no home in the bar at all</b> — it is all behind Sync.',
        'A road drive with no timing line has no laps, so the chips degenerate to stop‑split runs.',
        'You lose the sense of the day as one continuous strip of time.'
    ],
    tryit: [
        'Click any lap chip — that is the whole navigation model.',
        'Look at lap 4 — visibly wider because it took longer, and the chip says why.',
        'Press <b>Sync…</b> to see what arranging looks like when it is a job rather than a permanent panel.'
    ],
    dock: function (host) {
        var row = mk('div', 'd5');
        row.appendChild(F.transport());

        var tb = mk('div');
        tb.style.cssText = 'flex:none;min-width:126px';
        tb.innerHTML = "<div class='kap ln'></div><div class='big'><b class='tt'></b></div>";
        row.appendChild(tb);
        var tt = tb.querySelector('.tt'), ln = tb.querySelector('.ln');

        var chips = mk('div', 'chips');
        row.appendChild(chips);
        var chipEls = F.LAPS.map(function (L) {
            var c = mk('div', 'chip' + (L.kind !== 'lap' ? ' px' : ''));
            /* Timed laps share the width in proportion to how long they took —
               so lap 5 is visibly the traffic lap. Everything that is not a
               timed lap is a divider, not a chapter, and gets a fixed sliver:
               a 132 s pit stop as wide as a lap would say the pits were the
               most interesting two minutes of the day. */
            c.style.flex = L.kind === 'lap' ? (L.dur + ' 1 0') : '0 0 30px';
            var cov = F.coverage(L.from, L.to);
            var short = { pit: 'PIT', out: 'OUT', 'in': 'IN' };
            c.innerHTML = "<div class='n'>" + (L.kind === 'lap' ? 'Lap ' + L.num : short[L.kind]) +
                          (L.note ? " <span style='color:var(--gpb-warn)'>" + L.note + "</span>" : '') +
                          (L === F.BEST ? "<span class='best'>★ best</span>" : '') + "</div>" +
                          "<div class='t'>" + (L.kind === 'pit' ? F.clock(L.dur) : F.lapTime(L.dur)) + "</div>" +
                          "<div class='prog'></div><div class='cam'></div><div class='hd' style='display:none'></div>";
            c.title = F.lapName(L) + ' — ' +
                      (cov >= 0.999 ? 'fully covered by footage'
                       : cov <= 0 ? 'no footage' : Math.round(cov * 100) + '% covered by footage');
            c.onclick = function () { F.seek(L.from + 0.1); };
            var cam = c.querySelector('.cam');
            F.CLIPS.forEach(function (cl) {
                if (cl.dead) return;
                var a = Math.max(L.from, cl.start), b = Math.min(L.to, cl.start + cl.dur);
                if (b <= a) return;
                var i = mk('i');
                i.style.left = pct((a - L.from) / L.dur);
                i.style.width = pct((b - a) / L.dur);
                i.style.bottom = (cl.lane ? 0 : 0) + 'px';
                i.style.opacity = cl.lane ? 0.5 : 1;
                cam.appendChild(i);
            });
            if (!cam.children.length) {
                cam.innerHTML = "<span style='position:absolute;inset:0;background:" +
                                "repeating-linear-gradient(45deg,rgba(255,255,255,0.10) 0 2px,transparent 2px 4px)'></span>";
            }
            chips.appendChild(c);
            return { el: c, L: L, prog: c.querySelector('.prog'), hd: c.querySelector('.hd') };
        });

        var fb = mk('div');
        fb.style.cssText = 'flex:none;min-width:128px';
        fb.innerHTML = "<div class='kap'>Footage</div><div class='fw' style='font-size:11.5px;" +
                       "white-space:nowrap;overflow:hidden;text-overflow:ellipsis'></div>";
        row.appendChild(fb);
        var fw = fb.querySelector('.fw');

        var sy = mk('button', 'gbtn', 'Sync…');
        sy.title = 'Line the footage up against the data. A job, not a permanent panel.';
        sy.onclick = openSheet;
        row.appendChild(sy);
        row.appendChild(F.rateSeg());
        host.appendChild(row);

        F.onTick(function () {
            tt.textContent = F.clockT(S.t);
            var L = F.lapAt(S.t);
            ln.textContent = F.lapName(L);
            fw.innerHTML = footageWord();
            chipEls.forEach(function (o) {
                var on = o.L === L;
                o.el.classList.toggle('on', on);
                o.prog.style.width = on ? pct((S.t - o.L.from) / o.L.dur) : '0';
                o.hd.style.display = on ? '' : 'none';
                if (on) o.hd.style.left = pct((S.t - o.L.from) / o.L.dur);
            });
        });
    }
});

/* ---- design 5's sync sheet ---------------------------------------------- */
function openSheet() {
    var sheet = document.getElementById('sheet');
    var box = sheet.querySelector('.box');
    var c = F.clipAt(S.t) || F.CLIPS[0];
    S.playing = false;

    box.innerHTML = "<h3>Line up the footage</h3><div class='bd'>" +
        "<p class='lead'>Park the red line on a moment you can name in the data — a braking " +
        "point, the start line — then drag the film until the same moment is under it.</p>" +
        "<div class='two'><div><div class='cap'>The recording</div><div class='surf sTrace'></div></div>" +
        "<div><div class='cap'>" + esc(c.name) + " · " + esc(F.CAMS[c.cam]) +
        "</div><div class='surf sFilm'></div></div></div></div>" +
        "<div class='ft'></div>";

    var tr = box.querySelector('.sTrace'), fm = box.querySelector('.sFilm');
    var tcv = mk('canvas', 'back'); tr.appendChild(tcv);
    var thd = mk('div', 'head'); thd.style.left = '50%'; tr.appendChild(thd);
    var fcv = mk('canvas', 'back'); fm.appendChild(fcv);
    var fhd = mk('div', 'head'); fhd.style.left = '50%'; fm.appendChild(fhd);
    fm.style.cursor = 'grab';

    var half = 8;
    fm.addEventListener('pointerdown', function (ev) {
        fm.setPointerCapture(ev.pointerId);
        var x0 = ev.clientX, s0 = c.start;
        var mv = function (e) {
            var k = fm.getBoundingClientRect().width / (half * 2);
            var d = (e.clientX - x0) / k;
            c.start = s0 - d * (e.shiftKey ? 0.12 : 1);
        };
        var up = function () {
            fm.removeEventListener('pointermove', mv);
            fm.removeEventListener('pointerup', up);
        };
        fm.addEventListener('pointermove', mv);
        fm.addEventListener('pointerup', up);
    });

    var ft = box.querySelector('.ft');
    var lab = mk('span', 'kap');
    lab.style.marginRight = 'auto';
    ft.appendChild(lab);
    var al = mk('button', 'gbtn', 'Align here');
    al.onclick = function () { c.start = F.TRUTH[c.id]; };
    ft.appendChild(al);
    var dn = mk('button', 'gbtn prim', 'Done');
    dn.onclick = function () { sheet.classList.remove('on'); if (t) clearInterval(t); };
    ft.appendChild(dn);

    sheet.classList.add('on');
    var t = setInterval(function () {
        if (!sheet.classList.contains('on')) { clearInterval(t); return; }
        F.paintTrace(tcv, S.t - half, S.t + half, {
            fill: 'rgba(232,232,232,0.16)', stroke: 'rgba(232,232,232,0.55)'
        });
        F.paintStrip(fcv, S.t - c.start - half, S.t - c.start + half, c.cam, {});
        var m = F.matchOf(c);
        lab.textContent = 'offset ' + F.signed(c.start - F.TRUTH[c.id]) +
                          '   ·   match ' + Math.round(m.score * 100) + '%';
    }, 60);
}

})(window.FT);
