/* Run every harness in this folder and fail if any of them does.
 *
 * This exists because check_autotrack.js was DEAD for two commits and nobody
 * knew. A rename in the app (gpReadyHtml -> gpReadyCardHtml) meant it threw
 * on startup, so all 300 of its checks silently stopped running while the
 * file sat there looking like coverage. A test that cannot run is worse than
 * no test, because it is counted.
 *
 * So: no arguments, no config, no discovery rules to get wrong — every
 * check_*.js in this directory is run, and a harness that throws is reported
 * as loudly as a harness that fails an assertion, because at this level they
 * mean the same thing.
 *
 *   node tools/check_all.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const files = fs.readdirSync(DIR)
    .filter(f => /^check_.*\.js$/.test(f) && f !== path.basename(__filename))
    .sort();

if (!files.length) {
    console.error('no check_*.js harnesses found in ' + DIR);
    process.exit(1);
}

let failed = 0;
const rows = [];

for (const f of files) {
    const r = spawnSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8' });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    /* Both shapes the harnesses here use: "N passed, M failed" and
       "passed all N checks" / "FAILED n of m". */
    const last = out.split('\n').filter(Boolean).pop() || '';
    const crashed = r.status !== 0 && !/failed|FAILED/.test(last);
    if (r.status !== 0) failed++;
    rows.push({
        name: f.replace(/\.js$/, ''),
        ok: r.status === 0,
        crashed: crashed,
        summary: crashed ? firstError(out) : last,
    });
}

function firstError(out) {
    const m = out.match(/^\s*(?:[A-Za-z]*Error): .*$/m);
    return m ? m[0].trim() : 'exited non-zero with no summary';
}

const w = Math.max.apply(null, rows.map(r => r.name.length));
console.log('');
rows.forEach(r => {
    console.log('  ' + (r.ok ? 'ok  ' : (r.crashed ? 'DEAD' : 'FAIL')) + '  ' +
                r.name.padEnd(w) + '  ' + r.summary);
});
console.log('');
if (failed) {
    console.log(failed + ' of ' + rows.length + ' harnesses did not pass');
    process.exit(1);
}
console.log('all ' + rows.length + ' harnesses passed');
