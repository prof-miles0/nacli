// Unpacks whatever a device sends as its logcat: ZIP, gzip, tar or any
// nesting of them (e.g. .tar.gz), down to plain files.

import { gunzipSync, unzipSync } from "fflate";

export interface ArchiveFile {
  name: string;
  data: Uint8Array;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
const isTar = (b: Uint8Array) =>
  b.length >= 512 && String.fromCharCode(...b.subarray(257, 262)) === "ustar";

function cString(b: Uint8Array): string {
  const end = b.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? b.subarray(0, end) : b);
}

function untar(b: Uint8Array): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  for (let off = 0; off + 512 <= b.length; ) {
    const header = b.subarray(off, off + 512);
    if (header.every((x) => x === 0)) break;
    const prefix = cString(header.subarray(345, 500));
    const name = (prefix ? `${prefix}/` : "") + cString(header.subarray(0, 100));
    const size = Number.parseInt(cString(header.subarray(124, 136)).trim() || "0", 8);
    const type = String.fromCharCode(header[156]);
    const start = off + 512;
    // "0" or NUL are regular files; skip directories, links and pax headers.
    if (type === "0" || type === "\0") out.push({ name, data: b.subarray(start, start + size) });
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

export function unpackArchive(name: string, data: Uint8Array, depth = 0): ArchiveFile[] {
  if (depth > 4) return [{ name, data }];
  if (isZip(data)) {
    return Object.entries(unzipSync(data))
      .filter(([n]) => !n.endsWith("/"))
      .flatMap(([n, d]) => unpackArchive(n, d, depth + 1));
  }
  if (isGzip(data)) {
    // RotomNG names the download *.zip even when the device sent gzip.
    const inner = name.replace(/\.tgz$/i, ".tar").replace(/\.(gz|zip)$/i, ".log");
    return unpackArchive(inner, gunzipSync(data), depth + 1);
  }
  if (isTar(data)) return untar(data).flatMap((f) => unpackArchive(f.name, f.data, depth + 1));
  return [{ name, data }];
}
