/* `shipprobe plan <spec.json> <dir>`: the output must match the approved plan.
 *
 * A plan is a document and execution is a shell. A coding agent follows a plan until it hits
 * something the plan did not anticipate, invents a local fix, and the fix works: it builds, it
 * renders, nothing errors. The one sentence of the plan it just contradicted is in a document.
 * Tests pass and CI is green. A human is the only detector.
 *
 * So the plan gets a spec, and the spec refuses output. Every check carries `quote`, the sentence
 * from the plan it enforces, and a failure prints that sentence. The violation is reported in the
 * plan's words, not the gate's.
 *
 *   { "source": "docs/plans/api-reference.md",
 *     "checks": [
 *       { "kind": "files",    "glob": "docs/*.md", "min": 3, "max": 3, "quote": "Ship exactly three endpoint pages." },
 *       { "kind": "requires", "glob": "docs/*.md", "patterns": ["curl -"], "quote": "Every page carries a curl example." },
 *       { "kind": "forbids",  "glob": "**\/*.md",  "patterns": ["billing-core"], "quote": "No page names the internal service." }
 *     ] }
 *
 * Fourteen kinds. Six read the filesystem: files, requires, forbids, pairedFile, sidecar, media.
 * Eight decode real pixels from video with ffmpeg: distinct, frameFill, luminance, accentShare,
 * motionFloor, textInk, markPresent, cutCadence. A text slide and a product demo have the same
 * ffprobe metadata, which is why the pixel kinds exist.
 *
 * Exit 0 clean, 1 a violation, 2 the spec or the tools could not be read, 3 every violation was
 * "this was never produced" (the glob matched nothing). 3 is still not a pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { newResult, PASS, FAIL, NEVER } from '../result.mjs';

class ToolMissing extends Error {}

function run(cmd, args, opts) {
  try {
    return execFileSync(cmd, args, opts);
  } catch (e) {
    if (e && e.code === 'ENOENT') throw new ToolMissing(`${cmd} is not installed, so this check could not run`);
    throw e;
  }
}

export function runPlan(specArg, outArg) {
  const result = newResult('plan', specArg);
  if (!specArg) {
    result.unchecked.push({ why: 'no spec. Usage: shipprobe plan <spec.json> <output-dir>' });
    return result;
  }
  if (!outArg) {
    result.unchecked.push({ why: 'no output directory. It is never inferred: a gate that guesses which tree it measures can report on the wrong one.' });
    return result;
  }
  const expand = (p) => p.replace(/^~(?=$|\/)/, process.env.HOME || '~');
  const SPEC_PATH = path.resolve(expand(specArg));
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  } catch (e) {
    result.unchecked.push({ where: SPEC_PATH, why: `the spec could not be read: ${e.message}. Nothing was checked.` });
    return result;
  }
  const ROOT = path.resolve(expand(outArg));
  result.subject = `${path.relative(process.cwd(), SPEC_PATH) || SPEC_PATH} against ${ROOT}`;
  if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
    result.unchecked.push({ where: ROOT, why: 'the output directory does not exist' });
    return result;
  }
  const checks = spec.checks || [];
  if (!checks.length) {
    result.unchecked.push({ where: SPEC_PATH, why: 'the spec declares no checks. A spec that checks nothing is a document, not a gate.' });
    return result;
  }

  const fails = [];
  const notes = [];
  const fail = (c, msg) => fails.push({ quote: c.quote || '(no quote recorded in the spec)', msg, kind: c.kind });
  const failAbsent = (c, msg) => fails.push({ quote: c.quote || '(no quote recorded in the spec)', msg, kind: c.kind, absent: true });

  function walk(dir, acc = []) {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return acc;
    }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, acc);
      else acc.push(p);
    }
    return acc;
  }
  let allFiles = null;
  function glob(pattern) {
    /* `**` is swapped for a placeholder BEFORE single `*` is translated. Translating in the other
     * order rewrote the `*` inside the `**` expansion as well, so `**\/` reached one directory at
     * most and a forbids rule on `**\/*.md` silently skipped every deeper file. */
    const rx = new RegExp(
      '^' +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*\*\//g, '\u0001')
          .replace(/\*\*/g, '\u0002')
          .replace(/\*/g, '[^/]*')
          .replace(/\u0001/g, '(?:.*/)?')
          .replace(/\u0002/g, '.*') +
        '$',
    );
    allFiles = allFiles || walk(ROOT);
    return allFiles.filter((f) => rx.test(path.relative(ROOT, f).split(path.sep).join('/'))).sort();
  }
  const rel = (f) => path.relative(ROOT, f);
  const ffprobe = (file, args) => {
    try {
      return run('ffprobe', ['-v', 'error', ...args, '-of', 'default=nw=1', file], { encoding: 'utf8' }).trim();
    } catch (e) {
      if (e instanceof ToolMissing) throw e;
      return '';
    }
  };
  const kv = (s) =>
    Object.fromEntries(
      s
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    );

  /* PIXELS WITHOUT A DEPENDENCY. ffmpeg hands frames over as raw bytes on stdout: one byte per
   * pixel for `gray`, three for `rgb24`, decoded at a small working width because a design rule
   * is about proportions of the frame. */
  function rawFrames(file, { fps = 10, w = 320, rgb = false } = {}) {
    const px = rgb ? 3 : 1;
    const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${fps ? `fps=${fps},` : ''}scale=${w}:-2,format=${rgb ? 'rgb24' : 'gray'}`, '-f', 'rawvideo', '-'], {
      maxBuffer: 1 << 30,
      encoding: 'buffer',
    });
    const v = kv(ffprobe(file, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height']));
    const fh = Math.round((w * +v.height) / +v.width / 2) * 2;
    const stride = w * fh * px;
    if (!stride || buf.length < stride) throw new Error(`raw decode produced ${buf.length} bytes, one frame needs ${stride}`);
    const frames = [];
    for (let o = 0; o + stride <= buf.length; o += stride) frames.push(buf.subarray(o, o + stride));
    return { frames, w, h: fh, px };
  }
  const meanLuma = (f) => {
    let s = 0;
    for (let i = 0; i < f.length; i++) s += f[i];
    return s / f.length;
  };
  /* A LETTERBOX IS A BAND OF IDENTICAL GROUND AT THE FRAME EDGE, not a content bounding box. A
   * bounding box reads a dark UI's own near-black margins as letterbox. */
  function edgeBands(f, w, h, tol = 3) {
    const corner = f[2 * w + 2];
    const uniformRow = (y) => {
      for (let x = 0; x < w; x++) if (Math.abs(f[y * w + x] - corner) > tol) return false;
      return true;
    };
    const uniformCol = (x) => {
      for (let y = 0; y < h; y++) if (Math.abs(f[y * w + x] - corner) > tol) return false;
      return true;
    };
    let top = 0;
    while (top < h && uniformRow(top)) top++;
    let bottom = 0;
    while (bottom < h - top && uniformRow(h - 1 - bottom)) bottom++;
    let left = 0;
    while (left < w && uniformCol(left)) left++;
    let right = 0;
    while (right < w - left && uniformCol(w - 1 - right)) right++;
    return { top: top / h, bottom: bottom / h, left: left / w, right: right / w, fillW: (w - left - right) / w, fillH: (h - top - bottom) / h };
  }
  const hex2rgb = (s) => {
    const m = String(s).replace('#', '');
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  };
  function colourShare(f, [tr, tg, tb], tol) {
    let n = 0;
    for (let i = 0; i < f.length; i += 3) {
      const dr = f[i] - tr;
      const dg = f[i + 1] - tg;
      const db = f[i + 2] - tb;
      if (dr * dr + dg * dg + db * db <= tol * tol) n++;
    }
    return n / (f.length / 3);
  }
  /* "Is anything moving" is an AREA question: the fraction of pixels that changed by more than a
   * per-pixel threshold. Mean delta is dominated by how much of the frame moved. */
  const changedFrac = (a, b, pixEps) => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > pixEps) n++;
    return n / a.length;
  };
  /* A CUT IS A CHANGE NO SHIFT EXPLAINS. A scroll is a translation, so shifting one frame onto the
   * other explains almost all of it. A cut is not a translation of anything. */
  function unexplainedByShift(a, b, w, h, pixEps, m) {
    let best = 1;
    for (let dy = -m; dy <= m; dy++) {
      for (let dx = -m; dx <= m; dx++) {
        let n = 0;
        let total = 0;
        for (let y = m; y < h - m; y++) {
          const ra = y * w;
          const rb = (y + dy) * w + dx;
          for (let x = m; x < w - m; x++) {
            total++;
            if (Math.abs(a[ra + x] - b[rb + x]) > pixEps) n++;
          }
        }
        best = Math.min(best, n / total);
        if (best === 0) return 0;
      }
    }
    return best;
  }
  /** Row-wise ink runs in a region: one run is one line of text, its height the glyph extent. */
  function inkRuns(f, w, h, region, inkThresh = 55, minCoverage = 0.004) {
    const x0 = Math.round((region.x0 ?? 0) * w);
    const x1 = Math.round((region.x1 ?? 1) * w);
    const y0 = Math.round((region.y0 ?? 0) * h);
    const y1 = Math.round((region.y1 ?? 1) * h);
    const hist = new Array(32).fill(0);
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) hist[f[y * w + x] >> 3]++;
    const ground = hist.indexOf(Math.max(...hist)) * 8 + 4;
    const cols = Math.max(1, x1 - x0);
    const runs = [];
    let cur = 0;
    for (let y = y0; y < y1; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) if (Math.abs(f[y * w + x] - ground) > inkThresh) n++;
      if (n / cols > minCoverage) cur++;
      else {
        if (cur) runs.push(cur);
        cur = 0;
      }
    }
    if (cur) runs.push(cur);
    return { ground, runs: runs.filter((r) => r >= 2) };
  }
  /** Normalised cross-correlation of a grayscale template over a frame, coarse stride. */
  function bestMatch(frame, w, h, tpl, tw, th) {
    const tMean = meanLuma(tpl);
    let tVar = 0;
    for (let i = 0; i < tpl.length; i++) tVar += (tpl[i] - tMean) ** 2;
    tVar = Math.sqrt(tVar) || 1;
    let best = -1;
    const step = Math.max(1, Math.round(Math.min(tw, th) / 4));
    for (let oy = 0; oy + th <= h; oy += step) {
      for (let ox = 0; ox + tw <= w; ox += step) {
        let sum = 0;
        for (let y = 0; y < th; y++) {
          const r = (oy + y) * w + ox;
          for (let x = 0; x < tw; x++) sum += frame[r + x];
        }
        const fMean = sum / (tw * th);
        let num = 0;
        let fVar = 0;
        for (let y = 0; y < th; y++) {
          const r = (oy + y) * w + ox;
          const tr = y * tw;
          for (let x = 0; x < tw; x++) {
            const a = frame[r + x] - fMean;
            const b = tpl[tr + x] - tMean;
            num += a * b;
            fVar += a * a;
          }
        }
        best = Math.max(best, num / ((Math.sqrt(fVar) || 1) * tVar));
      }
    }
    return best;
  }
  function loadTemplate(file, w) {
    const buf = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${w}:-2,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26, encoding: 'buffer' });
    const h = buf.length / w;
    if (!Number.isInteger(h)) throw new Error(`template decoded to ${buf.length} bytes, not divisible by width ${w}`);
    return { tpl: buf, tw: w, th: h };
  }
  function cutTimes(file, threshold = 0.3) {
    let out = '';
    try {
      out = run('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-i', file, '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`, '-an', '-f', 'null', '-'], {
        maxBuffer: 1 << 26,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      if (e instanceof ToolMissing) throw e;
      out = e.stdout ? String(e.stdout) : '';
    }
    return [...out.matchAll(/pts_time:([0-9.]+)/g)].map((m) => +m[1]);
  }
  const windowed = (frames, win) => {
    const [a, b] = win || [0, 1];
    const lo = Math.floor(a * frames.length);
    const hi = Math.ceil(b * frames.length);
    return frames.slice(lo, Math.max(lo + 1, hi));
  };
  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  const CHECKS = {
    files(c) {
      const f = glob(c.glob);
      if (c.min != null && f.length < c.min) (f.length === 0 ? failAbsent : fail)(c, `${c.glob}: found ${f.length}, the spec requires at least ${c.min}`);
      if (c.max != null && f.length > c.max) fail(c, `${c.glob}: found ${f.length}, the spec allows at most ${c.max}`);
      if (!f.length && c.min == null) failAbsent(c, `${c.glob}: nothing matched. The gate cannot pass on an empty set.`);
      notes.push(`${c.glob}: ${f.length} file(s)`);
    },
    /* `requires` and `forbids` act on whatever the glob matched. Pair them with a `files` check
     * when the files themselves must exist; that check is what reports an empty set. */
    requires(c) {
      for (const f of glob(c.glob)) {
        let t = '';
        try {
          t = fs.readFileSync(f, 'utf8');
        } catch {
          continue;
        }
        for (const p of c.patterns || []) if (!new RegExp(p, 'i').test(t)) fail(c, `${rel(f)} is missing required pattern /${p}/i`);
      }
    },
    forbids(c) {
      for (const f of glob(c.glob)) {
        let t = '';
        try {
          t = fs.readFileSync(f, 'utf8');
        } catch {
          continue;
        }
        for (const p of c.patterns || []) if (new RegExp(p, 'i').test(t)) fail(c, `${rel(f)} contains banned pattern /${p}/i`);
      }
    },
    pairedFile(c) {
      for (const f of glob(c.glob)) {
        if (!fs.existsSync(f.replace(/\.[^.]+$/, c.ext))) fail(c, `${rel(f)}: required companion ${c.ext} is missing`);
      }
    },
    /* The output must DECLARE how it was made, and the declaration is checked. This makes an
     * invisible process choice, like a browser zoom, gateable at all. */
    sidecar(c) {
      const mf = path.join(ROOT, c.manifest);
      if (!fs.existsSync(mf)) {
        const report = c.glob && glob(c.glob).length === 0 ? failAbsent : fail;
        return report(c, `${c.manifest} is missing, so how the output was made cannot be verified. An undeclared capture fails closed.`);
      }
      let m;
      try {
        m = readJson(mf);
      } catch (e) {
        return fail(c, `${c.manifest}: unreadable (${e.message})`);
      }
      const got = String(c.field).split('.').reduce((o, k) => (o == null ? o : o[k]), m);
      if (got === undefined) return fail(c, `${c.manifest}: field "${c.field}" not declared`);
      if (c.equals !== undefined && JSON.stringify(got) !== JSON.stringify(c.equals)) fail(c, `${c.manifest}: ${c.field} = ${JSON.stringify(got)}, the spec requires ${JSON.stringify(c.equals)}`);
      notes.push(`${c.manifest}: ${c.field} = ${JSON.stringify(got)}`);
    },
    media(c) {
      const files = glob(c.glob);
      if (!files.length && c.optional) return notes.push(`${c.glob}: none present (optional role)`);
      if (!files.length) return failAbsent(c, `${c.glob}: no media to check`);
      for (const f of files) {
        const n = rel(f);
        const v = kv(ffprobe(f, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,pix_fmt']));
        const fm = kv(ffprobe(f, ['-show_entries', 'format=duration,size']));
        if (!v.width) {
          fail(c, `${n}: ffprobe read no video stream`);
          continue;
        }
        const w = +v.width;
        const h = +v.height;
        const fps = v.r_frame_rate?.includes('/') ? +v.r_frame_rate.split('/')[0] / +v.r_frame_rate.split('/')[1] : +v.r_frame_rate;
        const dur = +fm.duration;
        const size = +fm.size;
        const aud = (ffprobe(f, ['-select_streams', 'a', '-show_entries', 'stream=index']).match(/index=/g) || []).length;
        if (c.width && w !== c.width) fail(c, `${n}: width ${w}, the spec says ${c.width}`);
        if (c.height && h !== c.height) fail(c, `${n}: height ${h}, the spec says ${c.height}`);
        if (c.fps && Math.abs(fps - c.fps) > 0.51) fail(c, `${n}: ${fps.toFixed(2)}fps, the spec says ${c.fps}`);
        if (c.pixFmt && v.pix_fmt !== c.pixFmt) fail(c, `${n}: pix_fmt ${v.pix_fmt}, the spec says ${c.pixFmt}`);
        if (c.audioStreams != null && aud !== c.audioStreams) fail(c, `${n}: ${aud} audio stream(s), the spec says ${c.audioStreams}`);
        if (c.maxBytes && size > c.maxBytes) fail(c, `${n}: ${(size / 1048576).toFixed(2)}MB, the spec allows ${(c.maxBytes / 1048576).toFixed(2)}MB`);
        if (c.durationSec) {
          if (c.durationSec.min != null && dur < c.durationSec.min - 0.05) fail(c, `${n}: ${dur.toFixed(2)}s, the spec minimum is ${c.durationSec.min}s`);
          if (c.durationSec.max != null && dur > c.durationSec.max + 0.05) fail(c, `${n}: ${dur.toFixed(2)}s, the spec maximum is ${c.durationSec.max}s`);
        }
        notes.push(`${n}: ${w}x${h} ${dur.toFixed(2)}s ${fps.toFixed(0)}fps ${v.pix_fmt} ${aud} audio, ${(size / 1024).toFixed(0)}KB`);
      }
    },
    /** Two clips that are the same shot are one clip shipped twice. Compared on real pixels. */
    distinct(c) {
      const files = glob(c.glob);
      if (files.length < 2) return;
      const sigs = files.map((f) => {
        try {
          return run('ffmpeg', ['-v', 'error', '-i', f, '-vf', 'scale=32:18,format=gray', '-frames:v', '1', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
        } catch (e) {
          if (e instanceof ToolMissing) throw e;
          return null;
        }
      });
      const floor = c.minMeanDelta ?? 6;
      for (let i = 0; i < files.length; i++) {
        for (let j = i + 1; j < files.length; j++) {
          if (!sigs[i] || !sigs[j]) continue;
          const n = Math.min(sigs[i].length, sigs[j].length);
          let diff = 0;
          for (let k = 0; k < n; k++) diff += Math.abs(sigs[i][k] - sigs[j][k]);
          if (diff / n < floor) fail(c, `${rel(files[i])} and ${rel(files[j])} are the same shot (mean pixel delta ${(diff / n).toFixed(1)}, floor ${floor})`);
        }
      }
    },
    frameFill(c) {
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const R = rawFrames(f, { fps: c.sampleFps ?? 2 });
        let bestW = 0;
        let bestH = 0;
        for (const fr of windowed(R.frames, c.window)) {
          const e = edgeBands(fr, R.w, R.h, c.uniformTol ?? 3);
          bestW = Math.max(bestW, e.fillW);
          bestH = Math.max(bestH, e.fillH);
        }
        if (c.minFillW && bestW < c.minFillW) fail(c, `${n}: the widest frame still leaves a uniform vertical gutter; the picture fills ${(bestW * 100).toFixed(1)}% of the frame width, the spec says at least ${(c.minFillW * 100).toFixed(0)}%`);
        else if (c.minFillH && bestH < c.minFillH) fail(c, `${n}: the tallest frame still leaves a uniform horizontal band; the picture fills ${(bestH * 100).toFixed(1)}% of the frame height, the spec says at least ${(c.minFillH * 100).toFixed(0)}%`);
        notes.push(`${n}: the picture fills up to ${(bestW * 100).toFixed(1)}% x ${(bestH * 100).toFixed(1)}% of the frame`);
      }
    },
    luminance(c) {
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const ls = rawFrames(f, { fps: c.sampleFps ?? 2 }).frames.map(meanLuma);
        const mean = ls.reduce((s, x) => s + x, 0) / ls.length;
        const mx = Math.max(...ls);
        if (c.meanMin != null && mean < c.meanMin) fail(c, `${n}: mean luma ${mean.toFixed(1)}, the spec says at least ${c.meanMin}`);
        if (c.meanMax != null && mean > c.meanMax) fail(c, `${n}: mean luma ${mean.toFixed(1)}, the spec says at most ${c.meanMax}`);
        if (c.frameMax != null && mx > c.frameMax) fail(c, `${n}: a frame reaches luma ${mx.toFixed(1)}, the spec says at most ${c.frameMax} on every frame`);
        notes.push(`${n}: luma mean ${mean.toFixed(1)} (min ${Math.min(...ls).toFixed(1)}, max ${mx.toFixed(1)})`);
      }
    },
    /** The accent is a mark, never a field, and never absent either. */
    accentShare(c) {
      const target = hex2rgb(c.colour);
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const shares = rawFrames(f, { fps: c.sampleFps ?? 2, rgb: true }).frames.map((fr) => colourShare(fr, target, c.tolerance ?? 60));
        const sorted = [...shares].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        const mx = sorted[sorted.length - 1];
        if (c.perFrameMin != null && !shares.some((s) => s >= c.perFrameMin)) fail(c, `${n}: the accent ${c.colour} never reaches ${(c.perFrameMin * 100).toFixed(2)}% of a frame`);
        if (c.perFrameMax != null && mx > c.perFrameMax) fail(c, `${n}: the accent peaks at ${(mx * 100).toFixed(2)}% of a frame, the spec allows ${(c.perFrameMax * 100).toFixed(2)}%`);
        if (c.medianMax != null && med > c.medianMax) fail(c, `${n}: accent median ${(med * 100).toFixed(2)}%, the spec allows ${(c.medianMax * 100).toFixed(2)}%`);
        notes.push(`${n}: accent ${c.colour} median ${(med * 100).toFixed(2)}%, peak ${(mx * 100).toFixed(2)}%`);
      }
    },
    motionFloor(c) {
      const fps = c.sampleFps ?? 10;
      const pixEps = c.pixEps ?? 24;
      const eps = c.areaEps ?? 0.0008;
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const R = rawFrames(f, { fps, w: c.decodeWidth ?? 640 });
        if (R.frames.length < 3) {
          fail(c, `${n}: only ${R.frames.length} sampled frame(s), too short to measure motion`);
          continue;
        }
        const deltas = [];
        for (let i = 1; i < R.frames.length; i++) deltas.push(changedFrac(R.frames[i - 1], R.frames[i], pixEps));
        let runLen = 0;
        let worst = 0;
        let worstEnd = 0;
        deltas.forEach((d, i) => {
          runLen = d < eps ? runLen + 1 : 0;
          if (runLen > worst) [worst, worstEnd] = [runLen, i];
        });
        const frozen = worst / fps;
        const moving = deltas.filter((d) => d >= eps).length / deltas.length;
        if (c.maxFrozenSec != null && frozen > c.maxFrozenSec + 1e-9) fail(c, `${n}: frozen for ${frozen.toFixed(2)}s ending at t=${(worstEnd / fps).toFixed(1)}s, the spec allows ${c.maxFrozenSec}s`);
        if (c.minMovingFrac != null && moving < c.minMovingFrac) fail(c, `${n}: something moves in only ${(moving * 100).toFixed(1)}% of sampled intervals, the spec says at least ${(c.minMovingFrac * 100).toFixed(0)}%`);
        notes.push(`${n}: longest frozen run ${frozen.toFixed(2)}s, moving in ${(moving * 100).toFixed(1)}% of intervals`);
      }
    },
    textInk(c) {
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const R = rawFrames(f, { fps: c.sampleFps ?? 1, w: c.decodeWidth ?? 960 });
        let best = 0;
        let count = 0;
        for (const fr of windowed(R.frames, c.window)) {
          const { runs } = inkRuns(fr, R.w, R.h, c.region || {}, c.inkThresh ?? 55);
          if (!runs.length) continue;
          const srt = [...runs].sort((x, y) => x - y);
          const medRun = srt[srt.length >> 1] / R.h;
          if (medRun > best) [best, count] = [medRun, runs.length];
        }
        if (!best) {
          fail(c, `${n}: no text in region ${JSON.stringify(c.region)} during ${JSON.stringify(c.window || [0, 1])}`);
          continue;
        }
        if (c.minLines != null && count < c.minLines) fail(c, `${n}: only ${count} separated text line(s) in the region, the spec says at least ${c.minLines}`);
        if (c.minFracH != null && best < c.minFracH) fail(c, `${n}: the tallest median text line is ${(best * 100).toFixed(2)}% of the frame height, the spec says at least ${(c.minFracH * 100).toFixed(2)}%`);
        notes.push(`${n}: text ${(best * 100).toFixed(2)}% of the frame height, ${count} line(s)`);
      }
    },
    markPresent(c) {
      const T = loadTemplate(path.resolve(ROOT, c.template), c.templateWidth ?? 40);
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const R = rawFrames(f, { fps: c.sampleFps ?? 2, w: c.decodeWidth ?? 320 });
        for (const win of c.windows || [[0, 1]]) {
          let best = -1;
          for (const fr of windowed(R.frames, win)) best = Math.max(best, bestMatch(fr, R.w, R.h, T.tpl, T.tw, T.th));
          if (best < (c.minScore ?? 0.6)) fail(c, `${n}: the product mark scores ${best.toFixed(3)} at best in ${(win[0] * 100).toFixed(0)} to ${(win[1] * 100).toFixed(0)}% of the film, the spec says at least ${c.minScore ?? 0.6}`);
          notes.push(`${n}: mark best score ${best.toFixed(3)}`);
        }
      }
    },
    /* DECLARED SEAMS, VERIFIED AGAINST THE PIXELS. A scene detector finds zero cuts in a film whose
     * cuts join two shots of the same dark UI, so the composition declares its seams and each one
     * is verified as a real discontinuity, with no large undeclared one anywhere else. */
    cutCadence(c) {
      for (const f of glob(c.glob)) {
        const n = rel(f);
        const dur = +kv(ffprobe(f, ['-show_entries', 'format=duration'])).duration;
        let cuts;
        if (c.declaredIn) {
          const mf = path.join(ROOT, c.declaredIn);
          if (!fs.existsSync(mf)) {
            fail(c, `${c.declaredIn} is missing, so the seams cannot be verified. An undeclared cut list fails closed.`);
            continue;
          }
          let m;
          try {
            m = readJson(mf);
          } catch (e) {
            fail(c, `${c.declaredIn}: unreadable (${e.message})`);
            continue;
          }
          const got = (c.declaredField || 'seams').split('.').reduce((o, k) => (o == null ? o : o[k]), m);
          if (!Array.isArray(got)) {
            fail(c, `${c.declaredIn}: "${c.declaredField || 'seams'}" is not an array of cut times`);
            continue;
          }
          const decl = got
            .map((x) => (typeof x === 'object' ? x : { t: Number(x), kind: 'surface' }))
            .filter((x) => x.t > 0.05 && x.t < dur - 0.05)
            .sort((a, b) => a.t - b.t);
          cuts = decl.map((x) => x.t);
          const fps = c.verifyFps ?? 20;
          const pixEps = c.pixEps ?? 24;
          const shift = c.maxShiftPx ?? 12;
          const R = rawFrames(f, { fps, w: c.verifyWidth ?? 320 });
          const jumps = [];
          for (let i = 1; i < R.frames.length; i++) jumps.push(changedFrac(R.frames[i - 1], R.frames[i], pixEps));
          const at = (t) => Math.max(0, Math.min(jumps.length - 1, Math.round(t * fps) - 1));
          const resid = (t, r = 1) => {
            let best = 0;
            for (let i = Math.max(0, at(t) - r); i <= Math.min(jumps.length - 1, at(t) + r); i++) best = Math.max(best, unexplainedByShift(R.frames[i], R.frames[i + 1], R.w, R.h, pixEps, shift));
            return best;
          };
          const minJump = c.minCutJump ?? 0.06;
          const minTypeJump = c.minTypeCutJump ?? 0.004;
          for (const d of decl) {
            const v = resid(d.t);
            const floor = d.kind === 'type' ? minTypeJump : minJump;
            if (v < floor) fail(c, `${n}: the ${d.kind} seam declared at ${d.t.toFixed(2)}s leaves only ${(v * 100).toFixed(2)}% of the frame unexplained by any shift, the spec says at least ${(floor * 100).toFixed(2)}%`);
          }
          const undeclared = jumps
            .map((v, i) => ({ t: (i + 1) / fps, v }))
            .filter((x) => x.v >= minJump && !cuts.some((t) => Math.abs(t - x.t) < 0.3) && x.t > 0.3 && x.t < dur - 0.3)
            .filter((x) => resid(x.t, 0) >= minJump);
          if (undeclared.length) fail(c, `${n}: ${undeclared.length} undeclared discontinuity(ies), the first at ${undeclared[0].t.toFixed(2)}s`);
          notes.push(`${n}: ${decl.length} declared seam(s) verified`);
        } else {
          cuts = cutTimes(f, c.sceneThreshold ?? 0.3).filter((t) => t > 0.4 && t < dur - 0.4);
        }
        const bounds = [0, ...cuts, dur];
        const holds = bounds.slice(1).map((t, i) => t - bounds[i]);
        if (c.minCuts != null && cuts.length < c.minCuts) fail(c, `${n}: ${cuts.length} cut(s), the spec says at least ${c.minCuts}`);
        if (c.maxCuts != null && cuts.length > c.maxCuts) fail(c, `${n}: ${cuts.length} cut(s), the spec allows at most ${c.maxCuts}`);
        if (c.minHoldSec != null && holds.some((h) => h < c.minHoldSec - 1e-9)) fail(c, `${n}: a shot is held under ${c.minHoldSec}s (shortest ${Math.min(...holds).toFixed(2)}s)`);
        if (c.maxHoldSec != null && holds.some((h) => h > c.maxHoldSec + 1e-9)) fail(c, `${n}: a shot is held over ${c.maxHoldSec}s (longest ${Math.max(...holds).toFixed(2)}s)`);
        notes.push(`${n}: holds [${holds.map((h) => h.toFixed(2)).join(', ')}]`);
      }
    },
  };

  for (const c of checks) {
    const fn = CHECKS[c.kind];
    if (!fn) {
      fails.push({ quote: c.quote || '', msg: `unknown check kind "${c.kind}". An unknown kind fails; it is never skipped.`, kind: c.kind });
      continue;
    }
    try {
      fn(c);
    } catch (e) {
      if (e instanceof ToolMissing) {
        result.unchecked.push({ where: c.kind, why: e.message });
        continue;
      }
      fail(c, `the check threw: ${e.message}`);
    }
  }

  result.data = { spec: SPEC_PATH, source: spec.source || null, output: ROOT, checks: checks.length, violations: fails.length };
  result.notes.push(...notes);
  result.findings = fails.map((f) => ({
    id: `plan-${f.kind}`,
    severity: 'high',
    title: f.msg,
    detail: `The plan says: "${f.quote}"`,
    failing: true,
    absent: !!f.absent,
  }));
  if (result.unchecked.length) return result;
  if (!fails.length) {
    result.code = PASS;
    result.summary = `${checks.length} check(s) passed. The output matches the plan${spec.source ? ` (${spec.source})` : ''}.`;
  } else if (fails.every((f) => f.absent)) {
    result.code = NEVER;
    result.summary = `${fails.length} violation(s), and every one is "this was never produced". The spec is ahead of its output.`;
  } else {
    const nAbsent = fails.filter((f) => f.absent).length;
    result.code = FAIL;
    result.summary = `${fails.length} violation(s). The output does not match the plan${nAbsent ? ` (${fails.length - nAbsent} wrong, ${nAbsent} not produced)` : ''}. Fix the output, or change the plan in the open and say so.`;
  }
  return result;
}
