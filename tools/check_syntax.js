/* Does the thing we actually ship parse?
 *
 * Every other harness lifts NAMED FUNCTIONS out of the overlay and runs them
 * in isolation, which is what makes them fast and precise — and also means a
 * broken string literal BETWEEN two functions passes all of them. That is not
 * hypothetical: a `\n` eaten by a shell heredoc turned
 *
 *     gpConfirm("Delete ...?\n\n" + what + ...)
 *
 * into an unterminated string. Twelve harnesses passed, the merge reported OK,
 * and the app booted to a blank workspace because the whole IIFE failed to
 * parse — `typeof window._gpOpen === "undefined"` was the only symptom.
 *
 * So: parse the built file, the same one Tauri embeds. No execution — there is
 * no DOM here and running it is not the question. Just "is this JavaScript".
 *
 *   node tools/check_syntax.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
/* The BUILT file: src/dist/index.html is what frontendDist points at and what
   the release binary embeds. Checking the overlay alone would miss anything
   the merge itself mangles. */
const TARGETS = ['src/dist/index.html', 'src/tauri-overlay.html'];

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
};

/* Where a character offset lands, in the terms an editor uses. A syntax error
   reported as "character 1841203" is not actionable. */
function whereIs(src, idx) {
    const upto = src.slice(0, idx);
    const line = upto.split('\n').length;
    const col = idx - upto.lastIndexOf('\n');
    return { line: line, col: col };
}

for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        /* dist is gitignored and only exists after a merge. Say so rather than
           passing quietly — "no dist" and "dist is fine" are different. */
        console.log('\n' + rel + ' — not built, skipped (run tools/merge_overlay.py)');
        continue;
    }
    const html = fs.readFileSync(file, 'utf8');
    console.log('\n' + rel + ' (' + (html.length / 1e6).toFixed(1) + ' MB)');

    /* Inline scripts only. A src= tag is another file's problem, and a
       type= that is not JavaScript (importmap, template) is not ours to
       parse. */
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, n = 0, checked = 0;
    while ((m = re.exec(html))) {
        n++;
        const attrs = m[1] || '', code = m[2];
        if (/\bsrc\s*=/.test(attrs)) continue;
        const ty = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
        if (ty && !/^(text\/javascript|application\/javascript|module)$/i.test(ty[1])) continue;
        if (!code.trim()) continue;
        checked++;
        const at = m.index + m[0].indexOf(code);
        let err = null;
        try {
            /* A module body is only valid under the module goal, and `new
               vm.Script` is script-goal — wrap it so an `import` at top level
               is not reported as a syntax error it is not. */
            const isModule = ty && /^module$/i.test(ty[1]);
            new vm.Script(isModule ? '(async function(){' + code + '\n})' : code,
                          { filename: rel + ' #' + n });
        } catch (e) {
            err = e;
        }
        if (err) {
            /* v8 gives the line within the snippet; translate to the file. */
            const lm = /#\d+:(\d+)/.exec(String(err.stack || '')) ||
                       /:(\d+)$/.exec(String(err.stack || '').split('\n')[0] || '');
            const snipLine = lm ? Number(lm[1]) : 1;
            const base = whereIs(html, at).line;
            ok(rel + ' script #' + n + ' parses', false,
               err.message + '\n        around ' + rel + ':' + (base + snipLine - 1));
        } else {
            ok(rel + ' script #' + n + ' parses (' +
               (code.length > 20000 ? (code.length / 1000).toFixed(0) + ' kB' : code.length + ' B') + ')',
               true);
        }
    }
    ok(rel + ' has inline script to check', checked > 0,
       n + ' script tags, ' + checked + ' inline');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
