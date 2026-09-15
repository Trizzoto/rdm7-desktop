/* Lift the new image-cap helpers out of the BUILT desktop bundle and check the
   arithmetic, rather than trusting that it reads right.

   Pulls the real source text out of src/dist/index.html so this tests what
   ships, not a retyped copy. */
const fs = require('fs');

const html = fs.readFileSync(
    require('path').join(__dirname, '..', 'src', 'dist', 'index.html'), 'utf8');

function lift(re, what) {
    const m = html.match(re);
    if (!m) throw new Error('could not find ' + what + ' in the built bundle');
    return m[0];
}

const src = [
    lift(/const RDM_IMAGE_MAX_LEGACY_BYTES = [^\n]*/, 'legacy const'),
    'let CANVAS_W = 0, CANVAS_H = 0, _deviceImageMaxBytes = 0;',
    lift(/function _imageMaxBytes\(\) \{[\s\S]*?\n        \}/, '_imageMaxBytes'),
    lift(/function _imageBytesFor\([\s\S]*?\n        \}/, '_imageBytesFor'),
    lift(/function _fmtImageSize\(bytes\) \{[\s\S]*?\n        \}/, '_fmtImageSize'),
].join('\n');

const api = new Function(src + `
    return {
        setScreen: (w,h) => { CANVAS_W = w; CANVAS_H = h; },
        setDeviceCap: (n) => { _deviceImageMaxBytes = n; },
        imageMaxBytes: () => _imageMaxBytes(),
        imageBytesFor: (w,h) => _imageBytesFor(w,h),
        fmt: (b) => _fmtImageSize(b),
    };
`)();

/* The dialog's own ceiling maths, copied from openImageResizeDialog. */
function dialog(origW, origH, screenW, screenH) {
    const maxBytes  = api.imageMaxBytes();
    const capPixels = Math.floor((maxBytes - 12) / 3);
    const capPct    = Math.max(5, Math.min(100,
        Math.floor(Math.sqrt(capPixels / (origW * origH)) * 100)));
    const fitPct    = Math.min(100, Math.floor(Math.min(screenW / origW, screenH / origH) * 100));
    return { maxBytes, capPct, capBinds: capPct < 100, startPct: Math.min(fitPct, capPct), fitPct };
}

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
};

console.log('\n-- the cap the editor believes in --');
api.setScreen(1920, 720); api.setDeviceCap(0);
ok('offline 1920x720 sizes to the screen, not 1200 KB',
   api.imageMaxBytes() === 4147212, 'got ' + api.imageMaxBytes());

api.setScreen(800, 480);
ok('offline 800x480 holds the 1200 KB floor',
   api.imageMaxBytes() === 1228800, 'got ' + api.imageMaxBytes());

api.setScreen(1920, 720); api.setDeviceCap(1228800);
ok('a dash that reports the old cap is believed over the formula',
   api.imageMaxBytes() === 1228800, 'got ' + api.imageMaxBytes());

api.setDeviceCap(4147212);
ok('a dash that reports the new cap is believed',
   api.imageMaxBytes() === 4147212, 'got ' + api.imageMaxBytes());

console.log("\n-- the slider ceiling can never ask for a rejected upload --");
api.setScreen(1920, 720); api.setDeviceCap(4147212);
for (const [w, h] of [[1960,800],[3840,1440],[1920,720],[640,480],[1024,410]]) {
    const d = dialog(w, h, 1920, 720);
    const outW = Math.max(1, Math.round(w * d.capPct / 100));
    const outH = Math.max(1, Math.round(h * d.capPct / 100));
    const bytes = api.imageBytesFor(outW, outH);
    ok(`${w}x${h}: ceiling ${d.capPct}% -> ${outW}x${outH} = ${bytes.toLocaleString()} B fits`,
       bytes <= d.maxBytes, `over by ${bytes - d.maxBytes}`);
    /* and one percent higher must NOT fit, or the ceiling is too low */
    if (d.capPct < 100) {
        const uW = Math.max(1, Math.round(w * (d.capPct + 1) / 100));
        const uH = Math.max(1, Math.round(h * (d.capPct + 1) / 100));
        ok(`${w}x${h}: ${d.capPct + 1}% would not fit (ceiling is not too low)`,
           api.imageBytesFor(uW, uH) > d.maxBytes);
    }
}

console.log("\n-- the user's actual picture --");
api.setScreen(1920, 720); api.setDeviceCap(4147212);
const d = dialog(1960, 800, 1920, 720);
console.log(`  cluster - map.jpg 1960x800: cap ${api.fmt(d.maxBytes)}, `
          + `slider stops at ${d.capPct}%, opens at ${d.startPct}% (fit)`);
ok('the cap binds, so the dialog explains itself', d.capBinds === true);
ok('it opens at fit-to-screen, 90%', d.startPct === 90, 'got ' + d.startPct);

console.log('\n-- wording --');
ok('4147212 B reads as 4.0 MB', api.fmt(4147212) === '4.0 MB', api.fmt(4147212));
ok('1228800 B reads as 1.2 MB', api.fmt(1228800) === '1.2 MB', api.fmt(1228800));
ok('a small image still reads in KB', api.fmt(300 * 1024) === '300 KB', api.fmt(300 * 1024));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
