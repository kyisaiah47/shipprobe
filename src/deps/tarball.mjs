/* A dependency-free reader for the gzipped ustar tarballs npm publishes. No shelling out to a
 * system `tar`, which a CI image or a serverless function does not always have.
 *
 * Only entries under PER_FILE_CAP are kept and reading stops past TOTAL_CAP decompressed, so a
 * package that bundles a large binary cannot run one check out of memory. Anything skipped for
 * size is listed rather than silently absent. */
import { gunzipSync } from 'node:zlib';

const PER_FILE_CAP = 400_000;
const TOTAL_CAP = 8_000_000;

function octal(buf) {
  const s = buf.toString('ascii').replace(/\0.*$/, '').trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

export function readTarball(gz) {
  const buf = gunzipSync(gz);
  const files = new Map();
  const skippedForSize = [];
  let offset = 0;
  let totalRead = 0;
  let truncated = false;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefixField = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = octal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 0);
    const name = prefixField ? `${prefixField}/${nameField}` : nameField;
    offset += 512;
    if ((typeflag === '0' || typeflag === '\0') && name) {
      if (totalRead + size > TOTAL_CAP) {
        skippedForSize.push(name);
        truncated = true;
      } else if (size > PER_FILE_CAP) {
        skippedForSize.push(name);
      } else {
        files.set(name, Buffer.from(buf.subarray(offset, offset + size)));
        totalRead += size;
      }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return { files, skippedForSize, truncated };
}

/** npm roots everything under `package/`. Stripped so callers ask for `package.json`. */
export function stripPackagePrefix(files) {
  const out = new Map();
  for (const [name, content] of files) out.set(name.replace(/^[^/]+\//, ''), content);
  return out;
}
