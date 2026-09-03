/* Render the posts to 1080x1350 PNGs with headless Chrome.
 *
 *   node tools/hype/build.js            all of them
 *   node tools/hype/build.js 07 11      just those
 */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const K = require('./kit.js');
const D = require('./data/posters.json');

const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(p => fs.existsSync(p));
if (!CHROME) throw new Error('no Chrome or Edge to render with');

const HTML = path.join(__dirname, 'out');
const PNG = path.join(__dirname, '..', '..', 'marketing', 'instagram');
fs.mkdirSync(HTML, { recursive: true });
fs.mkdirSync(PNG, { recursive: true });

const want = process.argv.slice(2);
const posts = require('./posts.js').POSTS
    .concat(require('./posts2.js').POSTS)
    .filter(p => !want.length || want.some(w => p.id.indexOf(w) === 0));

let n = 0;
for (const p of posts) {
    const html = p.fn(D);
    const hf = path.join(HTML, p.id + '.html');
    fs.writeFileSync(hf, html);
    const out = path.join(PNG, 'rdm-' + p.id + '.png');
    try { fs.unlinkSync(out); } catch (e) { }
    cp.execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=1', '--default-background-color=00000000',
        '--window-size=' + K.W + ',' + K.H,
        '--screenshot=' + out, 'file:///' + hf.replace(/\\/g, '/')],
        { stdio: 'pipe', timeout: 60000 });
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log('  ' + p.id.padEnd(18), String(kb).padStart(5) + ' kB   ' + p.title);
    n++;
}
console.log(n + ' posters -> marketing/instagram/');
