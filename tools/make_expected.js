/* Write, or re-write, a golden recording's answer sheet (ADR-0050).
 *
 *   node tools/make_expected.js                 print every fixture's answers
 *   node tools/make_expected.js <name>          print one
 *   node tools/make_expected.js <name> --bless  write it
 *
 * It PRINTS by default and never runs on its own. The entire value of an
 * answer sheet is that a person looked at these numbers once and said yes; a
 * sheet that regenerates itself on demand is not a test, it is a tautology
 * with a JSON file attached.
 *
 * Re-blessing is a normal event — an intended engine improvement moves these
 * numbers — so --bless on an existing sheet prints a field-by-field diff first
 * and refuses to overwrite silently. It should read like a decision in the
 * commit log, because that is what it is.
 */
const fs = require('fs');
const path = require('path');
const G = require('./golden_lib.js');
const { FIXTURES } = G;

const MANIFEST = path.join(FIXTURES, 'fixtures.json');
if (!fs.existsSync(MANIFEST)) {
    console.log('no fixtures manifest at ' + MANIFEST);
    process.exit(1);
}
const specs = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).fixtures;

const argv = process.argv.slice(2);
const bless = argv.indexOf('--bless') >= 0;
const only = argv.filter(a => a.indexOf('--') !== 0)[0] || null;

/* Walk two objects together and report every leaf that moved. A count of
   differences is useless here — which field moved is the whole message. */
function diff(a, b, at, out) {
    at = at || ''; out = out || [];
    const keys = Object.keys(Object.assign({}, a || {}, b || {}));
    keys.forEach(function (k) {
        const p = at ? at + '.' + k : k;
        const x = a ? a[k] : undefined, y = b ? b[k] : undefined;
        if (Array.isArray(x) || Array.isArray(y)) {
            if (JSON.stringify(x) !== JSON.stringify(y))
                out.push({ at: p, was: brief(x), now: brief(y) });
        } else if (x && typeof x === 'object' || y && typeof y === 'object') {
            diff(x, y, p, out);
        } else if (x !== y) {
            out.push({ at: p, was: x, now: y });
        }
    });
    return out;
}
function brief(v) {
    const s = JSON.stringify(v);
    return s === undefined ? 'undefined' : s.length > 70 ? s.slice(0, 67) + '…]' : s;
}

let any = false;
specs.forEach(function (spec) {
    if (only && spec.name !== only) return;
    any = true;
    const sheetPath = path.join(FIXTURES, spec.name + '.expected.json');
    process.stdout.write('\n' + spec.name + '  (' + spec.file + ')\n');

    const got = G.analyse(spec);
    if (!got) {
        console.log('  fixture file is not here — nothing to do');
        return;
    }
    const sheet = {
        recording: spec.name,
        file: spec.file,
        kind: spec.kind,
        note: spec.note || '',
        blessedOn: new Date().toISOString().slice(0, 10),
        answers: got
    };

    const had = fs.existsSync(sheetPath)
        ? JSON.parse(fs.readFileSync(sheetPath, 'utf8')) : null;

    if (!had) {
        console.log(JSON.stringify(got, null, 2).split('\n').map(l => '  ' + l).join('\n'));
        if (bless) {
            fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2) + '\n', 'utf8');
            console.log('\n  written: ' + path.basename(sheetPath));
        } else {
            console.log('\n  (not written — pass --bless once you have read the numbers)');
        }
        return;
    }

    const d = diff(had.answers, got);
    if (!d.length) {
        console.log('  unchanged — the sheet still describes this recording');
        return;
    }
    console.log('  ' + d.length + ' field(s) moved since ' + (had.blessedOn || 'the last blessing') + ':');
    d.forEach(function (e) {
        console.log('    ' + e.at + '\n      was: ' + e.was + '\n      now: ' + e.now);
    });
    if (!bless) {
        console.log('\n  (not written — re-run with --bless if this change is intended)');
        return;
    }
    sheet.blessedOn = new Date().toISOString().slice(0, 10);
    sheet.supersedes = had.blessedOn || null;
    fs.writeFileSync(sheetPath, JSON.stringify(sheet, null, 2) + '\n', 'utf8');
    console.log('\n  re-blessed: ' + path.basename(sheetPath) +
                '  — say in the commit message WHY these numbers moved.');
});

if (!any) {
    console.log('no fixture called "' + only + '". Known: ' +
                specs.map(s => s.name).join(', '));
    process.exit(1);
}
