/* The MP4 the fast export writes, and the MP4 reader that has to read a
 * camera's file well enough to feed a decoder.
 *
 * These two are the only parts of the export that can produce a file which
 * looks fine — right size, right name, downloads happily — and then does not
 * play. Everything else fails loudly. A sample table with offsets one chunk
 * out, an stts that lost a run, an stss that is 0-based where the format says
 * 1-based: each of those is a silent corruption, and each is a one-character
 * mistake.
 *
 * So they are checked against each other. The muxer writes a file, the
 * demuxer reads it back, and every number has to survive the trip. That is a
 * real test rather than a tautology because the two were written from the
 * spec independently: the writer builds boxes, the reader walks them, and
 * neither shares a line of code with the other.
 *
 * The browser side proves the other half — that a real player accepts what
 * comes out, and that a real camera file goes in — and cannot be done here,
 * because node has no WebCodecs and no <video>. Done there, recorded here:
 * a 1080×1920 31.2 s file with AAC sound demuxed to 934 video and 1462 audio
 * samples, exported, and the result decoded back at 31.189 s with its sound
 * intact.
 *
 *   node tools/check_export.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.RDM_ROOT || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'src/tauri-overlay.html'), 'utf8');

function grabFn(s, name) {
    const re = new RegExp('^        (?:function ' + name + '\\s*\\(|window\\.' + name + ' = function)', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: ' + name);
    let i = s.indexOf('{', m.index), depth = 0, j = i;
    for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return s.slice(m.index, j).replace(/^\s*window\.(\w+) = function/, 'function $1');
}
/* `var X = <anything>;` including a function expression, whose body is full
   of semicolons — so the end is found by matching braces when there are any,
   and by the first semicolon when there are not. */
function grabVar(s, name) {
    const re = new RegExp('^        var ' + name + ' = ', 'm');
    const m = re.exec(s);
    if (!m) throw new Error('not found: var ' + name);
    const from = m.index + m[0].length;
    const semi = s.indexOf(';', from);
    const brace = s.indexOf('{', from);
    if (brace < 0 || brace > semi) return s.slice(m.index, semi + 1).trim();
    let depth = 0, j = brace;
    for (; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } }
    }
    return s.slice(m.index, s.indexOf(';', j) + 1).trim();
}

const FNS = ['gpBoxes', 'gpTrackSamples', 'gpFindMoov', 'gpMp4Demux', 'gpAvcCodec', 'gpTkhdRotation',
             'gpBox', 'gpU32', 'gpU16', 'gpBytes', 'gpStts', 'gpTrakBox', 'gpAvc1Entry',
             'gpMp4Build', 'gpFmp4Defaults', 'gpWindowReader', 'gpFmp4Scan', 'gpMoofTraf',
             'gpHevcCodec', 'gpCopyAudio',
              'gpAudioEntryIso', 'gpFindEsds'];
const parts = [], missing = [];
for (const v of ['GP_T', 'GP_MATRIX']) { try { parts.push(grabVar(src, v)); } catch (e) { missing.push(v); } }
for (const f of FNS) { try { parts.push(grabFn(src, f)); } catch (e) { missing.push(f); } }
if (missing.length) {
    console.log('cannot run — not in this revision: ' + missing.join(', '));
    process.exit(1);
}

/* Blob is only used to hand the bytes back, so a stand-in that keeps them
   where a test can get at them is all that is needed. */
class FakeBlob {
    constructor(parts, opt) {
        const bufs = parts.map(p => Buffer.from(p.buffer ? p.buffer.slice(p.byteOffset, p.byteOffset + p.length) : p));
        this.bytes = Buffer.concat(bufs);
        this.size = this.bytes.length;
        this.type = (opt && opt.type) || '';
    }
}
const F = new Function('Blob', `
    ${parts.join('\n')}
    return { build: gpMp4Build, demux: gpMp4Demux, avc1: gpAvc1Entry, codec: gpAvcCodec,
             stts: gpStts, box: gpBox, boxes: gpBoxes, T: GP_T,
             u32: gpU32, u16: gpU16, bytes: gpBytes, hevc: gpHevcCodec,
             copyAudio: gpCopyAudio, isoEntry: gpAudioEntryIso, findEsds: gpFindEsds };
`)(FakeBlob);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '  -- ' + detail : '')); }
}

/* A stand-in avcC. Only its first four bytes are ever read (to build the
   codec string), and only its length matters to the muxer. */
const AVCC = new Uint8Array([1, 0x64, 0x00, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);

function makeTrack(n, opt) {
    opt = opt || {};
    const chunks = [], durs = [], sync = [];
    for (let i = 0; i < n; i++) {
        /* Sizes deliberately uneven: a uniform size would hide an offset bug,
           because every wrong offset would still land on a sample boundary. */
        const len = 900 + (i * 37) % 2100;
        const b = new Uint8Array(len);
        for (let k = 0; k < len; k += 97) b[k] = (i + k) & 255;
        b[0] = i & 255; b[1] = (i >> 8) & 255;      /* a mark to find it by */
        chunks.push(b);
        durs.push(opt.vfr ? (3000 + (i % 3) * 10) : 3000);
        if (i % 30 === 0) sync.push(i);
    }
    return {
        id: 1, video: true, timescale: 90000, width: 1920, height: 1080,
        chunks, durs, sync,
        durTicks: durs.reduce((a, b) => a + b, 0),
        entry: F.avc1(1920, 1080, AVCC)
    };
}

function reader(blob) {
    return {
        size: blob.size,
        read: (o, l) => Promise.resolve(
            blob.bytes.buffer.slice(blob.bytes.byteOffset + o, blob.bytes.byteOffset + o + l))
    };
}

(async function () {
    console.log('what the muxer writes, the reader reads back');
    {
        const t = makeTrack(90);
        const blob = F.build(t, null);
        ok('it produced an mp4', blob.size > 0 && blob.type === 'video/mp4');
        ok('it starts with ftyp', blob.bytes.slice(4, 8).toString('latin1') === 'ftyp');
        const mp4 = await F.demux(reader(blob));
        ok('the reader finds a video track', !!(mp4 && mp4.video));
        const tab = mp4.video.tab;
        ok('every sample came back', tab.n === 90, 'got ' + tab.n);
        ok('the timescale survived', mp4.video.timescale === 90000, 'got ' + mp4.video.timescale);
        ok('the avcC survived', mp4.video.avcC && mp4.video.avcC.length === AVCC.length);
        ok('the codec string is built from the avcC, not guessed',
           F.codec(mp4.video.avcC) === 'avc1.640028', F.codec(mp4.video.avcC));
        /* The frame size, read out of the VisualSampleEntry — the DECODER is
           configured with these. Left unset, Chromium answered a 1216×1616
           HEVC file with displayWidth 1280×720 and drawImage sampled that
           imaginary rectangle: every HEVC export came out a smeared ruin
           while the demux, the codec string and the muxed file all looked
           perfectly healthy. The person watching had to say "watch the
           video" before anyone did. */
        ok('the frame size is read from the sample entry',
           mp4.video.w === 1920 && mp4.video.h === 1080,
           mp4.video.w + '×' + mp4.video.h);

        let sizesOk = true, bytesOk = true, timesOk = true;
        for (let i = 0; i < 90; i++) {
            if (tab.sizes[i] !== t.chunks[i].length) sizesOk = false;
            /* The mark at the head of each sample must be found at the offset
               the table gives — which is the whole point of the table. */
            const at = blob.bytes[tab.offsets[i]] | (blob.bytes[tab.offsets[i] + 1] << 8);
            if (at !== i) bytesOk = false;
            if (Math.round(tab.dts[i]) !== i * 3000) timesOk = false;
        }
        ok('every sample size came back', sizesOk);
        ok('every sample is found where the table says it is', bytesOk);
        ok('every decode time came back', timesOk);
        const syncs = [];
        for (let i = 0; i < tab.n; i++) if (tab.sync[i]) syncs.push(i);
        ok('the sync samples came back, 1-based in the file and 0-based out',
           JSON.stringify(syncs) === JSON.stringify(t.sync), JSON.stringify(syncs));
        ok('the duration came back', Math.round(tab.dur) === 90 * 3000, 'got ' + tab.dur);
    }

    console.log('\na variable frame rate is not flattened');
    {
        const t = makeTrack(60, { vfr: true });
        const mp4 = await F.demux(reader(F.build(t, null)));
        let same = true;
        for (let i = 1; i < 60; i++)
            if (Math.round(mp4.video.tab.dts[i] - mp4.video.tab.dts[i - 1]) !== Math.round(t.durs[i - 1])) same = false;
        ok('every frame kept its own duration', same);
    }

    console.log('\nthe run-length table is a run-length table');
    {
        const flat = F.stts(new Array(300).fill(3000));
        /* version+flags, count, then one (count, delta) pair per run */
        const dv = new DataView(flat.buffer, flat.byteOffset, flat.length);
        ok('300 identical frames collapse to one entry', dv.getUint32(12) === 1, 'entries ' + dv.getUint32(12));
        ok('…and the box is 24 bytes rather than 2 408', flat.length === 24, flat.length + ' bytes');
        const mixed = F.stts([3000, 3000, 3010, 3000]);
        const dv2 = new DataView(mixed.buffer, mixed.byteOffset, mixed.length);
        ok('a change starts a new run', dv2.getUint32(12) === 3, 'entries ' + dv2.getUint32(12));
    }

    console.log('\nsound rides along without being touched');
    {
        const v = makeTrack(60);
        const aChunks = [], aDurs = [];
        for (let i = 0; i < 100; i++) {
            const b = new Uint8Array(300 + (i % 7) * 11);
            b[0] = i & 255; b[1] = 0xAA;
            aChunks.push(b); aDurs.push(1024);
        }
        /* A camera's own mp4a entry is copied across verbatim; here a stand-in
           of the right shape stands for it. */
        const entry = F.box('mp4a', [new Uint8Array(28)]);
        const a = { id: 2, video: false, timescale: 48000, chunks: aChunks, durs: aDurs,
                    sync: null, entry, durTicks: 100 * 1024 };
        const blob = F.build(v, a);
        const mp4 = await F.demux(reader(blob));
        ok('both tracks are in the file', !!(mp4.video && mp4.audio));
        ok('the sound track kept its own timescale', mp4.audio.timescale === 48000);
        ok('every audio sample came back', mp4.audio.tab.n === 100, 'got ' + mp4.audio.tab.n);
        let bytesOk = true, sizesOk = true;
        for (let i = 0; i < 100; i++) {
            if (mp4.audio.tab.sizes[i] !== aChunks[i].length) sizesOk = false;
            const at = blob.bytes[mp4.audio.tab.offsets[i]];
            if (at !== (i & 255) || blob.bytes[mp4.audio.tab.offsets[i] + 1] !== 0xAA) bytesOk = false;
        }
        ok('every audio sample size came back', sizesOk);
        ok('every audio sample is where the table says', bytesOk);
        ok('the sample entry is the one that was handed in',
           mp4.audio.entry && String.fromCharCode(
               (mp4.audio.entry.type >> 24) & 255, (mp4.audio.entry.type >> 16) & 255,
               (mp4.audio.entry.type >> 8) & 255, mp4.audio.entry.type & 255) === 'mp4a');
        /* The two tracks share one mdat. If the audio offsets were computed
           before the video was placed, they would overlap it. */
        let overlap = false;
        const vEnd = mp4.video.tab.offsets[mp4.video.tab.n - 1] + mp4.video.tab.sizes[mp4.video.tab.n - 1];
        for (let i = 0; i < 100; i++) if (mp4.audio.tab.offsets[i] < vEnd) overlap = true;
        ok('the sound does not sit on top of the picture', !overlap);
    }

    /* ── fragmented MP4 ───────────────────────────────────────────────────
       A file being written cannot have a sample table, so anything recorded
       live is a run of moof/mdat pairs instead — every MediaRecorder file,
       plenty of cameras. The table has to be rebuilt out of the fragments,
       and the fragments are built here from the spec rather than from the
       reader's own idea of them. */
    console.log('\nfragmented files: the table is rebuilt out of the moofs');
    function fmp4(opt) {
        opt = opt || {};
        const u32 = F.u32, box = F.box;
        const TS = 30000, DEF_DUR = 1000;
        const avcC = AVCC;
        const stbl = box('stbl', [
            box('stsd', [u32(0), u32(1), F.avc1(1920, 1080, avcC)]),
            box('stts', [u32(0), u32(0)]),          /* empty — that is the point */
            box('stsc', [u32(0), u32(0)]),
            box('stsz', [u32(0), u32(0), u32(0)]),
            box('stco', [u32(0), u32(0)])
        ]);
        const trak = box('trak', [
            box('tkhd', [u32(0), u32(0), u32(0), u32(1), u32(0), u32(0), u32(0), u32(0),
                         new Uint8Array(8), new Uint8Array(36), u32(0), u32(0)]),
            box('mdia', [
                box('mdhd', [u32(0), u32(0), u32(0), u32(TS), u32(0), u32(0)]),
                box('hdlr', [u32(0), u32(0), new Uint8Array([0x76, 0x69, 0x64, 0x65]),
                             u32(0), u32(0), u32(0), new Uint8Array([0])]),
                box('minf', [stbl])
            ])
        ]);
        /* trex: everything a fragment may leave unsaid. Non-sync by default,
           so only samples that say otherwise are seekable. */
        const trex = box('trex', [u32(0), u32(1), u32(1), u32(DEF_DUR), u32(0), u32(0x01010000)]);
        const moov = box('moov', [trak, box('mvex', [trex])]);
        const ftyp = box('ftyp', [new Uint8Array(8)]);

        /* two fragments, three samples then two */
        const runs = [[3, 0], [2, 3 * DEF_DUR]];
        const pieces = [ftyp, moov];
        let at = ftyp.length + moov.length;
        const expect = [];
        let sample = 0;
        runs.forEach(([count, baseDts]) => {
            const sizes = [];
            for (let i = 0; i < count; i++) sizes.push(700 + (sample + i) * 53);
            /* trun, built twice over: once to learn how long the moof is (the
               data offset is relative to it), once for real. */
            const mk = dataOff => {
                const trunParts = [u32(0x00000205), u32(count), u32(dataOff), u32(0x02000000)];
                sizes.forEach(sz => trunParts.push(u32(sz)));
                const trun = box('trun', trunParts);
                const tfhd = box('tfhd', [u32(0x00020000), u32(1)]);   /* default-base-is-moof */
                const tfdt = box('tfdt', [u32(0), u32(baseDts)]);
                return box('moof', [box('mfhd', [u32(0), u32(1)]),
                                    box('traf', [tfhd, tfdt, trun])]);
            };
            const probe = mk(0);
            const moof = mk(probe.length + 8);        /* +8 = the mdat header */
            const payload = new Uint8Array(sizes.reduce((a, b) => a + b, 0));
            let o = 0;
            sizes.forEach((sz, i) => {
                payload[o] = (sample + i) & 255; payload[o + 1] = 0x5A;
                expect.push({ dts: baseDts + i * DEF_DUR, size: sz,
                              off: at + moof.length + 8 + o, sync: i === 0 ? 1 : 0 });
                o += sz;
            });
            const mdatHdr = new Uint8Array(8);
            new DataView(mdatHdr.buffer).setUint32(0, payload.length + 8);
            mdatHdr.set([0x6d, 0x64, 0x61, 0x74], 4);
            pieces.push(moof, mdatHdr, payload);
            at += moof.length + 8 + payload.length;
            sample += count;
        });
        return { blob: new FakeBlob(pieces, { type: 'video/mp4' }), expect, TS, DEF_DUR };
    }
    {
        const f = fmp4();
        const mp4 = await F.demux(reader(f.blob));
        ok('a fragmented file is read, not refused', !!(mp4 && mp4.video));
        const tab = mp4.video.tab;
        ok('every sample across every fragment is found', tab.n === 5, 'got ' + tab.n);
        ok('the timescale comes from the moov', mp4.video.timescale === f.TS);
        ok('the avcC comes from the moov too', !!mp4.video.avcC);
        let dtsOk = true, sizeOk = true, byteOk = true, syncOk = true;
        f.expect.forEach((e, i) => {
            if (Math.round(tab.dts[i]) !== e.dts) dtsOk = false;
            if (tab.sizes[i] !== e.size) sizeOk = false;
            if (tab.sync[i] !== e.sync) syncOk = false;
            if (f.blob.bytes[tab.offsets[i]] !== (i & 255) ||
                f.blob.bytes[tab.offsets[i] + 1] !== 0x5A) byteOk = false;
        });
        ok('decode times run on across the fragment boundary', dtsOk,
           [...tab.dts].map(Math.round).join(','));
        ok('every sample size came from its trun', sizeOk);
        ok('every sample is found where the trun said', byteOk,
           [...tab.offsets].join(','));
        ok('only the first sample of each fragment is a sync sample', syncOk,
           [...tab.sync].join(','));
        ok('the track duration is the sum of the fragments',
           Math.round(tab.dur) === 5 * f.DEF_DUR, 'got ' + tab.dur);
        /* The last frame's duration is what a whole-file export hangs on: an
           average put a 16 s clip out at 17 s. */
        ok('what is left after the last sample is one sample long',
           Math.round(tab.dur - tab.dts[tab.n - 1]) === f.DEF_DUR);
    }

    console.log('\nfiles the fast path must refuse rather than mangle');
    {
        /* mvex, so the tables in the moov are empty by design — and then no
           fragments at all. There is nothing to rebuild from, and an empty
           table must read as "cannot do this one", not as a zero-length
           video. */
        const u32 = F.u32;
        const stbl = F.box('stbl', [
            F.box('stsd', [u32(0), u32(1), F.avc1(1920, 1080, AVCC)]),
            F.box('stts', [u32(0), u32(0)]), F.box('stsc', [u32(0), u32(0)]),
            F.box('stsz', [u32(0), u32(0), u32(0)]), F.box('stco', [u32(0), u32(0)])
        ]);
        const trak = F.box('trak', [
            F.box('tkhd', [u32(0), u32(0), u32(0), u32(1), u32(0), u32(0), u32(0), u32(0),
                           new Uint8Array(8), new Uint8Array(36), u32(0), u32(0)]),
            F.box('mdia', [
                F.box('mdhd', [u32(0), u32(0), u32(0), u32(30000), u32(0), u32(0)]),
                F.box('hdlr', [u32(0), u32(0), new Uint8Array([0x76, 0x69, 0x64, 0x65]),
                               u32(0), u32(0), u32(0), new Uint8Array([0])]),
                F.box('minf', [stbl])
            ])
        ]);
        const moov = F.box('moov', [trak, F.box('mvex', [F.box('trex', [
            u32(0), u32(1), u32(1), u32(1000), u32(0), u32(0)])])]);
        const blob = new FakeBlob([F.box('ftyp', [new Uint8Array(8)]), moov], {});
        ok('a fragmented file with no fragments in it is refused',
           (await F.demux(reader(blob))) === null);
    }
    {
        const blob = new FakeBlob([Buffer.from('not an mp4 at all, not even close')], {});
        ok('rubbish is refused without throwing', (await F.demux(reader(blob))) === null);
    }
    {
        const audioOnly = F.box('moov', [F.box('trak', [])]);
        const blob = new FakeBlob([F.box('ftyp', [new Uint8Array(8)]), audioOnly], {});
        ok('a file with no video track is refused', (await F.demux(reader(blob))) === null);
    }

    console.log('\nthe HEVC codec string, which is where phone footage lives');
    {
        /* Every iPhone since iOS 11 records HEVC by default, so this is the
           common case and not the exotic one. The string is fiddlier than
           AVC's: profile space as a letter, the compatibility flags with their
           bits REVERSED, tier as L or H, constraint bytes with trailing zeros
           cut. The two levels below are off his own phone. */
        const hvcC = (b1, compat, level, cons) => {
            const a = new Uint8Array(23);
            a[0] = 1; a[1] = b1;
            a[2] = (compat >>> 24) & 255; a[3] = (compat >>> 16) & 255;
            a[4] = (compat >>> 8) & 255; a[5] = compat & 255;
            cons.forEach((c, i) => { a[6 + i] = c; });
            a[12] = level;
            return a;
        };
        const main = (lvl, cons) => F.hevc(hvcC(0x01, 0x60000000, lvl, cons || [0xB0]), false);
        ok('an iPhone Main/L4.1 track', main(123) === 'hvc1.1.6.L123.B0', main(123));
        ok('level 5.0 reads as L150', main(150) === 'hvc1.1.6.L150.B0', main(150));
        ok('the high tier is H, not L',
           F.hevc(hvcC(0x21, 0x60000000, 93, [0xB0]), false) === 'hvc1.1.6.H93.B0',
           F.hevc(hvcC(0x21, 0x60000000, 93, [0xB0]), false));
        ok('in-band parameter sets are hev1, not hvc1',
           /^hev1\./.test(F.hevc(hvcC(0x01, 0x60000000, 123, [0xB0]), true)));
        ok('trailing zero constraint bytes are dropped',
           main(93, [0xB0, 0, 0, 0, 0, 0]) === 'hvc1.1.6.L93.B0', main(93, [0xB0, 0, 0, 0, 0, 0]));
        ok('the compatibility flags really are bit-reversed',
           main(93).split('.')[2] === '6', main(93));
        ok('a truncated hvcC gives nothing back rather than nonsense',
           F.hevc(new Uint8Array([1, 2, 3]), false) === null && F.hevc(null, false) === null);
    }

    console.log('\nthe sound of an interleaved file, read through a capped reader');
    {
        /* An iPhone MOV interleaves ~1 MB of video between each run of audio
           samples, so first-to-last audio spans nearly the whole file —
           99.7 MB measured on a one-minute clip. A path video reads through
           read_file_range, which refuses any single read over 8 MB, and the
           old one-big-read gpCopyAudio turned that refusal into "no sound"
           with a perfectly good AAC track in the file. This reader ENFORCES
           the cap, so the windowed walk is the only way to pass. */
        const N = 120, ts = 48000;
        const tab = { n: N, dts: new Float64Array(N), offsets: new Float64Array(N), sizes: new Uint32Array(N) };
        const FILE = 96 * 1024 * 1024;
        const backing = new Map();
        for (let i = 0; i < N; i++) {
            tab.dts[i] = i * 1024;
            tab.sizes[i] = 400 + (i % 7) * 30;
            tab.offsets[i] = 1000 + i * 800 * 1024;
            for (let bpos = 0; bpos < tab.sizes[i]; bpos++)
                backing.set(tab.offsets[i] + bpos, (i * 131 + bpos) & 255);
        }
        let reads = 0, biggest = 0;
        const reader = {
            size: FILE,
            read(off, len) {
                reads++; biggest = Math.max(biggest, len);
                if (len > 8 * 1024 * 1024) return Promise.reject(new Error('range over the 8 MB limit'));
                const u8 = new Uint8Array(len);
                for (let k = 0; k < len; k++) { const v = backing.get(off + k); if (v !== undefined) u8[k] = v; }
                return Promise.resolve(u8.buffer);
            }
        };
        /* A REAL sample entry, not four bytes: the entry is rebuilt now, and
           a stub that cannot be rebuilt is refused outright — correctly. */
        const at = { timescale: ts, tab, entry: { type: F.T('mp4a'), bytes: F.box('mp4a', [
            new Uint8Array(6), F.u16(1), F.u16(0), F.u16(0), F.u32(0),
            F.u16(2), F.u16(16), F.u16(0), F.u16(0), F.u32(48000 * 65536),
            F.box('esds', [new Uint8Array([0, 0, 0, 0, 3, 5, 6, 7])])
        ]) } };
        const res = await F.copyAudio(reader, at, { t0: 0, t1: N * 1024 / ts });
        ok('the sound comes back despite the cap', !!res, 'null');
        if (res) {
            ok('every sample was collected', res.chunks.length === N, res.chunks.length);
            ok('no single read broke the cap', biggest <= 8 * 1024 * 1024, biggest);
            let bytesOk = true;
            for (let i = 0; i < N; i++) {
                const c = res.chunks[i];
                if (c.length !== tab.sizes[i]) { bytesOk = false; break; }
                for (let k = 0; k < c.length; k += 37)
                    if (c[k] !== ((i * 131 + k) & 255)) { bytesOk = false; break; }
            }
            ok('every byte is the byte the file holds', bytesOk);
            ok('the durations are the gaps between samples',
               res.durs[0] === 1024 && res.durs[N - 1] === 1024);
            ok('…and reads were batched, not one per sample', reads < N, reads + ' reads');
        }
    }
    {
        const at = { timescale: 48000, tab: { n: 2, dts: new Float64Array([0, 1024]),
                     offsets: new Float64Array([0, 500]), sizes: new Uint32Array([400, 400]) },
                     entry: { type: F.T('lpcm'), bytes: new Uint8Array(4) } };
        const reader = { size: 1000, read: () => Promise.resolve(new ArrayBuffer(1000)) };
        ok('a QuickTime lpcm track is still refused',
           (await F.copyAudio(reader, at, { t0: 0, t1: 1 })) === null);
    }

    console.log('\nthe sound description is REBUILT, not copied');
    {
        /* This is the one that made an export play silent while every
           automated check said the sound was fine.

           An iPhone .MOV carries a QuickTime **version 1** sound sample
           entry: the standard 28 bytes, then 16 QuickTime-only fields, and
           the decoder config (esds) inside a `wave` atom rather than as a
           direct child. Copy those bytes verbatim into a file branded isom
           and a strict ISO demuxer reads the 28-byte header, looks for a
           child box, finds the extension fields where a box should be, never
           locates an esds, gets no AudioSpecificConfig, instantiates no
           decoder — and plays SILENCE from a track that is otherwise
           perfect. ffmpeg reads it happily because its demuxer handles
           QuickTime and ISO together and knows to look inside `wave`, which
           is exactly why measuring the file proved nothing.

           The fixture below is the real thing: the 143-byte entry taken out
           of his own IMG_0726.MOV. */
        const esdsBody = new Uint8Array(20);
        for (let i = 0; i < esdsBody.length; i++) esdsBody[i] = 0x40 + i;
        const esds = F.box('esds', [esdsBody]);

        const v0 = F.box('mp4a', [
            new Uint8Array(6), F.u16(1), F.u16(0), F.u16(0), F.u32(0),
            F.u16(2), F.u16(16), F.u16(0), F.u16(0), F.u32(48000 * 65536), esds
        ]);
        const v1 = F.box('mp4a', [
            new Uint8Array(6), F.u16(1), F.u16(1), F.u16(0), F.u32(0),
            F.u16(2), F.u16(16), F.u16(0xfffe), F.u16(0), F.u32(48000 * 65536),
            /* the four QuickTime v1 fields */
            F.u32(1024), F.u32(0), F.u32(0), F.u32(2),
            F.box('wave', [F.box('frma', [F.u32(0x6d703461)]), esds])
        ]);
        const v2 = (() => {
            const rate = new Uint8Array(8);
            new DataView(rate.buffer).setFloat64(0, 48000);
            return F.box('mp4a', [
                new Uint8Array(6), F.u16(1), F.u16(2), F.u16(0), F.u32(0),
                F.u16(3), F.u16(16), F.u16(0xfffe), F.u16(0), F.u32(65536),
                F.u32(72), rate, F.u32(2), F.u32(0x7F000000),
                F.u32(16), F.u32(0), F.u32(0), F.u32(0),
                esds
            ]);
        })();

        const rd = (e) => {
            const dv = new DataView(e.buffer, e.byteOffset, e.length);
            return { ver: dv.getUint16(16), chans: dv.getUint16(24),
                     comp: dv.getUint16(28), rate: dv.getUint32(32) >>> 16,
                     kid: String.fromCharCode(e[40], e[41], e[42], e[43]) };
        };

        [['a plain ISO entry', v0], ['an iPhone QuickTime v1 entry', v1],
         ['a QuickTime v2 entry', v2]].forEach(([what, src]) => {
            const out = F.isoEntry(src);
            ok('rebuilt from ' + what, !!out);
            if (!out) return;
            const r = rd(out);
            ok('  …as version 0, which is the only one ISO defines', r.ver === 0, r.ver);
            ok('  …with the esds as a DIRECT child', r.kid === 'esds', r.kid);
            ok('  …keeping the real sample rate', r.rate === 48000, r.rate);
            ok('  …and the real channel count', r.chans === 2, r.chans);
            ok('  …with the QuickTime compression id cleared', r.comp === 0, r.comp);
            /* 48000 * 65536 overflows a signed 32-bit shift; `rate << 16`
               would write a negative number and the rate would read as 0. */
            ok('  …written as 16.16 without overflowing the sign bit',
               out[32] === 0xbb && out[33] === 0x80 && out[34] === 0 && out[35] === 0,
               out.slice(32, 36).join(','));
            let same = out.length >= esds.length;
            for (let i = 0; i < esds.length && same; i++)
                if (out[out.length - esds.length + i] !== esds[i]) same = false;
            ok('  …and the decoder config carried across byte for byte', same);
        });

        {
            /* 44.1 kHz is the other rate real footage carries, and it is the
               one where a careless 16.16 conversion goes wrong quietly. */
            const e441 = F.box('mp4a', [
                new Uint8Array(6), F.u16(1), F.u16(0), F.u16(0), F.u32(0),
                F.u16(1), F.u16(16), F.u16(0), F.u16(0), F.u32(44100 * 65536), esds
            ]);
            const out = F.isoEntry(e441);
            const dv = new DataView(out.buffer, out.byteOffset, out.length);
            ok('44.1 kHz mono round-trips exactly',
               (dv.getUint32(32) >>> 16) === 44100 && dv.getUint16(24) === 1,
               (dv.getUint32(32) >>> 16) + ' Hz, ' + dv.getUint16(24) + ' ch');
        }
        ok('the esds is found inside a wave atom', !!F.findEsds(v1, 52, v1.length));
        ok('…and as a direct child', !!F.findEsds(v0, 36, v0.length));

        /* No decoder config means no decoder in ANY player. Refuse, the same
           way lpcm is refused — a file that claims sound and delivers none is
           worse than one that says it has none. */
        const noCfg = F.box('mp4a', [
            new Uint8Array(6), F.u16(1), F.u16(0), F.u16(0), F.u32(0),
            F.u16(2), F.u16(16), F.u16(0), F.u16(0), F.u32(48000 * 65536)
        ]);
        ok('an entry with no esds anywhere is refused', F.isoEntry(noCfg) === null);
        ok('a truncated entry is refused', F.isoEntry(new Uint8Array(12)) === null);
        ok('an unknown version is refused', (() => {
            const odd = v1.slice(); odd[17] = 9; return F.isoEntry(odd) === null;
        })());
    }
    {
        /* End to end: the entry that comes out of gpCopyAudio must be the
           rebuilt one, because that is the one the muxer writes. */
        const esds = F.box('esds', [new Uint8Array([1, 2, 3, 4])]);
        const qt = F.box('mp4a', [
            new Uint8Array(6), F.u16(1), F.u16(1), F.u16(0), F.u32(0),
            F.u16(2), F.u16(16), F.u16(0xfffe), F.u16(0), F.u32(48000 * 65536),
            F.u32(1024), F.u32(0), F.u32(0), F.u32(2),
            F.box('wave', [esds])
        ]);
        const N = 4, tab = { n: N, dts: new Float64Array(N), offsets: new Float64Array(N),
                             sizes: new Uint32Array(N) };
        for (let i = 0; i < N; i++) { tab.dts[i] = i * 1024; tab.sizes[i] = 100; tab.offsets[i] = 100 + i * 200; }
        const reader = { size: 4096, read: (o, l) => Promise.resolve(new ArrayBuffer(l)) };
        const at = { timescale: 48000, tab, entry: { type: F.T('mp4a'), bytes: qt } };
        const res = await F.copyAudio(reader, at, { t0: 0, t1: 1 });
        ok('the copied sound carries a rebuilt entry, not the source bytes',
           !!res && res.entry.length !== qt.length, res ? res.entry.length + ' vs ' + qt.length : 'null');
        ok('…and that entry is version 0',
           !!res && new DataView(res.entry.buffer, res.entry.byteOffset).getUint16(16) === 0);
        const bad = { timescale: 48000, tab,
                      entry: { type: F.T('mp4a'), bytes: F.box('mp4a', [new Uint8Array(28)]) } };
        ok('a source whose entry cannot be rebuilt copies no sound at all',
           (await F.copyAudio(reader, bad, { t0: 0, t1: 1 })) === null);
    }

    console.log('\nthe real-time path does not record a muted element');
    {
        /* A MUTED element captures SILENCE — the track exists, the container
           looks healthy, ffprobe reports stereo 48 kHz, and every sample is
           zero. The tile is muted by default (nobody wants engine noise while
           they read a lap), so this path produced silent exports that gave no
           sign of being silent. It must unmute to record and put the tile
           back exactly as it found it, on every exit including the failures.

           Read out of the source rather than executed: gpExportSlow is a
           MediaRecorder pipeline that cannot be run in node, but the ORDER of
           these four statements is the whole of the fix and it is checkable. */
        const fn = src.slice(src.indexOf('function gpExportSlow(p)'));
        const body = fn.slice(0, fn.indexOf('\n        function '));
        const iWas = body.indexOf('var wasMuted = el.muted');
        const iUn = body.indexOf('el.muted = false');
        const iCap = body.indexOf('el.captureStream().getAudioTracks()');
        ok('the tile is unmuted before the audio is captured',
           iWas >= 0 && iUn > iWas && iCap > iUn,
           iWas + ',' + iUn + ',' + iCap);
        ok('there is a single restore, defined once', /var unmute = function/.test(body));
        ok('…called when the recording finishes',
           /el\.loop = wasLoop; el\.playbackRate = wasRate;\s*\n\s*unmute\(\);/.test(body));
        ok('…and when the recorder refuses the settings',
           /unmute\(\);\s*\n\s*if \(typeof showToast[^\n]*recorder refused/.test(body));
        ok('…and when capturing the audio throws',
           /catch \(e\) \{\s*\n\s*el\.muted = wasMuted;/.test(body));
        ok('the restore puts back what was THERE, not a guess at it',
           !/el\.muted = true/.test(body) && /el\.muted = wasMuted/.test(body));
    }

    console.log('\nthe codec string');
    {
        ok('high profile level 4.0', F.codec(new Uint8Array([1, 0x64, 0, 0x28])) === 'avc1.640028');
        ok('baseline level 3.1', F.codec(new Uint8Array([1, 0x42, 0xc0, 0x1f])) === 'avc1.42c01f');
        ok('nothing to read gives nothing back', F.codec(null) === null && F.codec(new Uint8Array([1])) === null);
    }

    /* ══ an export is a snapshot, not a worker (ADR-0052) ═════════════════ */
    console.log('\nthe frame loop borrows the app’s state and gives it back');
    {
        const SNAPF = ['gpExportSnap', 'gpWithSnapshot', 'gpExportQueue',
                       'gpExportPump', 'gpExportCancel', 'gpExportDone'];
        const sparts = [grabVar(src, 'GP_SNAP_KEYS')];
        SNAPF.forEach(f => sparts.push(grabFn(src, f)));
        const S = new Function('ARGgp', 'ARGlog', `
            var gp = ARGgp, LOG = ARGlog;
            function gpExportStrip() { LOG.strips++; }
            function gpExportRunNow(job) { LOG.ran.push(job.id); }
            function gpExportName() { return 'x.mp4'; }
            function gpFastAvailable() { return true; }
            ${sparts.join('\n')}
            return { keys: GP_SNAP_KEYS, snap: gpExportSnap, withSnap: gpWithSnapshot,
                     queue: gpExportQueue, pump: gpExportPump, cancel: gpExportCancel,
                     done: gpExportDone, gp: gp };
        `);

        const mk = () => {
            const gp = { trace: ['A'], selLap: 0, cmpLap: -1, cam: { hud: { v: 1, w: {} } },
                         delta: 'dA', deltaKey: 'kA', ghostFence: null, spdUnit: 'kph' };
            const log = { strips: 0, ran: [] };
            return { E: S(gp, log), gp, log };
        };

        {
            const { E, gp } = mk();
            const snap = E.snap();
            ok('the snapshot copies the camera settings rather than pointing at them',
               snap.cam !== gp.cam && JSON.stringify(snap.cam) === JSON.stringify(gp.cam));
            /* The rows array is REPLACED by gpSessionLoad, never mutated in
               place, so holding the old one is both cheap and correct. */
            ok('…and holds the rows by reference, because they are replaced not edited',
               snap.trace === gp.trace);
            ok('every key it names is captured',
               E.keys.every(k => Object.prototype.hasOwnProperty.call(snap, k)),
               E.keys.filter(k => !(k in snap)).join(' '));
        }
        {
            const { E, gp } = mk();
            const snap = E.snap();
            gp.selLap = 4; gp.delta = 'dLIVE'; gp.deltaKey = 'kLIVE';
            gp.cam.hud.w.hudSpeed = { dx: 99, dy: 0, k: 1 };

            let sawLap = null, sawDelta = null, sawHud = null;
            E.withSnap(snap, function () {
                sawLap = gp.selLap; sawDelta = gp.delta;
                sawHud = JSON.stringify(gp.cam.hud.w);
            });
            /* THE check the whole design turns on: a job's frames must not
               change because somebody re-selected a lap or nudged a widget
               while it was running. The modal used to prevent that by
               construction; the snapshot has to now. */
            ok('inside the borrow, the frame sees the job’s lap, not the live one',
               sawLap === 0, String(sawLap));
            ok('…the job’s derived delta, not the live cache', sawDelta === 'dA', String(sawDelta));
            ok('…and the job’s overlay layout, not the one being edited',
               sawHud === '{}', sawHud);

            ok('afterwards the live lap is back', gp.selLap === 4, String(gp.selLap));
            ok('…the live cache is back', gp.delta === 'dLIVE' && gp.deltaKey === 'kLIVE');
            ok('…and so is the layout being edited',
               !!gp.cam.hud.w.hudSpeed && gp.cam.hud.w.hudSpeed.dx === 99);
        }
        {
            /* A throw inside the composite must not leave the app wearing a
               half-finished export's state. */
            const { E, gp } = mk();
            const snap = E.snap();
            gp.selLap = 7;
            let threw = false;
            try { E.withSnap(snap, function () { throw new Error('composite blew up'); }); }
            catch (e) { threw = true; }
            ok('a throw inside the borrow still propagates', threw);
            ok('…and the state is given back anyway', gp.selLap === 7, String(gp.selLap));
        }
        {
            const { E } = mk();
            let ran = 0;
            E.withSnap(null, function () { ran++; });
            ok('no snapshot is not an error — it is the old, unqueued behaviour', ran === 1);
        }
        {
            /* One at a time: two WebCodecs pipelines contend for the same
               hardware encoder and both get slower. */
            const { E, gp, log } = mk();
            const a = { id: 'a', state: 'queued', plan: {} };
            const b = { id: 'b', state: 'queued', plan: {} };
            E.queue().push(a, b);
            E.pump();
            ok('the head of the queue runs', log.ran.join() === 'a', log.ran.join());
            E.pump();
            ok('…and a second pump does not start another beside it',
               log.ran.join() === 'a', log.ran.join());
            E.done(a, 'done');
            ok('…the next one starts when the first finishes',
               log.ran.join() === 'a,b', log.ran.join());
        }
        {
            const { E, gp, log } = mk();
            const a = { id: 'a', state: 'queued', plan: {} };
            const b = { id: 'b', state: 'queued', plan: {} };
            E.queue().push(a, b);
            E.cancel('b');
            ok('a queued job can be stopped before it starts', b.state === 'cancelled');
            E.pump();
            ok('…and stopping it does not disturb the one in front',
               log.ran.join() === 'a', log.ran.join());
            E.cancel('a');
            ok('stopping the running one marks it rather than yanking it',
               a.cancelled === true && a.state === 'running', a.state);
        }
    }

    /* ══ the reel: picking what goes in it ════════════════════════════════ */
    console.log('\na reel is moments, merged and fitted to a budget');
    {
        const R = new Function('ARGgp', 'ARGms', 'ARGdur', `
            var gp = ARGgp;
            function gpMoments() { return ARGms; }
            /* One second of footage per sample index keeps the arithmetic
               readable; what is under test is the picking, not the clock. */
            function gpVideoTimeFor(i) { return i === null ? null : i; }
            var document = { getElementById: function () { return { duration: ARGdur }; } };
            ${[grabVar(src, 'GP_REEL_SECS'), grabVar(src, 'GP_REEL_RANK'),
               grabFn(src, 'gpReelPlan')].join('\n')}
            return { plan: gpReelPlan };
        `);
        const gpOf = () => ({ trace: [], video: { t0: 0 } });
        const M = (name, from, to, value) => ({ name: name, icon: 'x', value: value || '1',
                                                i: from, from: from, to: to });

        {
            const E = R(gpOf(), [M('Top speed', 0, 5), M('Biggest slide', 20, 26)], 600);
            const p = E.plan({ secs: 40 });
            ok('both fit, so both are in', p.segs.length === 2, String(p.segs.length));
            ok('…in TIME order, not in rank order',
               p.segs[0].t0 < p.segs[1].t0, p.segs.map(s => s.t0).join(','));
            ok('…and the total is the sum', Math.abs(p.secs - 11) < 0.01, String(p.secs));
        }
        {
            /* Two different names can land on the same stretch of road.
               Showing it twice is worse than showing it once. */
            const E = R(gpOf(), [M('Top speed', 0, 10), M('Biggest slide', 8, 14)], 600);
            const p = E.plan({ secs: 40 });
            ok('overlapping moments merge into one segment', p.segs.length === 1);
            ok('…spanning both', p.segs[0].t0 === 0 && p.segs[0].t1 === 14,
               p.segs[0].t0 + '-' + p.segs[0].t1);
            ok('…and the better-ranked one keeps its caption',
               /Biggest slide/.test(p.segs[0].caption), p.segs[0].caption);
        }
        {
            const E = R(gpOf(), [M('Top speed', 0, 30), M('Biggest slide', 100, 130),
                                 M('Hardest braking', 200, 230)], 600);
            const p = E.plan({ secs: 40 });
            ok('the budget is never exceeded', p.secs <= 40.001, String(p.secs));
            ok('…and rank decides what survives it',
               p.segs.some(s => s.name === 'Biggest slide'),
               p.segs.map(s => s.name).join(','));
            /* Three 30 s segments into a 40 s budget: one fits, two do not,
               and the fitter keeps considering the rest rather than stopping
               at the first that will not go. */
            ok('…while what was dropped is counted, not hidden', p.dropped === 2,
               String(p.dropped));
            ok('…and one 30 s segment is what fit', p.segs.length === 1, String(p.segs.length));
        }
        {
            /* A whole lap will not fit in a forty-second reel, and slicing it
               would advertise a lap time nobody watched. */
            const E = R(gpOf(), [M('Fastest lap', 0, 90), M('Biggest slide', 100, 106)], 600);
            const p = E.plan({ secs: 40 });
            ok('a whole lap is left out rather than sliced',
               !p.segs.some(s => s.name === 'Fastest lap'), p.segs.map(s => s.name).join(','));
            ok('…and the reel is still made from what does fit',
               p.segs.length === 1 && p.segs[0].name === 'Biggest slide');
        }
        {
            const E = R(gpOf(), [M('Top speed', 0, 5)], 3);
            const p = E.plan({ secs: 40 });
            ok('a segment is clipped to the footage that exists',
               p.segs[0].t1 === 3, String(p.segs[0].t1));
        }
        {
            ok('no video, no reel',
               R({ trace: [], video: null }, [M('Top speed', 0, 5)], 600).plan({}) === null);
            ok('unsynced footage, no reel',
               R({ trace: [], video: { t0: null } }, [M('Top speed', 0, 5)], 600).plan({}) === null);
            ok('no moments, no reel', R(gpOf(), [], 600).plan({}) === null);
            ok('a moment shorter than a blink is not a segment',
               R(gpOf(), [M('Top speed', 0, 0.2)], 600).plan({}) === null);
            ok('a budget nothing fits in makes no reel',
               R(gpOf(), [M('Top speed', 0, 50)], 600).plan({ secs: 20 }) === null);
        }
    }

    /* ══ several segments, one file ══════════════════════════════════════ */
    console.log('\nthe reel is muxed once, out of several ranges');
    {
        const M = new Function(`
            ${grabFn(src, 'gpReelMerge')}
            return { merge: gpReelMerge };
        `)();
        const seg = (n, aFrames) => ({
            frames: n,
            vTrack: { id: 1, video: true, timescale: 90000, width: 1920, height: 1080,
                      chunks: Array.from({ length: n }, () => new Uint8Array(10)),
                      durs: Array.from({ length: n }, () => 3000),
                      sync: [0], durTicks: n * 3000,
                      entry: new Uint8Array(4) },
            aTrack: aFrames ? { id: 2, video: false, timescale: 48000,
                                chunks: Array.from({ length: aFrames }, () => new Uint8Array(6)),
                                durs: Array.from({ length: aFrames }, () => 1024),
                                sync: null, durTicks: aFrames * 1024,
                                entry: new Uint8Array(4) } : null
        });

        const m = M.merge([seg(30), seg(20), seg(10)]);
        ok('every frame of every segment is in the one track',
           m.v.chunks.length === 60 && m.v.durs.length === 60, String(m.v.chunks.length));
        ok('…and the duration is the sum', m.v.durTicks === 60 * 3000, String(m.v.durTicks));
        /* sync entries are FRAME INDICES, so they have to be offset — a
           keyframe list that still says 0 three times is a file that seeks to
           the wrong place. */
        ok('the keyframe list is offset per segment, not repeated',
           m.v.sync.join(',') === '0,30,50', m.v.sync.join(','));
        ok('…and there is one at the start of every cut',
           m.v.sync.length === 3, String(m.v.sync.length));
        ok('the frame count is carried through', m.frames === 60, String(m.frames));
        ok('no audio in, no audio track out', m.a === null);

        /* AAC frames are ~21 ms at 48 kHz and video frames 33 ms, so a
           segment's sound is never exactly as long as its picture. What must
           not happen is the error accumulating across cuts. */
        const withA = M.merge([seg(30, 47), seg(30, 47), seg(30, 47)]);
        const vSecs = withA.v.durTicks / withA.v.timescale;
        const aSecs = withA.a.durTicks / withA.a.timescale;
        ok('sound and picture come out the same length',
           Math.abs(vSecs - aSecs) < 0.001, vSecs.toFixed(4) + ' vs ' + aSecs.toFixed(4));
        ok('…which is the point: the error is absorbed at each cut, not carried',
           Math.abs(vSecs - aSecs) < (1024 / 48000),
           'drift ' + Math.abs(vSecs - aSecs).toFixed(5) + ' s');
        ok('every audio frame is still there',
           withA.a.chunks.length === 141, String(withA.a.chunks.length));

        const one = M.merge([seg(12, 20)]);
        ok('one segment merges to itself', one.v.chunks.length === 12 && one.a.chunks.length === 20);
        ok('nothing at all merges to nothing', M.merge([]).v === null);
        ok('a failed segment is skipped rather than breaking the reel',
           M.merge([seg(5), null, seg(5)]).v.chunks.length === 10);
    }

    /* ══ two laps, side by side ══════════════════════════════════════════ */
    console.log('\nthe frame beside this one is the one at the same PLACE');
    {
        const C = new Function(`
            ${[grabFn(src, 'gpCompareAt'), grabFn(src, 'gpCompareNeedsFrame'),
               grabFn(src, 'gpCompareBox')].join('\n')}
            return { at: gpCompareAt, needs: gpCompareNeedsFrame, box: gpCompareBox };
        `)();

        /* What gpDeltaSeries hands back: for each sample of the analysed lap,
           the reference sample at the same place. Forward-only by
           construction, and here the reference lap is the slower one through
           the middle, so it repeats. */
        const match = Int32Array.from([500, 500, 501, 503, 503, 503, 506, 510]);
        ok('the pairing is by place, not by time',
           C.at(match, 100, 103) === 503, String(C.at(match, 100, 103)));
        ok('…and it is read relative to the lap, not the trace',
           C.at(match, 100, 100) === 500, String(C.at(match, 100, 100)));
        ok('before the lap starts, the first pairing holds',
           C.at(match, 100, 90) === 500, String(C.at(match, 100, 90)));
        ok('past the end, the last one does', C.at(match, 100, 999) === 510,
           String(C.at(match, 100, 999)));
        ok('no pairing at all is null, not a guess', C.at(null, 0, 0) === null);

        /* Monotonic, which is what lets the second decoder be pulled along by
           the first rather than needing a pump of its own. */
        let backwards = false;
        for (let i = 1; i < match.length; i++) if (match[i] < match[i - 1]) backwards = true;
        ok('the pairing never goes backwards', !backwards);

        ok('a decoder with nothing yet needs a frame', C.needs(null, 5) === true);
        ok('…one behind the target needs another', C.needs(4.9, 5) === true);
        ok('…and one that has reached it holds what it has', C.needs(5, 5) === false);
        ok('…as does one past it — the reference lap is slower here',
           C.needs(6, 5) === false);

        {
            const b = C.box(1920, 1080, 'side');
            ok('side by side splits the frame in two', b.a.w === 960 && b.b.w === 960);
            ok('…meeting in the middle with nothing over', b.a.w + b.b.w === 1920);
            ok('…both full height', b.a.h === 1080 && b.b.h === 1080);
        }
        {
            const b = C.box(1080, 1920, 'inset');
            ok('inset gives the whole frame to the lap being watched',
               b.a.w === 1080 && b.a.h === 1920);
            ok('…and the reference a corner of it', b.b.w < b.a.w / 2 && b.b.x > b.a.w / 2,
               JSON.stringify(b.b));
            ok('…inside the frame', b.b.x + b.b.w <= 1080 && b.b.y + b.b.h <= 1920,
               JSON.stringify(b.b));
        }
        {
            /* The merge, which is the one part of a two-decoder export that can
               deadlock or pair the wrong frame — and neither shows up until
               somebody watches the file. */
            const St = new Function(`
                ${[grabFn(src, 'gpCompareNeedsFrame'), grabFn(src, 'gpCompareStep'),
                   grabFn(src, 'gpCompareWindow')].join('\n')}
                return { step: gpCompareStep, win: gpCompareWindow };
            `)();

            ok('a reference frame at the target is taken',
               St.step(5, 5, null, false) === 'advance');
            ok('…and one before it too — the newest that is not past the target wins',
               St.step(5, 4.9, 3, false) === 'advance');
            ok('a reference frame past the target is not taken yet',
               St.step(5, 5.5, 4.99, false) !== 'advance', St.step(5, 5.5, 4.99, false));
            ok('nothing decoded yet, and more coming: wait',
               St.step(5, null, null, false) === 'wait');
            ok('…but if B has finished, compose with what there is',
               St.step(5, null, null, true) === 'compose');
            ok('holding a frame at the target is enough to compose',
               St.step(5, null, 5, false) === 'compose');
            ok('holding one PAST the target is too — the reference lap is slower here',
               St.step(5, null, 6, false) === 'compose');
            /* A stretch the other day was not filming. One picture, rather than
               an invented second one. */
            ok('no target at all composes rather than waiting for ever',
               St.step(NaN, null, null, false) === 'compose');
            ok('…and so does a null target', St.step(null, null, null, false) === 'compose');

            /* The deadlock the guard exists for: B done, nothing held, nothing
               queued, must still make progress. */
            ok('B finishing early never leaves A waiting',
               St.step(99, null, 1, true) === 'compose');

            /* Walking a whole pairing through, the way drain() does. */
            const bFrames = [0, 1, 2, 3, 4, 5];
            const wants = [0, 1.4, 1.4, 3.2, 9];
            let held = null, q = bFrames.slice(), out = [], stuck = false;
            wants.forEach(function (w) {
                for (let guard = 0; guard < 50; guard++) {
                    const act = St.step(w, q.length ? q[0] : null, held, q.length === 0);
                    if (act === 'advance') { held = q.shift(); continue; }
                    if (act === 'wait') { stuck = true; }
                    break;
                }
                out.push(held);
            });
            ok('a whole pairing walks through without sticking', !stuck);
            ok('…taking the newest frame at or before each target',
               out.join(',') === '0,1,1,3,5', out.join(','));
            /* The reference lap being slower is the interesting case: the same
               frame is shown twice rather than the video stalling. */
            ok('…and holding a frame when the reference lap is the slower one',
               out[1] === out[2], out.join(','));
        }
        {
            /* The decode window: a decoder cannot start anywhere but a
               keyframe, and starting one frame late is a black opening. */
            const W = new Function(`
                ${grabFn(src, 'gpCompareWindow')}
                return { win: gpCompareWindow };
            `)();
            const src2 = { ts: 1000, tab: { n: 10,
                cts: [0, 100, 200, 300, 400, 500, 600, 700, 800, 900].map(v => v),
                sync: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0] } };
            const w = W.win(src2, 0.55, 0.75);
            ok('the window starts at the keyframe BEFORE the range, not inside it',
               w.key === 4, String(w.key));
            ok('…and ends at the last sample inside it', w.last === 7, String(w.last));
            const w2 = W.win(src2, 0.4, 0.45);
            ok('a range that begins ON a keyframe does not back up further',
               w2.key === 4, String(w2.key));
        }
        {
            /* H.264 will not take an odd dimension, and this is the one place
               a new rectangle gets invented. */
            const odd = [[1921, 1081], [1079, 1919], [641, 361]];
            let bad = [];
            odd.forEach(function (wh) {
                ['side', 'inset'].forEach(function (mode) {
                    const b = C.box(wh[0], wh[1], mode);
                    [b.a, b.b].forEach(function (r) {
                        if (r.w % 2 || r.h % 2) bad.push(mode + ' ' + wh.join('x') +
                            ' -> ' + r.w + 'x' + r.h);
                    });
                });
            });
            ok('every picture rectangle comes out even, whatever the source',
               bad.length === 0, bad.join(' '));
        }
    }

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
})();
