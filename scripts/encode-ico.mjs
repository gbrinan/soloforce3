#!/usr/bin/env node
// Encodes a Windows .ico from a list of PNG files.
// Usage: node encode-ico.mjs <png1> <png2> ... <out.ico>
// PNGs must already be the desired physical resolution (square). The encoder
// stores each PNG inline (ICO PNG-form, supported by Vista+ / all modern Win).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("usage: encode-ico.mjs <png1> [...pngN] <out.ico>");
  process.exit(1);
}
const out = args.pop();
const pngs = args.map((p) => resolve(p));

function readPngSize(buf) {
  // PNG signature is 8 bytes; IHDR at offset 8 = length(4)+type(4)+w(4)+h(4)...
  // width  = bytes 16..19, height = bytes 20..23, big-endian.
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

const entries = pngs.map((p) => {
  const data = readFileSync(p);
  const { w, h } = readPngSize(data);
  return { data, w, h };
});

const headerSize = 6;
const dirEntrySize = 16;
const dirSize = entries.length * dirEntrySize;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // type = 1 (icon)
header.writeUInt16LE(entries.length, 4); // image count

let offset = headerSize + dirSize;
const dir = Buffer.alloc(dirSize);
entries.forEach((e, i) => {
  const base = i * dirEntrySize;
  dir.writeUInt8(e.w >= 256 ? 0 : e.w, base + 0); // width (0 = 256)
  dir.writeUInt8(e.h >= 256 ? 0 : e.h, base + 1); // height
  dir.writeUInt8(0, base + 2);                    // palette colors
  dir.writeUInt8(0, base + 3);                    // reserved
  dir.writeUInt16LE(1, base + 4);                 // color planes
  dir.writeUInt16LE(32, base + 6);                // bits per pixel
  dir.writeUInt32LE(e.data.length, base + 8);     // bytes in resource
  dir.writeUInt32LE(offset, base + 12);           // offset
  offset += e.data.length;
});

const blobs = entries.map((e) => e.data);
const ico = Buffer.concat([header, dir, ...blobs]);
writeFileSync(out, ico);
console.error(`[encode-ico] wrote ${out} (${entries.length} sizes, ${ico.length} bytes)`);
