/* The posts. One capability each, one dominant thing each, every number
 * measured off a committed recording by tools/hype/data.js.
 */
const K = require('./kit.js');
const { C } = K;

/* ---- small drawing helpers -------------------------------------------- */

/* A circuit drawn from a lap, coloured by whatever `col(i)` says. */
function circuit(pts, w, h, opt) {
    opt = opt || {};
    const p = K.project(pts, w, h, opt.pad === undefined ? 46 : opt.pad);
    const width = opt.width || 13;
    const cols = pts.map((r, i) => opt.col ? opt.col(r, i) : C.ink);
    let s = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
    if (opt.under) s += opt.under(p);
    s += K.ribbon(p.xy, cols, width, opt.casing === undefined ? 'rgba(29,31,32,0.20)' : opt.casing);
    if (opt.over) s += opt.over(p);
    s += '</svg>';
    return s;
}

/* Start/finish tick, drawn across the direction of travel. */
function startTick(p, i, len, col) {
    const a = p.xy[i], b = p.xy[Math.min(p.xy.length - 1, i + 3)];
    const dx = b[0] - a[0], dy = b[1] - a[1], m = Math.hypot(dx, dy) || 1;
    const nx = -dy / m * len, ny = dx / m * len;
    return `<line x1="${(a[0] - nx).toFixed(1)}" y1="${(a[1] - ny).toFixed(1)}" x2="${(a[0] + nx).toFixed(1)}" y2="${(a[1] + ny).toFixed(1)}" stroke="${col || C.ink}" stroke-width="5"/>`;
}

function scaleBar(p, metres, x, y) {
    /* p.scale is degrees→px at the projection's latitude scaling; one degree
       of latitude is 111,320 m, so px per metre is scale/111320. */
    const px = metres * p.scale / 111320;
    return `<g><line x1="${x}" y1="${y}" x2="${x + px}" y2="${y}" stroke="${C.muted}" stroke-width="2"/>
    <line x1="${x}" y1="${y - 5}" x2="${x}" y2="${y + 5}" stroke="${C.muted}" stroke-width="2"/>
    <line x1="${x + px}" y1="${y - 5}" x2="${x + px}" y2="${y + 5}" stroke="${C.muted}" stroke-width="2"/>
    <text x="${x + px / 2}" y="${y - 12}" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="19" letter-spacing="1.6" fill="${C.muted}">${metres} M</text></g>`;
}

function stars(n, size, gap, col, dim) {
    /* Half stars, because five whole ones cannot separate a good corner from
       a very good one — the app's own reason. */
    let s = '';
    const pathD = 'M12 1.6l3.2 6.9 7.4.9-5.5 5.1 1.5 7.4L12 18.2 5.4 21.9l1.5-7.4L1.4 9.4l7.4-.9z';
    for (let i = 0; i < 5; i++) {
        const full = n >= i + 1, half = !full && n >= i + 0.5;
        const id = 'h' + i + Math.round(size);
        s += `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="margin-right:${gap}px;display:block">`;
        if (half) s += `<defs><linearGradient id="${id}"><stop offset="50%" stop-color="${col}"/><stop offset="50%" stop-color="${dim}"/></linearGradient></defs>`;
        s += `<path d="${pathD}" fill="${full ? col : half ? 'url(#' + id + ')' : dim}"/></svg>`;
    }
    return `<div style="display:flex;align-items:center">${s}</div>`;
}

function meter(label, frac, note, w) {
    const pct = Math.round(frac * 100);
    return `<div style="margin-bottom:26px">
    <div style="display:flex;align-items:baseline;margin-bottom:7px">
      <div style="font-family:'Barlow Condensed';font-weight:700;font-size:31px;letter-spacing:.09em;text-transform:uppercase">${label}</div>
      <div style="margin-left:auto;font-family:'Barlow Condensed';font-weight:700;font-size:34px;font-variant-numeric:tabular-nums">${pct}<span style="font-size:22px;color:${C.muted}">%</span></div>
    </div>
    <div style="height:15px;background:${C.n200};width:${w}px;position:relative">
      <div style="position:absolute;left:0;top:0;bottom:0;width:${(frac * w).toFixed(1)}px;background:${C.red}"></div>
    </div>
    <div style="font-size:20px;color:${C.muted};margin-top:7px">${note}</div>
  </div>`;
}

/* ======================================================================== */

const POSTS = [];
const P = (id, title, fn) => POSTS.push({ id, title, fn });

/* ---- 01 · the hero ----------------------------------------------------- */
P('01-lap', 'The lap', D => {
    const d = D.donington;
    const kmax = Math.max(...d.outline.map(p => p[2]));
    const kmin = Math.min(...d.outline.map(p => p[2]));
    /* The key, not a claim that there is one. "Colour is speed" told you a
       mapping existed without saying which way it ran — and the app's ramp
       goes DARK for slow, which is the opposite of what most people guess.
       Printing the two ends costs one strip and settles it. */
    const map = circuit(d.outline, 1000, 640, {
        width: 16, pad: 40,
        col: r => K.speedColour((r[2] - kmin) / (kmax - kmin)),
        over: p => startTick(p, 0, 22) +
            `<text x="${(p.xy[0][0] + 26).toFixed(1)}" y="${(p.xy[0][1] + 7).toFixed(1)}" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.6" fill="${C.ink}">START/FINISH</text>` +
            scaleBar(p, 200, 20, 620) +
            K.rampKey(720, 592, 260, Math.round(kmin), Math.round(kmax), 'km/h')
    });
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">Donington National · Lotus Evora GTE</div>
  <h1>Every metre<br>of your best lap</h1>
  <div style="margin:14px 0 0 -14px">${map}</div>
  <div class="grow"></div>
  <div style="display:flex;align-items:flex-end;padding-bottom:10px">
    <div>
      <div class="unit" style="font-size:24px;letter-spacing:.19em">Best of seven</div>
      <div class="big" style="font-size:196px;margin-top:2px">1:08<span style="color:${C.red}">.215</span></div>
    </div>
    <div style="margin-left:auto;text-align:right;padding-bottom:16px">
      <div class="unit" style="font-size:21px">Top speed</div>
      <div class="big" style="font-size:66px;margin-top:2px">${d.moments.top.kph}<span style="font-size:30px;color:${C.muted}"> km/h</span></div>
      <div class="unit" style="font-size:21px;margin-top:16px">Peak cornering</div>
      <div class="big" style="font-size:66px;margin-top:2px">${d.moments.corner.g.toFixed(2)}<span style="font-size:30px;color:${C.muted}"> g</span></div>
    </div>
  </div>
</div>
${K.foot('Colour is speed · 3,147 m · 10 Hz', 'Every reading measured from the recording. Nothing is drawn that was not driven.', 'RDM Studio')}
`, { title: 'The lap' });
});

/* ---- 02 · the delta ---------------------------------------------------- */
P('02-delta', 'Where the lap was won', D => {
    const d = D.donington, pts = d.delta.pts;
    const w = 1000, h = 522, pad = 8, axis = 54;
    const L = d.delta.lengthM;
    /* Scaled to the data, not centred on zero — this lap is ahead almost all
       the way round, and a symmetric axis would spend half the box on an
       empty half-plane. */
    const dmin = Math.min(...pts.map(p => p.d)), dmax = Math.max(...pts.map(p => p.d));
    const lo = dmin - (dmax - dmin) * 0.16, hi = dmax + (dmax - dmin) * 0.20;
    const X = s => pad + (s / L) * (w - 2 * pad);
    const Y = v => 26 + (hi - v) / (hi - lo) * (h - axis - 44);
    /* one filled area, split at the zero line by clipping */
    const area = 'M' + pts.map(p => X(p.s).toFixed(1) + ' ' + Y(p.d).toFixed(1)).join('L') +
        `L${X(L).toFixed(1)} ${Y(0)}L${X(0).toFixed(1)} ${Y(0)}Z`;
    const worst = pts.reduce((a, b) => b.d > a.d ? b : a);
    const bestPt = pts.reduce((a, b) => b.d < a.d ? b : a);
    /* The ink is the magnitude. A flat wash spent the same colour on a 40 ms
       wobble as on the quarter second that won the lap; fading it out towards
       the zero line makes depth of colour mean depth of gap. */
    const fLost = K.fade(C.red, Y(dmax), Y(0), 0.46, 0.06);
    const fWon = K.fade(C.teal, Y(dmin), Y(0), 0.46, 0.06);
    /* Distance up the lap, so "four hundred metres in" is a place you can
       find on the picture rather than a number you have to take on trust. */
    const ticks = [];
    for (let s = 500; s < L; s += 500) ticks.push(s);
    const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    ${fLost.def}${fWon.def}
    <clipPath id="above"><rect x="0" y="0" width="${w}" height="${Y(0)}"/></clipPath>
    <clipPath id="below"><rect x="0" y="${Y(0)}" width="${w}" height="${h - Y(0)}"/></clipPath>
  </defs>
  ${ticks.map(s => `<line x1="${X(s).toFixed(1)}" y1="20" x2="${X(s).toFixed(1)}" y2="${h - axis}" stroke="${C.divLt}" stroke-width="1"/>
     <text x="${X(s).toFixed(1)}" y="${h - 34}" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="20" letter-spacing="1.2" fill="${C.n400}">${(s / 1000).toFixed(1)} KM</text>`).join('')}
  ${[-0.3, -0.2, -0.1].map(v => `<line x1="0" y1="${Y(v)}" x2="${w}" y2="${Y(v)}" stroke="${C.divLt}" stroke-width="1"/>
     <text x="6" y="${Y(v) - 8}" font-family="Barlow Condensed" font-weight="600" font-size="20" fill="${C.n400}">${K.signed(v, 1)} s</text>`).join('')}
  <path d="${area}" fill="${fLost.url}" clip-path="url(#above)"/>
  <path d="${area}" fill="${fWon.url}" clip-path="url(#below)"/>
  <line x1="0" y1="${Y(0)}" x2="${w}" y2="${Y(0)}" stroke="${C.ink}" stroke-width="2"/>
  <text x="${w - 6}" y="${Y(0) - 12}" text-anchor="end" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.6" fill="${C.muted}">LEVEL WITH LAP 4</text>
  <path d="${'M' + pts.map(p => X(p.s).toFixed(1) + ' ' + Y(p.d).toFixed(1)).join('L')}" fill="none" stroke="${C.ink}" stroke-width="3.6" stroke-linejoin="round"/>
  <circle cx="${X(worst.s)}" cy="${Y(worst.d)}" r="7" fill="${C.red}"/>
  <text x="${X(worst.s) + 16}" y="${Y(worst.d) + 9}" font-family="Barlow Condensed" font-weight="700" font-size="27" fill="${C.red}">${K.signed(worst.d, 2)} s — behind, into Redgate</text>
  <circle cx="${X(bestPt.s)}" cy="${Y(bestPt.d)}" r="7" fill="${C.teal}"/>
  <text x="${w - 6}" y="${Y(bestPt.d) - 30}" text-anchor="end" font-family="Barlow Condensed" font-weight="700" font-size="26" fill="${C.teal}">${K.signed(bestPt.d, 2)} s at the line</text>
  <line x1="0" y1="${h - axis}" x2="${w}" y2="${h - axis}" stroke="${C.div}" stroke-width="1.5"/>
  <text x="2" y="${h - 8}" font-family="Barlow Condensed" font-weight="600" font-size="20" letter-spacing="1.5" fill="${C.muted}">START/FINISH</text>
  <text x="${w - 2}" y="${h - 8}" text-anchor="end" font-family="Barlow Condensed" font-weight="600" font-size="20" letter-spacing="1.5" fill="${C.muted}">3,147 M · ONE LAP</text>
</svg>`;
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">The continuous delta</div>
  <h1>Not just which lap<br>was faster — where</h1>
  <div class="sub">Lap&nbsp;6 against lap&nbsp;4, matched by <b>place</b> rather than by clock. Above the line you are losing; below it you are gaining.</div>
  <div style="margin:24px 0 0 -14px">${svg}</div>
  <div style="background:${C.surface};border:1px solid ${C.div};padding:20px 24px;margin-top:8px;font-size:25px;line-height:1.36;font-weight:500">
    Four hundred metres in, this lap was <b style="color:${C.red}">behind</b>. It took the whole gap back in one corner, held it flat through the middle of the circuit, and found the rest of it on the way home.
  </div>
  <div class="grow"></div>
  <div class="rule hard" style="margin:0 0 20px"></div>
  <div style="display:flex;align-items:flex-end;padding-bottom:8px">
    <div>
      <div class="unit" style="font-size:22px">Lap 6</div>
      <div class="big" style="font-size:96px">1:08.215</div>
    </div>
    <div style="margin-left:56px">
      <div class="unit" style="font-size:22px">Lap 4</div>
      <div class="big" style="font-size:96px;color:${C.muted}">1:08.493</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="unit" style="font-size:22px">Won by</div>
      <div class="big" style="font-size:96px;color:${C.red}">0.278</div>
    </div>
  </div>
</div>
${K.foot('Donington National · Lotus Evora GTE', 'The trace closes on the gap between the two lap times — the same measurement, drawn.', 'RDM Studio')}
`, { title: 'Delta' });
});

/* ---- 03 · where the time went ------------------------------------------ */
P('03-corners', 'Where the time went', D => {
    const d = D.donington;
    const rows = d.corners.slice().sort((a, b) => b.lost - a.lost);
    const mag = Math.max(...rows.map(r => Math.abs(r.lost)));
    /* A true diverging bar: one zero line down the middle of the track, lost
       to the right of it and gained to the left. The old pair grew from
       opposite ENDS of a shared box, so a big loss and a big gain both ran
       to the middle and the two longest bars in the table were the two
       smallest numbers in it. */
    const barW = 470, mid = barW / 2;
    const body = rows.map(r => {
        const bw = Math.abs(r.lost) / mag * mid;
        const lost = r.lost > 0;
        return `<tr>
      <td class="n" style="width:120px">Turn ${r.n}</td>
      <td style="width:${barW + 40}px">
        <div style="position:relative;height:22px;width:${barW}px;background:${C.n200}">
          <div style="position:absolute;top:0;bottom:0;${lost ? 'left:' + mid : 'left:' + (mid - bw).toFixed(1)}px;width:${bw.toFixed(1)}px;background:${lost ? C.red : C.teal}"></div>
          <div style="position:absolute;top:-3px;bottom:-3px;left:${mid}px;width:2px;background:${C.ink}"></div>
        </div>
      </td>
      <td class="n r" style="width:160px;color:${lost ? C.red : C.teal}">${K.signed(r.lost)}</td>
      <td class="r" style="width:180px;color:${C.soft}">${r.apexKph.toFixed(0)} km/h</td>
    </tr>`;
    }).join('');
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">Where the time went</div>
  <h1>Corner by corner,<br>in plain numbers</h1>
  <div class="sub">Seven corners found in the lap itself — no one had to place them. Red is time given away against the reference lap; teal is time taken.</div>
  <div style="margin-top:34px">
    <table>
      <tr><th>Turn</th><th><span style="color:${C.teal}">◀ Taken</span> &nbsp;·&nbsp; <span style="color:${C.red}">Given away ▶</span></th><th class="r">Seconds</th><th class="r">Slowest point</th></tr>
      ${body}
    </table>
  </div>
  <div style="margin-top:auto;padding-bottom:26px">
    <div class="rule hard"></div>
    <div style="display:flex;align-items:flex-end;padding-top:18px">
      <div style="max-width:520px">
        <div class="unit" style="font-size:22px">The one that mattered</div>
        <div style="font-size:27px;line-height:1.3;margin-top:8px;font-weight:500">Turn&nbsp;1 alone was worth <b style="color:${C.teal}">0.107&nbsp;s</b>. Every other corner on the lap put together came to less than that.</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div class="unit" style="font-size:22px">Whole lap</div>
        <div class="big" style="font-size:112px;color:${C.teal}">−0.278</div>
      </div>
    </div>
  </div>
</div>
${K.foot('Donington National · lap 6 v lap 4', 'Corners detected by the analysis engine from speed and heading alone.', 'RDM Studio')}
`, { title: 'Corners' });
});

/* ---- 04 · the ideal lap ------------------------------------------------ */
P('04-ideal', 'The ideal lap', D => {
    const d = D.donington, sp = d.splits;
    const rows = sp.per.map((t, i) => {
        const tot = d.lapTimes[i];
        const cells = t.map((v, k) => {
            const best = Math.abs(v - sp.best[k]) < 0.0005;
            return `<td class="n r" style="${best ? `color:${C.red};` : ''}width:170px">${v.toFixed(3)}${best ? '' : ''}</td>`;
        }).join('');
        const isBest = tot === d.bestS;
        return `<tr style="${isBest ? 'background:' + C.red100 : ''}">
      <td class="n" style="width:150px">Lap ${i + 1}</td>${cells}
      <td class="n r" style="width:210px;${isBest ? 'color:' + C.red700 : ''}">${K.lapTime(tot)}</td></tr>`;
    }).join('');
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">The ideal lap</div>
  <h1>The lap you have<br>already driven —<br>in pieces</h1>
  <div class="sub">Your best third of the circuit, three times over. It is not a simulation: every one of these sectors is a piece of a lap you actually drove.</div>
  <div style="margin-top:26px" class="tight">
    <table>
      <tr><th>Lap</th><th class="r">Sector 1</th><th class="r">Sector 2</th><th class="r">Sector 3</th><th class="r">Lap time</th></tr>
      ${rows}
    </table>
  </div>
  <div class="grow"></div>
  <div style="border-top:2px solid ${C.ink};padding-top:20px;display:flex;align-items:flex-end">
    <div>
      <div class="unit" style="font-size:23px">Best sectors, added up</div>
      <div style="display:flex;gap:16px;align-items:baseline;margin-top:6px">
        ${sp.best.map(v => `<div class="big" style="font-size:58px;color:${C.red}">${v.toFixed(3)}</div>`).join(`<div style="font-size:38px;color:${C.n400}">+</div>`)}
      </div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="unit" style="font-size:23px">Theoretical best</div>
      <div class="big" style="font-size:118px;color:${C.red}">${K.lapTime(sp.ideal)}</div>
    </div>
  </div>
  <div style="font-size:26px;color:${C.soft};margin:16px 0 12px;font-weight:500">
    <b>0.089&nbsp;s</b> under your best lap — and all of it already in the data.
  </div>
</div>
${K.foot('Donington National · seven laps', 'Sectors cut at equal distance round the circuit. Average, median and consistency sit in the same panel.', 'RDM Studio')}
`, { title: 'Ideal lap', css: '.tight td{padding:9px 0;font-size:26px}.tight td.n{font-size:31px}' });
});

/* ---- 05 · the grip circle ---------------------------------------------- */
P('05-grip', 'The grip circle', D => {
    const d = D.donington, g = d.grip;
    const S = 720, cx = S / 2, cy = S / 2, R = S / 2 - 58;
    const full = Math.max(1, Math.ceil(d.moments.peakCombined * 2) / 2);
    let dots = '';
    g.pts.forEach(p => {
        const x = cx + (p[0] / full) * R, y = cy - (p[1] / full) * R;
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${K.speedColour(p[2])}" opacity="0.62"/>`;
    });
    /* Ring labels off the data and onto the 135° diagonal, each on a chip of
       the page ground. Straight up the vertical axis they landed exactly on
       the band of dots the whole picture is about — the 0.5 g label was
       unreadable and it was hiding samples underneath it. */
    let rings = '';
    for (let v = 0.5; v <= full + 0.001; v += 0.5) {
        const rr = R * v / full, k = Math.SQRT1_2;
        const lx = cx - rr * k, ly = cy - rr * k;
        const txt = v.toFixed(1) + ' g';
        rings += `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="none" stroke="${v === full ? C.div : C.divLt}" stroke-width="1"/>`;
        rings += `<rect x="${(lx - 25).toFixed(1)}" y="${(ly - 13).toFixed(1)}" width="50" height="24" fill="${C.bg}"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 6).toFixed(1)}" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="21" fill="${C.n400}">${txt}</text>`;
    }
    const svg = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  ${rings}
  <line x1="${cx - R}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="${C.div}" stroke-width="1"/>
  <line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="${cy + R}" stroke="${C.div}" stroke-width="1"/>
  ${dots}
  ${(() => { /* the live readout: where the car is at the playhead */
        const q = g.pts[Math.round(g.pts.length * 0.47)];
        const x = cx + (q[0] / full) * R, y = cy - (q[1] / full) * R;
        /* The dashed spoke had no label, so it read as an artefact rather
           than as the one sample the playhead is standing on. */
        return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.red}" stroke-width="1.5" stroke-dasharray="4 4" opacity="0.65"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="${C.red}" stroke="${C.bg}" stroke-width="2.5"/>
      <text x="${x.toFixed(1)}" y="${(y + 34).toFixed(1)}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.3" fill="${C.red}">AT THE PLAYHEAD</text>`;
    })()}
  ${['ACCELERATING', 'RIGHT', 'BRAKING', 'LEFT'].map((t, i) => {
        const pos = [[cx, cy - R - 20], [cx + R - 2, cy + 30], [cx, cy + R + 34], [cx - R + 2, cy + 30]][i];
        const anch = ['middle', 'end', 'middle', 'start'][i];
        return `<text x="${pos[0]}" y="${pos[1]}" text-anchor="${anch}" font-family="Barlow Condensed" font-weight="700" font-size="24" letter-spacing="2.4" fill="${C.muted}">${t}</text>`;
    }).join('')}
</svg>`;
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">The grip circle</div>
  <h1 class="sm">Every gramme of grip —<br>and where you left some</h1>
  <div class="sub">One dot per sample of the lap, placed by what the tyres were doing: how hard you were turning against how hard you were braking or driving.</div>
  <div style="display:flex;justify-content:center;margin:10px 0 0">${svg}</div>
  <div class="grow"></div>
  <div class="rule hard" style="margin:0 0 20px"></div>
  <div style="display:flex;align-items:flex-end;padding-bottom:8px">
    <div>
      <div class="unit" style="font-size:22px">Hardest braking</div>
      <div class="big" style="font-size:82px">${d.moments.brake.g.toFixed(2)}<span style="font-size:34px;color:${C.muted}"> g</span></div>
    </div>
    <div style="margin-left:52px">
      <div class="unit" style="font-size:22px">Peak cornering</div>
      <div class="big" style="font-size:82px">${d.moments.corner.g.toFixed(2)}<span style="font-size:34px;color:${C.muted}"> g</span></div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="unit" style="font-size:22px">Combined</div>
      <div class="big" style="font-size:82px;color:${C.red}">${d.moments.peakCombined.toFixed(2)}<span style="font-size:34px"> g</span></div>
    </div>
  </div>
</div>
${K.foot('One dot per sample · colour is speed', 'A full circle means the tyre was working everywhere. The empty corners are the free time.', 'RDM Studio')}
`, { title: 'Grip circle' });
});

/* ---- 06 · moments ------------------------------------------------------ */
P('06-moments', 'Moments', D => {
    const d = D.donington, m = d.moments;
    const card = (label, big, unit, note) => `
  <div style="border-top:1px solid ${C.div};padding:26px 0 24px;display:flex;align-items:flex-start">
    <div style="flex:1">
      <div class="unit" style="font-size:23px;letter-spacing:.17em">${label}</div>
      <div style="font-size:25px;color:${C.soft};margin-top:9px;max-width:520px;line-height:1.32">${note}</div>
    </div>
    <div style="text-align:right;min-width:330px">
      <div class="big" style="font-size:104px">${big}<span style="font-size:38px;color:${C.muted}"> ${unit}</span></div>
    </div>
  </div>`;
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">Moments</div>
  <h1>The bits worth<br>watching again</h1>
  <div class="sub">The app finds them and puts them in a list. Click one and the playhead — and the video with it — jumps straight there.</div>
  <div style="margin-top:30px">
    ${card('Top speed', m.top.kph.toFixed(1), 'km/h', 'Five sixths of the way round, with one corner still to come.')}
    ${card('Hardest braking', m.brake.g.toFixed(2), 'g', `Hauling it down from ${m.brake.kph.toFixed(0)} km/h, halfway round the lap.`)}
    ${card('Highest cornering', m.corner.g.toFixed(2), 'g', `Held at ${m.corner.kph.toFixed(0)} km/h — a corner taken very nearly flat.`)}
    ${card('Fastest lap', '1:08.215', '', 'Lap 6 of 7, and 0.278 s clear of the next best.')}
  </div>
  <div style="margin-top:auto;padding-bottom:20px">
    <div class="rule hard"></div>
    <div class="unit" style="font-size:21px;padding-top:18px">Everything it looks for · solid are the four above</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;padding-top:12px">
      ${[['Top speed', 1], ['Hardest braking', 1], ['Highest cornering', 1], ['Fastest lap', 1],
       ['Biggest slide', 0], ['Best launch', 0], ['Near-spin', 0]]
            .map(([t, on]) => `<span class="chip${on ? '' : ' line'}">${t}</span>`).join('')}
    </div>
  </div>
</div>
${K.foot('Donington National · lap 6', 'Every moment is a sample index, so it is the same instant on the map, the graph and the footage.', 'RDM Studio')}
`, { title: 'Moments' });
});

/* ---- 07 · the drift score ---------------------------------------------- */
P('07-drift-score', 'Out of five', D => {
    const t = D.drift, s = t.star, p = s.rating.parts;
    return K.page(`
${K.bar('Drift Mode', '<span class="chip red">Corner 2 · Lap 4</span>')}
<div class="body">
  <div class="kicker">Drift mode</div>
  <h1>Every corner,<br>out of five</h1>
  <div class="sub">Not a session score, not a run score — <b>one corner, on one lap</b>. That is the thing you can actually go and do better next time round.</div>
  <div style="display:flex;align-items:center;margin:28px 0 6px">
    <div class="big" style="font-size:236px;color:${C.red};line-height:.8">${s.rating.stars.toFixed(1)}</div>
    <div style="margin-left:34px;padding-top:16px">
      ${stars(s.rating.stars, 62, 8, C.red, C.n300)}
      <div style="font-size:25px;color:${C.soft};margin-top:14px;max-width:330px;line-height:1.3">Held <b>${s.read.angle.held.toFixed(1)}°</b> for <b>${s.read.angle.secs.toFixed(1)} s</b>, peaking at <b>${s.read.angle.peak.toFixed(0)}°</b>, in at <b>${s.read.entryKph.toFixed(0)} km/h</b>.</div>
    </div>
  </div>
  <div class="rule hard" style="margin:22px 0 26px"></div>
  <div style="display:flex;gap:56px">
    <div style="flex:1">
      ${meter('Angle', p.angle, `held ${t.fullMarksDeg}° is full marks · 45% of the score`, 420)}
      ${meter('Commitment', p.commit, 'sideways for all of it · 25%', 420)}
    </div>
    <div style="flex:1">
      ${meter('Steadiness', p.steady, 'from the sideslip rate, not the spread · 20%', 420)}
      ${meter('Speed', p.speed, 'against your own best here · 10%', 420)}
    </div>
  </div>
  <div class="grow"></div>
  <div style="border-top:1px solid ${C.div};padding-top:18px;display:flex;align-items:center;gap:26px;padding-bottom:8px">
    ${circuit(t.outline, 470, 268, {
        /* The scored corner gets a marker, not just a change of colour: at
           this size the red run is forty pixels of line, and "which corner"
           is the only thing the map is here to answer. */
        width: 7, pad: 34, casing: null,
        col: (r, i) => {
            const f = i / (t.outline.length - 1);
            return (f >= t.starFrac[0] && f <= t.starFrac[1]) ? C.red : 'rgba(29,31,32,0.30)';
        },
        over: p => {
            const j = Math.round((t.starFrac[0] + t.starFrac[1]) / 2 * (t.outline.length - 1));
            const a = p.xy[j];
            return `<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="15" fill="none" stroke="${C.red}" stroke-width="2.5"/>
      <text x="${a[0].toFixed(1)}" y="${(a[1] - 24).toFixed(1)}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="22" letter-spacing="1.4" fill="${C.red}">CORNER 2</text>`;
        }
    })}
    <div style="flex:1">
      <div class="unit" style="font-size:22px">This corner, on this lap</div>
      <div style="font-size:27px;line-height:1.34;margin-top:9px;font-weight:500">
        Ten corners, five laps, <b>${t.units} scored units</b> — and every one of them gets its own mark, its own best lap and its own reason.</div>
    </div>
  </div>
</div>
${K.foot('Mallala Motor Sport Park · drift practice', 'Every part is shown beside the stars, so the number is never the only thing on screen.', 'RDM Studio')}
`, { title: 'Drift score' });
});

/* ---- 08 · the angle ---------------------------------------------------- */
P('08-drift-angle', 'How sideways', D => {
    const t = D.drift, a = t.angleTrace, pts = a.pts;
    const w = 1000, h = 500;
    const t1 = pts[pts.length - 1][0];
    /* Scaled to this corner, not to the whole session: the error band is a
       few degrees and would be a hairline on a +/-90 axis. */
    /* Asymmetric, to the data: this drift is entirely one way, and a
       symmetric axis would spend half the box on a half-plane nothing
       reaches. Room is kept past 40 so the full-marks line has somewhere
       to sit. */
    const aLo = Math.min(-44, Math.min(...pts.map(p => (p[1] || 0) - (p[3] || 0))) * 1.10);
    const aHi = Math.max(8, Math.max(...pts.map(p => (p[1] || 0) + (p[3] || 0))) * 1.30);
    const X = v => 6 + (v / t1) * (w - 12);
    const Y = v => 22 + (aHi - v) / (aHi - aLo) * (h - 62);
    const band = 'M' + pts.map(p => X(p[0]).toFixed(1) + ' ' + Y((p[1] || 0) + (p[3] || 0)).toFixed(1)).join('L') +
        'L' + pts.slice().reverse().map(p => X(p[0]).toFixed(1) + ' ' + Y((p[1] || 0) - (p[3] || 0)).toFixed(1)).join('L') + 'Z';
    const line = 'M' + pts.map(p => X(p[0]).toFixed(1) + ' ' + Y(p[1] || 0).toFixed(1)).join('L');
    const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="${X(a.inFrom)}" y="0" width="${(X(a.inTo) - X(a.inFrom)).toFixed(1)}" height="${h}" fill="${C.red100}"/>
  ${[-40, -20, 0].filter(v => v !== 0).concat([]).map(v => `<line x1="0" y1="${Y(v)}" x2="${w}" y2="${Y(v)}" stroke="${C.divLt}" stroke-width="1"/>
     <text x="6" y="${Y(v) - 8}" font-family="Barlow Condensed" font-weight="600" font-size="21" fill="${C.n400}">${v > 0 ? '+' : '−'}${Math.abs(v)}°</text>`).join('')}
  <line x1="0" y1="${Y(0)}" x2="${w}" y2="${Y(0)}" stroke="${C.ink}" stroke-width="2"/>
  <!-- Set in from the left, where the car is already sideways and the space
       above the zero line is empty. At the left edge the trace itself starts
       ON zero and dived straight through the caption's first character. -->
  <text x="${(w * 0.34).toFixed(0)}" y="${Y(0) - 11}" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.6" fill="${C.muted}">0° · POINTING WHERE IT IS GOING</text>
  ${(() => { /* on the side the car actually went, or the reference sits in
        an empty half of the chart and reads as belonging to nothing */
        const sgn = pts.reduce((a, p) => a + (p[1] || 0), 0) < 0 ? -1 : 1;
        return `<line x1="0" y1="${Y(40 * sgn)}" x2="${w}" y2="${Y(40 * sgn)}" stroke="${C.red}" stroke-width="1.5" stroke-dasharray="7 5"/>
  <text x="${w - 5}" y="${Y(40 * sgn) + (sgn < 0 ? 28 : -11)}" text-anchor="end" font-family="Barlow Condensed" font-weight="700" font-size="23" letter-spacing="1.4" fill="${C.red}">FULL MARKS · HELD 40°</text>`;
    })()}
  <path d="${band}" fill="${C.ink}" opacity="0.13"/>
  <path d="${line}" fill="none" stroke="${C.ink}" stroke-width="3.6" stroke-linejoin="round"/>
  <text x="${X((a.inFrom + a.inTo) / 2)}" y="${h - 12}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="24" letter-spacing="1.8" fill="${C.red}">SIDEWAYS FOR ${(a.inTo - a.inFrom).toFixed(1)} S</text>
  <text x="6" y="${h - 12}" font-family="Barlow Condensed" font-weight="600" font-size="21" letter-spacing="1.5" fill="${C.muted}">SHADED BAND = THE ERROR BAR</text>
</svg>`;
    return K.page(`
${K.bar('Drift Mode')}
<div class="body">
  <div class="kicker">The angle, and the error bar on it</div>
  <h1>How sideways —<br>and how sure</h1>
  <div class="sub">The shaded band is the app's own uncertainty about the reading. When it cannot tell you accurately, it says so instead of drawing a confident line.</div>
  <div style="margin:24px 0 0 -14px">${svg}</div>
  <div style="background:${C.surface};border:1px solid ${C.div};padding:20px 24px;font-size:25px;line-height:1.36;font-weight:500;margin-top:6px">
    The sensor is corrected before you ever see this line — this one read <b>${((t.fit.scale - 1) * 100).toFixed(1)}% long</b> and sat <b>${t.fit.bias.toFixed(2)}°/s off zero</b>, found from ${t.fit.anchors} places on the drive where the car was demonstrably straight.
  </div>
  <div class="grow"></div>
  <div class="rule hard" style="margin:0 0 20px"></div>
  <div style="display:flex;align-items:flex-end;padding-bottom:8px">
    <div>
      <div class="unit" style="font-size:22px">Peak angle</div>
      <div class="big" style="font-size:104px;color:${C.red}">${D.drift.star.read.angle.peak.toFixed(0)}<span style="font-size:44px">°</span></div>
    </div>
    <div style="margin-left:50px">
      <div class="unit" style="font-size:22px">Held</div>
      <div class="big" style="font-size:104px">${D.drift.star.read.angle.held.toFixed(1)}<span style="font-size:44px">°</span></div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="unit" style="font-size:22px">Reading good to</div>
      <div class="big" style="font-size:104px;color:${C.muted}">±${D.drift.star.read.angle.conf.toFixed(1)}<span style="font-size:44px">°</span></div>
    </div>
  </div>
</div>
${K.foot('Angle from the yaw sensor, against the path the car actually took', 'A spin is not a very good drift — the app refuses to rate one rather than giving it full marks.', 'RDM Studio')}
`, { title: 'Angle' });
});

/* ---- 09 · the board ---------------------------------------------------- */
P('09-drift-board', 'The board', D => {
    const t = D.drift;
    const rows = t.table.map(r => {
        const name = 'Turn ' + r.corners.join(' + ');
        return `<tr>
      <td class="n" style="width:210px">${name}${r.linked ? `<span style="font-family:'Barlow';font-weight:600;font-size:17px;letter-spacing:.12em;color:${C.red};margin-left:9px;vertical-align:middle">LINKED</span>` : ''}</td>
      <td style="width:230px">${r.stars === null ? `<span style="color:${C.muted};font-size:23px">${r.unrated}</span>` : stars(r.stars, 26, 4, C.red, C.n300)}</td>
      <td class="n r" style="width:150px">${r.stars === null ? '—' : r.stars.toFixed(1)}</td>
      <td class="n r" style="width:170px;color:${C.soft}">${r.heldDeg === null ? '—' : r.heldDeg.toFixed(0) + '°'}</td>
      <td class="n r" style="width:200px;color:${C.soft}">${r.entryKph === null ? '—' : r.entryKph.toFixed(0) + ' km/h'}</td>
    </tr>`;
    }).join('');
    return K.page(`
${K.bar('Drift Mode')}
<div class="body">
  <div class="kicker">The board · lap ${t.bestLap} of ${t.laps.length}</div>
  <h1 class="xs">A complex driven as<br>one drift is scored<br>as one drift</h1>
  <div class="sub">Corners that you link get read as a single unit — so the flick between them counts as holding it, not as losing it and catching it again.</div>
  <div style="margin-top:26px" class="tight">
    <table>
      <tr><th>Corner</th><th>Rating</th><th class="r">Stars</th><th class="r">Held</th><th class="r">Entry speed</th></tr>
      ${rows}
    </table>
  </div>
  <div style="margin-top:22px;background:${C.red100};border-left:4px solid ${C.red};padding:19px 24px">
    <div style="font-size:24px;line-height:1.34;font-weight:500">Turn&nbsp;7 is not rated, and it does not score nought. The car went round it on the grip — that is not a bad drift, it is <b>not a drift</b>, and nought would read as an insult rather than a fact.</div>
  </div>
  <div class="grow"></div>
  <div style="padding-bottom:10px">
    <div class="rule hard"></div>
    <div style="display:flex;align-items:flex-end;padding-top:18px">
      <div><div class="unit" style="font-size:21px">Lap average</div>
        <div class="big" style="font-size:84px;color:${C.red}">${t.lapAvg[t.bestLap - 1].stars.toFixed(2)}</div></div>
      <div style="margin-left:auto;text-align:right;max-width:430px">
        <div class="unit" style="font-size:21px">Over ${t.lapAvg[t.bestLap - 1].n} rated corners</div>
        <div style="font-size:23px;color:${C.soft};margin-top:6px;line-height:1.28">The count sits beside the number, so an average over three is never mistaken for one over eight.</div>
      </div>
    </div>
  </div>
</div>
${K.foot('Mallala Motor Sport Park · drift practice', 'Linkage is decided once for the session, not lap by lap — or the table would change shape under you.', 'RDM Studio')}
`, { title: 'The board', css: '.tight td{padding:6px 0;font-size:25px}.tight td.n{font-size:29px}.tight th{font-size:19px}' });
});

/* ---- 10 · trust -------------------------------------------------------- */
P('10-trust', 'When not to believe it', D => {
    const m = D.mallala, sp = m.speed;
    /* The gaps read far better on the speed trace than on the map, where a
       hole is a few pixels of a line that already crosses itself. */
    const w = 1000, h = 424, T = sp[sp.length - 1][0];
    const vmax = Math.max(...sp.map(p => p[1])) * 1.06;
    const X = t => 8 + (t / T) * (w - 16);
    const Y = v => h - 46 - (v / vmax) * (h - 88);
    const line = 'M' + sp.map(p => X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('L');
    const marks = m.gapsAt.map((g, i) => `
    <line x1="${X(g.t).toFixed(1)}" y1="14" x2="${X(g.t).toFixed(1)}" y2="${h - 46}" stroke="${C.red}" stroke-width="2.5"/>
    <rect x="${(X(g.t) - 32).toFixed(1)}" y="14" width="64" height="26" fill="${C.red}"/>
    <text x="${X(g.t).toFixed(1)}" y="33" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="20" fill="#fff">${g.m} M</text>
    <text x="${X(g.t).toFixed(1)}" y="${h - 24}" text-anchor="middle" font-family="Barlow Condensed" font-weight="700" font-size="21" letter-spacing="1.2" fill="${C.red}">GAP ${i + 1}</text>`).join('');
    const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${[50, 100, 150].map(v => `<line x1="0" y1="${Y(v)}" x2="${w}" y2="${Y(v)}" stroke="${C.divLt}" stroke-width="1"/>
    <text x="3" y="${Y(v) - 7}" font-family="Barlow Condensed" font-weight="600" font-size="19" fill="${C.n400}">${v} km/h</text>`).join('')}
  <path d="${line}" fill="none" stroke="${C.ink}" stroke-width="1.9" stroke-linejoin="round" opacity="0.85"/>
  <line x1="0" y1="${h - 46}" x2="${w}" y2="${h - 46}" stroke="${C.ink}" stroke-width="2"/>
  ${marks}
  <text x="2" y="${h - 4}" font-family="Barlow Condensed" font-weight="600" font-size="19" letter-spacing="1.5" fill="${C.muted}">0:00</text>
  <text x="${w - 2}" y="${h - 4}" text-anchor="end" font-family="Barlow Condensed" font-weight="600" font-size="19" letter-spacing="1.5" fill="${C.muted}">35:05 · WHOLE SESSION</text>
</svg>`;
    /* The three facts share a baseline, so the number sets the row height and
       the notes line up under it. "124 · 226 · 36 m" wrapped onto a second
       line at 62 px and dragged its own caption out of step with the two
       beside it — the size is what has to give, not the alignment. */
    const fact = (l, v, n, sz) => `<div style="flex:1"><div class="unit" style="font-size:21px">${l}</div>
    <div class="big" style="font-size:${sz || 62}px;margin-top:5px;height:62px;display:flex;align-items:flex-end;white-space:nowrap">${v}</div>
    <div style="font-size:20px;color:${C.muted};margin-top:9px;line-height:1.28">${n}</div></div>`;
    return K.page(`
${K.bar('GPS Lap Timer', '<span class="chip">Trust</span>')}
<div class="body">
  <div class="kicker">The trust panel</div>
  <h1 class="sm">It tells you when<br>not to believe it</h1>
  <div class="sub">Three times in this session the fix dropped out. The app finds every gap, marks it, and says how far the car travelled while it was not looking — because a lap timed across a hole reads <b>seconds fast</b>.</div>
  <div style="margin:22px 0 0 -14px">${svg}</div>
  <div class="rule hard" style="margin:2px 0 22px"></div>
  <div style="display:flex;gap:34px">
    ${fact('Gaps found', m.breaks.count, 'Marked on the map, the graph and the report')}
    ${fact('Unseen distance', m.breaks.metres.join(' · ') + '<span style="font-size:26px;color:' + C.muted + '"> m</span>', 'How far the car went while the fix was gone', 52)}
    ${fact('Angle reading', '±' + m.angle.worst.toFixed(1) + '°', 'Worst case the engine will admit to')}
  </div>
  <div class="grow"></div>
  <div style="background:${C.surface};border:1px solid ${C.div};padding:22px 26px;margin-bottom:22px">
    <div style="font-size:24px;line-height:1.4;font-weight:500">The car's yaw sensor sat <b>${Math.abs(m.angle.bias).toFixed(2)}°/s</b> off zero and read <b>${((1 - m.angle.scale) * 100).toFixed(1)}%</b> short, found from ${m.angle.anchors} places in this drive where the car was demonstrably straight. Corrected — and the correction is printed, not hidden inside the number.</div>
  </div>
</div>
${K.foot('Mallala Motor Sport Park · 23 August 2026 · 25,720 samples', 'A real session with real dropouts. This is the recording the trust panel was built for.', 'RDM Studio')}
`, { title: 'Trust' });
});

/* ---- 11 · the line ----------------------------------------------------- */
P('11-line', "A car's width", D => {
    const d = D.donington, pts = d.lineOffset;
    const mag = Math.max(...pts.map(p => Math.abs(p[2])));
    const map = circuit(pts, 1000, 700, {
        width: 17, pad: 52, casing: 'rgba(29,31,32,0.14)',
        col: r => K.lineColour(r[2] / mag)
    });
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">The line</div>
  <h1 class="sm">Two laps a car's width<br>apart look identical.<br>Colour does not.</h1>
  <div class="sub">With the whole circuit on screen, a metre is less than one pixel — no stroke is thin enough to show it. So the line is coloured by how far off the reference you actually were, in metres.</div>
  <div style="margin:2px 0 0 -14px">${map}</div>
  <div style="display:flex;align-items:center;margin-top:-10px">
    <div style="display:flex;align-items:center;gap:14px">
      <div style="width:230px;height:22px;background:linear-gradient(90deg,${K.lineColour(-1)},${K.lineColour(0)},${K.lineColour(1)})"></div>
      <div style="font-family:'Barlow Condensed';font-weight:600;font-size:23px;letter-spacing:.11em;text-transform:uppercase;color:${C.muted}">
        ${mag.toFixed(1)} m left &nbsp;·&nbsp; on line &nbsp;·&nbsp; ${mag.toFixed(1)} m right</div>
    </div>
    <div style="margin-left:auto;text-align:right">
      <div class="unit" style="font-size:22px">Biggest difference</div>
      <div class="big" style="font-size:88px;color:${C.red}">${mag.toFixed(2)}<span style="font-size:36px"> m</span></div>
    </div>
  </div>
</div>
${K.foot('Donington National · lap 6 against lap 4', 'Measured, never exaggerated — the number the colour stands for is printed on the legend.', 'RDM Studio')}
`, { title: 'The line' });
});

module.exports = { POSTS, circuit, startTick, scaleBar, stars, meter, scale: 1 };
