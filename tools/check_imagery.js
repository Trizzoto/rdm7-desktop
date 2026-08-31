/* Which aerial imagery a circuit gets, and — more to the point — which it
 * must NOT get.
 *
 * Esri's worldwide layer has nothing above zoom 18: it answers z19 and z20
 * with an identical 2,521-byte placeholder that Leaflet upscales, so the top
 * of the zoom range was invented detail. Several Australian states publish
 * their aerial photography free, several zoom levels deeper, and the app
 * picks one by where the car actually was.
 *
 * The regional layers are now drawn ON TOP of the worldwide one rather than
 * instead of it, so a shape that is slightly wrong costs sharpness and no
 * longer leaves a grey hole. That makes the shapes advisory — but only for
 * holes. Getting them wrong still means the wrong photograph and a picker
 * that offers the wrong menu, and a bounding box round NSW still swallows
 * Winton, Calder and Phillip Island. That shipped, briefly, and this harness
 * is why it did not stay shipped.
 *
 * Every coordinate below is a real start/finish line out of his own track
 * library, or a real river town, not a made-up point.
 *
 *   node tools/check_imagery.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const REL = 'src/tauri-overlay.html';

function grabFn(src, name) {
    const re = new RegExp('^        function ' + name + '\\s*\\(', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: function ' + name);
    let i = src.indexOf('{', m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j);
}

/* var NAME = <one line>;  — the two stand-down constants. */
function grabScalar(src, name) {
    const re = new RegExp('^        var ' + name + ' = ([^;]+);', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    return 'var ' + name + ' = ' + m[1] + ';';
}

/* var NAME = { … };  or  var NAME = [ … ];  — brace/bracket matched, because a
   regex that stops at the first semicolon stops inside the first URL. The
   tables are built with .concat() of the shared border lists, so the capture
   runs to the last closing bracket at column 8, not to the first one. */
function grabVar(src, name) {
    const re = new RegExp('^        var ' + name + ' = ([\\[{])', 'm');
    const m = re.exec(src);
    if (!m) throw new Error('not found: var ' + name);
    const open = m[1], close = open === '[' ? ']' : '}';
    let i = src.indexOf(open, m.index), depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === open) depth++;
        else if (src[j] === close) { depth--; if (depth === 0) { j++; break; } }
    }
    return src.slice(m.index, j) + ';';
}

const src = fs.readFileSync(path.join(ROOT, REL), 'utf8');
const parts = [];
const missing = [];
for (const v of ['GP_WORLD_IMAGERY', 'GP_MURRAY', 'GP_QLD_NSW', 'GP_IMAGERY']) {
    try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); }
}
for (const v of ['GP_STAND_DOWN_MS', 'GP_STAND_DOWN_DEG']) {
    try { parts.push(grabScalar(src, v)); } catch (e) { missing.push(v); }
}
for (const f of ['gpBorder', 'gpMurray', 'gpPointInPoly', 'gpImageryCovering',
                 'gpImageryAllowed', 'gpImageryFor']) {
    try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); }
}
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

/* gpImageryFor reads gp.groundPick and gp.groundOptIn — the app's state. A
   stub stands in for it so the harness can drive both: the automatic answer,
   and what happens when someone picks a source by hand. */
const F = new Function(`
    var gp = { groundPick: 'auto', groundOptIn: [] };
    ${parts.join('\n')}
    return { gp: gp, pick: gpImageryFor, covering: gpImageryCovering,
             allowed: gpImageryAllowed, sources: GP_IMAGERY, world: GP_WORLD_IMAGERY };
`)();

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}
/* null is a real answer: "nothing sharper than the worldwide layer here". */
function picks(lat, lon) { const s = F.pick(lat, lon); return s ? s.id : 'world'; }
function reset() { F.gp.groundPick = 'auto'; F.gp.groundOptIn = []; F.sources.forEach(s => { s.stoodDown = null; }); }

/* start/finish lines, straight out of rdm7_tracks_v1 */
const TRACKS = [
    ['Mallala',                 -34.41525535884985, 138.50592881441116, 'sa'],
    ['The Bend GT',             -35.3083111,        139.5111319,        'sa'],
    ['Mount Barker Raceway',    -35.0921861,        138.8391235,        'sa'],
    ['Barker Test 2',           -35.08643136673211, 138.87006830009844, 'sa'],
    ['SMP Gardner GP',          -33.8033537,        150.8676736,        'nsw'],
    ['Mount Panorama',          -33.43927,          149.5582409,        'nsw'],
    ['Sonoma',                   38.1615417,       -122.454681,         'world'],
];

console.log('every circuit in his library gets the right imagery');
TRACKS.forEach(function (t) {
    ok(t[0] + ' -> ' + t[3], picks(t[1], t[2]) === t[3], 'got ' + picks(t[1], t[2]));
});

/* Victoria's only published aerial service charges a fee, so it ships off.
   Both halves of that matter and both are checked: the shape must claim the
   Victorian circuits, and the picker must not USE it until someone opts in. */
console.log('\nVictoria is covered but costs money, so it is off until it is turned on');
const VIC_TRACKS = [
    ['Winton',        -36.5208278, 146.0888952],
    ['Calder Park',   -37.670406,  144.753568],
    ['Phillip Island', -38.5026545, 145.2321311],
    ['Sandown',       -37.9483,    145.1650],
];
VIC_TRACKS.forEach(function (t) {
    ok(t[0] + ' is inside the Victorian shape',
       F.covering(t[1], t[2]).some(s => s.id === 'vic'));
    ok(t[0] + ' draws the worldwide layer until then', picks(t[1], t[2]) === 'world',
       'got ' + picks(t[1], t[2]));
});
ok('the Victorian source states its licence', (function () {
    const v = F.sources.filter(s => s.id === 'vic')[0];
    return v && typeof v.licence === 'string' && /licence|fee/i.test(v.licence) &&
           typeof v.licenceLong === 'string' && v.licenceLong.length > 80;
})());
F.gp.groundOptIn = ['vic'];
ok('opted in, Winton gets Vicmap', picks(-36.5208278, 146.0888952) === 'vic',
   'got ' + picks(-36.5208278, 146.0888952));
ok('…and Mallala still does not', picks(-34.41525535884985, 138.50592881441116) === 'sa');
reset();

console.log('\nQueensland, which is free, needs no opting in');
[['Queensland Raceway', -27.6905, 152.6558],
 ['Lakeside Park',      -27.2200, 152.9640],
 ['Morgan Park',        -28.2340, 152.0490],
 ['Mount Cotton',       -27.6270, 153.2200]].forEach(function (t) {
    ok(t[0] + ' -> qld', picks(t[1], t[2]) === 'qld', 'got ' + picks(t[1], t[2]));
});

console.log('\nthe Murray, which is the whole reason NSW is a polygon');
/* A box round NSW reaches to about -37.5 at every longitude, so each of these
   Victorian points sits inside the box and outside the state. */
[['Winton', -36.5208278, 146.0888952],
 ['Calder Park', -37.670406, 144.753568],
 ['Phillip Island', -38.5026545, 145.2321311],
 ['Echuca, on the river', -36.1333, 144.7500],
 ['Mildura, on the river', -34.1855, 142.1625],
 ['Wodonga, on the river', -36.1214, 146.8881]].forEach(function (p) {
    ok(p[0] + ' is not in NSW', picks(p[1], p[2]) !== 'nsw', 'got ' + picks(p[1], p[2]));
    ok(p[0] + ' IS in Victoria', F.covering(p[1], p[2]).some(s => s.id === 'vic'));
});
/* …while the NSW side of the same river still is. */
[['Albury', -36.0737, 146.9135],
 ['Moama', -36.1170, 144.7500],
 ['Buronga', -34.1767, 142.1836],
 ['Deniliquin', -35.5320, 144.9540],
 ['Wagga Wagga', -35.1082, 147.3598]].forEach(function (p) {
    ok(p[0] + ' still is', picks(p[1], p[2]) === 'nsw', 'got ' + picks(p[1], p[2]));
    ok(p[0] + ' is not claimed by Victoria too', !F.covering(p[1], p[2]).some(s => s.id === 'vic'));
});

console.log('\nthe Queensland border, shared with NSW the same way');
[['Goondiwindi, QLD side', -28.5450, 150.3090, 'qld'],
 ['Boggabilla, NSW side',  -28.6030, 150.3560, 'nsw'],
 ['Tweed Heads, NSW',      -28.1830, 153.5450, 'nsw'],
 ['Coolangatta, QLD',      -28.1670, 153.5350, 'qld'],
 ['Tibooburra, far NSW',   -29.4340, 142.0110, 'nsw'],
 ['Birdsville, QLD',       -25.8970, 139.3510, 'qld']].forEach(function (p) {
    ok(p[0] + ' -> ' + p[3], picks(p[1], p[2]) === p[3], 'got ' + picks(p[1], p[2]));
});

console.log('\nno two shapes claim the same ground');
[['Mallala', -34.415, 138.506], ['Bathurst', -33.439, 149.558],
 ['Winton', -36.521, 146.089], ['Queensland Raceway', -27.691, 152.656],
 ['Broken Hill', -31.960, 141.467], ['Renmark', -34.174, 140.745]].forEach(function (p) {
    const n = F.covering(p[1], p[2]).length;
    ok(p[0] + ' is claimed once', n <= 1, 'claimed by ' + n);
});

console.log('\nSA is a rectangle because its borders really are lines');
ok('129E/141E and 26S bound it', (function () {
    var sa = F.sources.filter(function (s) { return s.id === 'sa'; })[0];
    return sa && sa.bounds[1] < 129.1 && sa.bounds[3] === 141 && sa.bounds[2] > -26.1;
})());
ok('just inside the eastern border is SA', picks(-34.5, 140.95) === 'sa');
ok('just outside it is not', picks(-34.5, 141.05) !== 'sa', 'got ' + picks(-34.5, 141.05));
ok('north of 26S is not SA', picks(-25.5, 135.0) !== 'sa', 'got ' + picks(-25.5, 135.0));

console.log('\nanywhere else in the world falls back');
[['London', 51.5, -0.12], ['Tokyo', 35.68, 139.69], ['Auckland', -36.85, 174.76],
 ['mid-Pacific', -20.0, -150.0], ['Perth', -31.95, 115.86],
 ['Hobart', -42.88, 147.33], ['Darwin', -12.46, 130.84]].forEach(function (p) {
    ok(p[0] + ' -> world', picks(p[1], p[2]) === 'world', 'got ' + picks(p[1], p[2]));
});

console.log('\na source that just failed is stood down here, and only here');
var nsw = F.sources.filter(function (s) { return s.id === 'nsw'; })[0];
var here = function (lat, lon, ageMs) { nsw.stoodDown = { lat: lat, lon: lon, t: Date.now() - (ageMs || 0) }; };
/* NSW has no imagery over Jervis Bay — a Commonwealth territory, not New
   South Wales — so tiles legitimately fail there. The session-wide version of
   this rule meant an afternoon at Jervis Bay cost you Bathurst as well. */
here(-35.14, 150.69);
ok('Jervis Bay drops to the worldwide layer',
   picks(-35.14, 150.69) === 'world', 'got ' + picks(-35.14, 150.69));
here(-35.14, 150.69);
ok('20 km away is still stood down', picks(-35.30, 150.75) === 'world',
   'got ' + picks(-35.30, 150.75));
here(-35.14, 150.69);
ok('Bathurst, 130 km away, is untouched',
   picks(-33.43927, 149.5582409) === 'nsw', 'got ' + picks(-33.43927, 149.5582409));
here(-35.14, 150.69, 11 * 60 * 1000);
ok('and ten minutes later it is tried again here too',
   picks(-35.14, 150.69) === 'nsw', 'got ' + picks(-35.14, 150.69));
ok('…with the flag cleared rather than left to rot', !nsw.stoodDown);
reset();

console.log('\nchoosing a source by hand');
F.gp.groundPick = 'world';
ok('the worldwide layer can be forced at Mallala', picks(-34.415, 138.506) === 'world');
F.gp.groundPick = 'sa';
ok('SA can be asked for where SA reaches', picks(-34.415, 138.506) === 'sa');
ok('…and quietly gives way where it does not', picks(-33.439, 149.558) === 'nsw',
   'got ' + picks(-33.439, 149.558));
F.gp.groundPick = 'vic';
ok('a licensed pick still does nothing until it is opted into',
   picks(-36.521, 146.089) === 'world', 'got ' + picks(-36.521, 146.089));
reset();

console.log('\nnothing is claimed that cannot be delivered');
ok('every regional source is deeper than the worldwide one, or it would not be worth it',
   F.sources.every(function (s) { return s.maxNativeZoom > F.world.maxNativeZoom; }));
ok('every source names who it is from', F.sources.every(function (s) {
    return typeof s.attribution === 'string' && s.attribution.length > 4;
}));
ok('every source is https', F.sources.every(function (s) { return /^https:\/\//.test(s.url); }));
ok('every labels overlay is https and attributed', F.sources.every(function (s) {
    return !s.labels || (/^https:\/\//.test(s.labels.url) && s.labels.attribution &&
                         s.labels.maxNativeZoom > 0);
}));
ok('every source has a short name for the button', F.sources.every(function (s) {
    return typeof s.short === 'string' && s.short.length <= 5;
}));
ok('the shared borders are shared, not copied', (function () {
    const vic = F.sources.filter(s => s.id === 'vic')[0];
    const nswS = F.sources.filter(s => s.id === 'nsw')[0];
    const qld = F.sources.filter(s => s.id === 'qld')[0];
    /* every Murray point appears in both river polygons, and every
       Queensland-border point in both of those */
    const has = (poly, pt) => poly.some(q => q[0] === pt[0] && q[1] === pt[1]);
    return F.gp && [].concat(
        ...[[vic, nswS]].map(([a, b]) => grabPts('GP_MURRAY').map(pt => has(a.poly, pt) && has(b.poly, pt))),
        ...[[qld, nswS]].map(([a, b]) => grabPts('GP_QLD_NSW').map(pt => has(a.poly, pt) && has(b.poly, pt)))
    ).every(Boolean);
})());
function grabPts(name) {
    return new Function(grabVar(src, name) + 'return ' + name + ';')();
}
ok('a nonsense position does not crash it', picks(NaN, NaN) === 'world');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
