/* The second half of the set: the video overlay, the two-lap comparison, the
 * library, the offline promise and the closer.
 */
const K = require('./kit.js');
const { C } = K;
const B = require('./posts.js');

const POSTS = [];
const P = (id, title, fn) => POSTS.push({ id, title, fn });

/* ---- 12 · the video overlay -------------------------------------------- */
/* Drawn to the real HUD's own proportions: one scale off the short side, a
 * dark wash rather than a bar, pedals then speed then gear along the bottom
 * with the minimap pinned right. GP_HUD_* colours throughout. */
P('12-hud', 'The overlay', D => {
    const d = D.donington;
    /* The overlay at the size it is actually rendered, on a plain dark frame:
       this is the instrument panel, not a mock of somebody's footage. */
    const w = 1000, h = 396, S = 1.24;
    const M = 26 * S, BY = h - M;
    const p = K.project(d.outline, 216, 128, 12);
    const mapX = w - M - 220, mapY = BY - 146;
    /* One instant of the real lap, and every readout below is that instant:
       the speed, the g, the delta and the dot on the minimap all come from
       the same sample, because on a real overlay they have to. */
    /* the hardest corner on the lap — the instant the Moments panel calls
       "highest cornering", so two posters describing the same lap agree */
    const frac = 0.283, carI = Math.round((d.outline.length - 1) * frac);
    const car = d.outline[carI];
    const spd = Math.round(car[2]);
    const combG = Math.hypot(car[3], car[4]);
    const dl = d.delta.pts[Math.round((d.delta.pts.length - 1) * frac)].d;
    /* Where that g sits on the circle, in the widget's own coordinates:
       lateral across, longitudinal up, braking down. */
    const gcx = w / 2 + 66 * S, gcy = BY - 48 * S, gR = 42 * S, gFull = 2;
    const gdx = gcx + (car[4] / gFull) * gR, gdy = gcy - (car[3] / gFull) * gR;
    const hud = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="fr" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#232a30"/><stop offset="55%" stop-color="#161b20"/>
      <stop offset="100%" stop-color="#0b0e11"/></linearGradient>
    <linearGradient id="wash" x1="0" y1="${h - 260 * S}" x2="0" y2="${h}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#06080a" stop-opacity="0"/>
      <stop offset="55%" stop-color="#06080a" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#06080a" stop-opacity="0.80"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#fr)"/>
  ${K.road(w, h, 0.40)}
  <rect x="0" y="${Math.max(0, h - 260 * S)}" width="${w}" height="${Math.min(h, 260 * S)}" fill="url(#wash)"/>

  <!-- Speed, from the sample. No pedal tubes: this car reports no throttle
       or brake, and the app draws only the instruments a recording can fill. -->
  <text x="${M}" y="${BY}" font-family="Barlow Condensed" font-weight="700" font-size="${92 * S}" fill="#F5F7FA" letter-spacing="-1">${spd}</text>
  <text x="${M + 152 * S}" y="${BY}" font-family="Barlow" font-weight="600" font-size="${21 * S}" fill="rgba(245,247,250,0.72)">km/h</text>

  <!-- lap time and delta -->
  <text x="${M}" y="${BY - 138 * S}" font-family="Barlow Condensed" font-weight="600" font-size="${19 * S}" letter-spacing="2" fill="rgba(245,247,250,0.62)">LAP 6 · AGAINST LAP 4</text>
  <text x="${M}" y="${BY - 104 * S}" font-family="Barlow Condensed" font-weight="700" font-size="${40 * S}" fill="#F5F7FA">1:08.215</text>
  <text x="${M + 160 * S}" y="${BY - 104 * S}" font-family="Barlow Condensed" font-weight="700" font-size="${40 * S}" fill="#6FBF73">${K.signed(dl, 2)}</text>

  <!-- grip circle -->
  <circle cx="${gcx}" cy="${gcy}" r="${gR}" fill="rgba(10,13,16,0.35)" stroke="rgba(245,247,250,0.28)" stroke-width="1.5"/>
  <circle cx="${gcx}" cy="${gcy}" r="${gR / 2}" fill="none" stroke="rgba(245,247,250,0.16)" stroke-width="1"/>
  <line x1="${gcx - gR}" y1="${gcy}" x2="${gcx + gR}" y2="${gcy}" stroke="rgba(245,247,250,0.16)" stroke-width="1"/>
  <line x1="${gcx}" y1="${gcy - gR}" x2="${gcx}" y2="${gcy + gR}" stroke="rgba(245,247,250,0.16)" stroke-width="1"/>
  <circle cx="${gdx.toFixed(1)}" cy="${gdy.toFixed(1)}" r="${5 * S}" fill="#d2232a"/>
  <text x="${gcx}" y="${gcy + gR + 19 * S}" text-anchor="middle" font-family="Barlow Condensed" font-weight="600" font-size="${15 * S}" letter-spacing="1.6" fill="rgba(245,247,250,0.62)">${combG.toFixed(2)} G</text>

  <!-- minimap: the analyse map's own constant line, with the car on it -->
  <g transform="translate(${mapX},${mapY})">
    <path d="${K.poly(p.xy)}" fill="none" stroke="rgba(245,247,250,0.32)" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="${K.poly(p.xy.slice(0, carI))}" fill="none" stroke="#d2232a" stroke-width="4.5" stroke-linejoin="round"/>
    <circle cx="${p.xy[carI][0].toFixed(1)}" cy="${p.xy[carI][1].toFixed(1)}" r="7.5" fill="#F5F7FA" stroke="#0c0d0e" stroke-width="2"/>
  </g>
  <text x="${w - M}" y="${BY + 14 * S}" text-anchor="end" font-family="Barlow Condensed" font-weight="600" font-size="${17 * S}" letter-spacing="2" fill="rgba(245,247,250,0.62)">DONINGTON NATIONAL</text>
  <text x="${w - M}" y="${M + 16 * S}" text-anchor="end" font-family="Barlow Condensed" font-weight="700" font-size="${20 * S}" letter-spacing="2.6" fill="rgba(245,247,250,0.42)">RDM</text>
</svg>`;
    /* The Layers panel, which is where an overlay is actually built: every
       instrument, whether it is drawn, and the fact that reordering them
       cannot move anything. GP_HUD_WIDGETS, in its own order. */
    const layers = [['Speed and gear', 1], ['Lap time and delta', 1], ['Grip circle', 1],
        ['Minimap', 1], ['Track and date', 1], ['RDM mark', 1],
        ['Throttle and brake', 0], ['Tacho', 0], ['Slip angle', 0],
        ['Counter-steer', 0], ['Drift run', 0]];
    const eye = on => on
        ? `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${C.red}" stroke-width="2"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="2.6"/></svg>`
        : `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${C.n400}" stroke-width="2"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><path d="M4 20L20 4"/></svg>`;
    const layerRow = ([name, on]) => `<div style="display:flex;align-items:center;gap:12px;padding:9px 12px;border-bottom:1px solid ${C.divLt};background:${on ? C.surface : 'transparent'}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${C.n400}"><circle cx="8" cy="5" r="2"/><circle cx="16" cy="5" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="19" r="2"/><circle cx="16" cy="19" r="2"/></svg>
      ${eye(on)}
      <div style="font-family:'Barlow Condensed';font-weight:600;font-size:25px;letter-spacing:.04em;text-transform:uppercase;color:${on ? C.ink : C.muted}">${name}</div>
    </div>`;
    return K.page(`
${K.bar('Video')}
<div class="body">
  <div class="kicker">The overlay</div>
  <h1>Burn the numbers<br>into the footage</h1>
  <div class="sub">Open your video beside the recording, line it up once, and the app renders the telemetry straight into the exported file. No second program.</div>
  <div style="margin:22px 0 0 -14px">${hud}</div>
  <div class="grow"></div>
  <div style="display:flex;gap:20px;align-items:flex-start;padding-bottom:10px">
    <div style="flex:none;width:322px;border:1px solid ${C.div};background:${C.bg}">
      <div style="background:${C.ink};color:#fff;font-family:'Barlow Condensed';font-weight:700;font-size:22px;letter-spacing:.18em;text-transform:uppercase;padding:9px 12px">Layers</div>
      ${layers.slice(0, 6).map(layerRow).join('')}
    </div>
    <div style="flex:none;width:322px;border:1px solid ${C.div};background:${C.bg};margin-top:41px">
      ${layers.slice(6).map(layerRow).join('')}
    </div>
    <div style="flex:1;padding-top:41px">
      <div class="unit" style="font-size:21px;letter-spacing:.16em">Eleven instruments</div>
      <div style="font-size:24px;line-height:1.34;margin-top:10px;font-weight:500">Drag one anywhere on the picture. Reorder them, and <b>nothing moves</b> — the order decides what covers what, never where a thing belongs.</div>
    </div>
  </div>
</div>
${K.foot('Exports queue and run in the background', 'No pedal bars here: this car reports no throttle or brake, and an empty tube beside a working one is a lie about the driving.', 'RDM Studio')}
`, { title: 'Overlay' });
});

/* ---- 13 · two laps, one video ------------------------------------------ */
P('13-two-laps', 'Two laps, one video', D => {
    const d = D.donington, pr = d.pair;
    const clock = t => Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(2);
    const frame = (tag, side, col) => {
        const p = K.project(d.outline, 200, 112, 10);
        const i = Math.round(d.outline.length * pr.frac);
        /* Same road as the overlay poster draws, so the two video posts are
           looking out of the same windscreen. */
        return `<div style="flex:1;background:#12161a;position:relative;height:296px;overflow:hidden">
      <div style="position:absolute;inset:0;background:linear-gradient(157deg,#2b333b,#151b21 58%,#0a0d10)"></div>
      <svg style="position:absolute;inset:0" width="493" height="296" viewBox="0 0 493 296">${K.road(493, 296, 0.46)}</svg>
      <div style="position:absolute;left:0;right:0;bottom:0;height:170px;background:linear-gradient(180deg,rgba(6,8,10,0),rgba(6,8,10,.86))"></div>
      <div style="position:absolute;left:20px;top:18px;font-family:'Barlow Condensed';font-weight:700;font-size:23px;letter-spacing:.14em;color:${col}">${tag}</div>
      <div style="position:absolute;left:20px;bottom:54px;font-family:'Barlow Condensed';font-weight:700;font-size:78px;color:#F5F7FA;line-height:.84">${side.kph.toFixed(0)}<span style="font-size:23px;color:rgba(245,247,250,.7);font-weight:600"> km/h</span></div>
      <div style="position:absolute;left:20px;bottom:18px;font-family:'Barlow Condensed';font-weight:700;font-size:31px;color:#F5F7FA">${clock(side.t)}</div>
      <svg style="position:absolute;right:14px;bottom:14px" width="200" height="112" viewBox="0 0 200 112">
        <path d="${K.poly(p.xy)}" fill="none" stroke="rgba(245,247,250,0.26)" stroke-width="3.2"/>
        <path d="${K.poly(p.xy.slice(0, i))}" fill="none" stroke="${col}" stroke-width="3.2"/>
        <circle cx="${p.xy[i][0].toFixed(1)}" cy="${p.xy[i][1].toFixed(1)}" r="6" fill="#F5F7FA" stroke="#0c0d0e" stroke-width="1.6"/>
      </svg>
    </div>`;
    };
    return K.page(`
${K.bar('Video')}
<div class="body">
  <div class="kicker">Two laps, one video</div>
  <h1 class="sm">Side by side, paired<br>by place — not by clock</h1>
  <div class="sub">Play two laps together and they stay together, because the app matches them on where the car is round the circuit. The faster one does not simply run away.</div>
  <div style="display:flex;gap:14px;margin-top:28px">
    ${frame('LAP 6 · 1:08.215', pr.a, '#6FBF73')}
    ${frame('LAP 4 · 1:08.493', pr.b, '#e05d52')}
  </div>
  <div style="background:${C.ink};color:#fff;padding:22px 26px;display:flex;align-items:center;margin-top:14px">
    <div style="font-family:'Barlow Condensed';font-weight:600;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:${C.barMuted}">Both cars at ${(pr.metres / 1000).toFixed(2)} km round</div>
    <div style="margin-left:auto;display:flex;align-items:baseline;gap:14px">
      <div style="font-family:'Barlow Condensed';font-weight:600;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:${C.barMuted}">Gap</div>
      <div class="big" style="font-size:64px;color:#6FBF73">${K.signed(pr.gap, 2)}<span style="font-size:28px"> s</span></div>
    </div>
  </div>
  <!-- A quarter of this poster was blank, under a caption claiming both cars
       were at the same place. So show the place: one circuit, one marker,
       which is the whole argument for pairing by position. -->
  ${(() => {
        const p = K.project(d.outline, 1000, 196, 22);
        const i = Math.round(d.outline.length * pr.frac);
        const a = p.xy[i];
        return `<div style="margin:10px 0 0 -14px"><svg width="1000" height="196" viewBox="0 0 1000 196">
      <path d="${K.poly(p.xy)}" fill="none" stroke="rgba(29,31,32,0.22)" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="${K.poly(p.xy.slice(0, i))}" fill="none" stroke="${C.ink}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="17" fill="none" stroke="${C.red}" stroke-width="3"/>
      <circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="7" fill="${C.red}"/>
      <text x="${(a[0] + 28).toFixed(1)}" y="${(a[1] + 8).toFixed(1)}" font-family="Barlow Condensed" font-weight="700" font-size="24" letter-spacing="1.5" fill="${C.red}">ONE PLACE · TWO LAPS</text>
    </svg></div>`;
    })()}
  <div class="grow"></div>
  <div style="padding-bottom:12px">
    <div class="rule hard"></div>
    <div style="font-size:27px;line-height:1.36;padding-top:18px;font-weight:500;max-width:920px">
      Look at the speeds. At this point on the circuit the <b style="color:${C.red}">slower lap is the faster car</b> — ${pr.b.kph.toFixed(0)} against ${pr.a.kph.toFixed(0)} km/h — and it is still ${Math.abs(pr.gap).toFixed(2)}&nbsp;s down. On a stopwatch that is invisible. Side by side it is obvious.
    </div>
  </div>
</div>
${K.foot('Donington National · lap 6 against lap 4', 'Play them together and they stay together, because the pairing is by place and not by clock.', 'RDM Studio')}
`, { title: 'Two laps' });
});

/* ---- 14 · the library -------------------------------------------------- */
P('14-library', 'Every circuit you have driven', D => {
    const card = (pts, name, big, note, red) => {
        const p = K.project(pts, 280, 200, 22);
        return `<div style="flex:1;background:${C.surface};border:1px solid ${C.div};padding:20px">
      <svg width="280" height="200" viewBox="0 0 280 200" style="display:block;margin:0 auto">
        <path d="${K.poly(p.xy)}" fill="none" stroke="${red ? C.red : 'rgba(29,31,32,0.55)'}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>
      <div style="border-top:1px solid ${C.div};margin-top:14px;padding-top:14px">
        <div style="font-family:'Barlow Condensed';font-weight:700;font-size:31px;text-transform:uppercase;letter-spacing:.03em;line-height:1">${name}</div>
        <div class="big" style="font-size:50px;margin-top:9px;${red ? 'color:' + C.red : ''}">${big}</div>
        <div style="font-size:20px;color:${C.muted};margin-top:5px">${note}</div>
      </div>
    </div>`;
    };
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body">
  <div class="kicker">The library</div>
  <h1 class="sm">Open it with nothing<br>loaded and it still<br>has something to say</h1>
  <div class="sub">Every circuit you have ever driven, drawn — with how many recordings sit on each and what your best there is. The one you drove most recently wears the accent.</div>
  <div style="display:flex;gap:14px;margin-top:30px">
    ${card(D.donington.outline, 'Donington', '1:08.215', '7 laps · 1 recording')}
    ${card(D.mallala.lapOutline || D.mallala.trace, 'Mallala', '2:16.091', '4 laps · 1 recording', true)}
    ${card(D.mountbarker.trace, 'Mount Barker', D.mountbarker.km + ' km', '31 runs · time trial')}
  </div>
  <div style="margin-top:26px;border-top:2px solid ${C.ink};padding-top:20px" class="tight">
    <table>
      <tr><th>Recording</th><th class="r">Samples</th><th class="r">Rate</th><th class="r">Channels</th></tr>
      <tr><td>Donington · Lotus Evora GTE</td><td class="n r">6,063</td><td class="n r">10 Hz</td><td class="n r">1</td></tr>
      <tr><td>Mallala · 23 August 2026</td><td class="n r">25,720</td><td class="n r">25 Hz</td><td class="n r">12</td></tr>
      <tr><td>Mount Barker · 22 August 2026</td><td class="n r">168,105</td><td class="n r">25 Hz</td><td class="n r">12</td></tr>
    </table>
  </div>
  <div class="grow"></div>
  <div style="padding-bottom:12px;font-size:26px;line-height:1.35;font-weight:500;max-width:900px">
    Clicking a circuit <b>offers</b> its recordings rather than opening one. You pick the day.
  </div>
</div>
${K.foot('Imports VBO, opens its own recordings, pulls straight off the puck', 'Nothing invented — the library and the session store, drawn instead of hidden.', 'RDM Studio')}
`, { title: 'Library', css: '.tight td{padding:9px 0;font-size:25px}.tight td.n{font-size:29px}' });
});

/* ---- 15 · at the track ------------------------------------------------- */
P('15-offline', 'The track has no internet', D => {
    const row = (n, t, s) => `<div style="display:flex;gap:24px;padding:24px 0;border-bottom:1px solid ${C.barDiv}">
    <div style="font-family:'Barlow Condensed';font-weight:700;font-size:30px;color:${C.red};width:52px;flex:none">${n}</div>
    <div><div style="font-family:'Barlow Condensed';font-weight:700;font-size:36px;letter-spacing:.03em;text-transform:uppercase;color:#fff;line-height:1.05">${t}</div>
    <div style="font-size:23px;color:${C.barMuted};margin-top:8px;line-height:1.35;max-width:790px">${s}</div></div>
  </div>`;
    return K.page(`
${K.bar('GPS Lap Timer')}
<div class="body dark">
  <div class="kicker" style="color:${C.red}">Where you actually use it</div>
  <h1 style="color:#fff">The track has<br>no internet</h1>
  <div class="sub" style="color:${C.barMuted}">So none of this needs any. It is a desktop app: the recordings are files on your machine and the analysis runs on it.</div>
  <div style="margin-top:30px">
    ${row('01', 'Local mode is a real mode', 'Not a degraded one. With no device plugged in the app still opens, still analyses, still exports — it serves itself the same way the dash would.')}
    ${row('02', 'The puck plugs into USB', 'Pull the session straight off it in the paddock, between runs, with a laptop on the boot lid.')}
    ${row('03', 'Video renders on your machine', 'The overlay is burned in locally and the exports queue up in the background while you keep working.')}
    ${row('04', 'Even the typefaces are bundled', 'Because a font that fetches itself is a font that is missing when it matters.')}
  </div>
  <div style="margin-top:auto;padding-bottom:34px;display:flex;align-items:flex-end">
    <div style="font-family:'Barlow Condensed';font-weight:700;font-size:58px;color:#fff;line-height:1;text-transform:uppercase;letter-spacing:.02em">No account.<br>No upload.<br><span style="color:${C.red}">No signal needed.</span></div>
  </div>
</div>
${K.foot('RDM Studio · Windows, macOS and Linux', 'The desktop half of the RDM device family.', 'RDM Studio')}
`, {
        title: 'Offline', css: `
  .body.dark{background:${C.bar}}
  body{background:${C.bar}}
  .foot{background:${C.bg};border-top:none}
  .body.dark h1{color:#fff}` });
});

/* ---- 16 · the closer --------------------------------------------------- */
P('16-closer', 'What is in it', D => {
    const items = [
        ['Lap timing', 'From a line you place once, or from where the car actually stopped'],
        ['Continuous delta', 'Against any lap, matched by place'],
        ['Corner report', 'Ranked by the time each one cost you'],
        ['The ideal lap', 'Best sectors, plus average, median and consistency'],
        ['Drift scoring', 'Every corner on every lap, out of five'],
        ['Slip angle', 'With the error bar on the reading printed'],
        ['Grip circle', 'Live at the playhead, and for the whole lap'],
        ['Moments', 'The bits worth watching again, found for you'],
        ['Video, synced', 'Two laps at once, paired by place'],
        ['Overlay export', 'Eleven instruments burned into the file'],
        ['Trust panel', 'Every dropout found, marked and measured'],
        ['CAN channels', 'Twelve from the car, live beside the GPS']
    ];
    return K.page(`
${K.bar('Lap timer · Drift mode')}
<div class="body">
  <div class="kicker">Everything in the box</div>
  <h1 class="sm">Twelve things it does<br>that you would<br>otherwise do by eye</h1>
  <div style="margin-top:24px;border-top:2px solid ${C.ink}">
    ${items.map((it, i) => `<div style="display:flex;align-items:baseline;padding:9px 0;border-bottom:1px solid ${C.divLt}">
      <div style="font-family:'Barlow Condensed';font-weight:700;font-size:21px;color:${C.red};width:42px;flex:none">${String(i + 1).padStart(2, '0')}</div>
      <div style="font-family:'Barlow Condensed';font-weight:700;font-size:32px;text-transform:uppercase;letter-spacing:.03em;width:318px;flex:none;line-height:1">${it[0]}</div>
      <div style="font-size:22px;color:${C.soft};line-height:1.26">${it[1]}</div>
    </div>`).join('')}
  </div>
  <div class="grow"></div>
  <div style="padding:22px 0 12px;border-top:2px solid ${C.ink};margin-top:16px">
    <div style="font-family:'Barlow Condensed';font-weight:700;font-size:60px;text-transform:uppercase;line-height:1;letter-spacing:.02em">
      Built for the<br><span style="color:${C.red}">RDM GPS lap timer</span></div>
  </div>
</div>
${K.foot('Windows · macOS · Linux', 'The same analysis engine the device runs, on a screen big enough to read it.', 'RDM Studio')}
`, { title: 'Closer' });
});

module.exports = { POSTS };
