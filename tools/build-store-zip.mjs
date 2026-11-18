#!/usr/bin/env node
// Builds the Chrome Web Store upload package: dist/simpl-<version>.zip
//
//   node tools/build-store-zip.mjs
//
// Only runtime files go in the zip (manifest.json sits at the zip root).
// Dev-only files (tools/, dist/, _metadata/, .git, node_modules, sync folders)
// are left out. Every file manifest.json references is checked before writing.
// No dependencies: uses Node's built-in zlib. Output is byte-for-byte
// reproducible (fixed timestamps, sorted entries).

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

// What ships. Top-level files by extension, plus these folders in full.
const TOP_LEVEL_EXTENSIONS = new Set([".json", ".js", ".css", ".html", ".md"]);
const INCLUDE_DIRS = ["icons", "licenses", "rules"];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const files = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && TOP_LEVEL_EXTENSIONS.has(path.extname(entry.name)) && !entry.name.startsWith(".")) {
    files.push(entry.name);
  }
}
for (const dir of INCLUDE_DIRS) {
  if (fs.existsSync(path.join(root, dir))) files.push(...walk(dir));
}
files.sort();

// Every path the manifest (or background.js) references must be present.
const referenced = new Set();
const add = (p) => p && referenced.add(p.replace(/^\.?\//, ""));
Object.values(manifest.icons || {}).forEach(add);
Object.values(manifest.action?.default_icon || {}).forEach(add);
add(manifest.action?.default_popup);
add(manifest.background?.service_worker);
add(manifest.options_page);
add(manifest.options_ui?.page);
for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(add);
for (const r of manifest.declarative_net_request?.rule_resources || []) add(r.path);
for (const war of manifest.web_accessible_resources || []) (war.resources || []).forEach(add);
// Loaded at runtime via chrome.runtime.getURL in background.js
const bg = fs.readFileSync(path.join(root, manifest.background.service_worker), "utf8");
for (const m of bg.matchAll(/["'`](rules\/[^"'`$]+\.json)["'`]/g)) add(m[1]);

const missing = [...referenced].filter((p) => !p.includes("*") && !files.includes(p));
if (missing.length) {
  console.error("Missing files referenced by the extension:\n  " + missing.join("\n  "));
  process.exit(1);
}

// Minimal zip writer (deflate, fixed DOS timestamp 2020-01-01 00:00).
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const chunks = [];
const central = [];
let offset = 0;
for (const name of files) {
  const data = fs.readFileSync(path.join(root, name));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);
  const nameBuf = Buffer.from(name, "utf8");

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  chunks.push(local, nameBuf, body);

  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(20, 4);
  cen.writeUInt16LE(20, 6);
  cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(method, 10);
  cen.writeUInt16LE(DOS_TIME, 12);
  cen.writeUInt16LE(DOS_DATE, 14);
  cen.writeUInt32LE(crc, 16);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28);
  cen.writeUInt32LE(0, 30); // extra len, comment len
  cen.writeUInt32LE(0, 34); // disk start, internal attrs
  cen.writeUInt32LE(0, 38); // external attrs
  cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `simpl-${manifest.version}.zip`);
fs.writeFileSync(outFile, Buffer.concat([...chunks, centralBuf, end]));

const size = fs.statSync(outFile).size;
console.log(`Wrote ${path.relative(root, outFile)} (${files.length} files, ${(size / 1024 / 1024).toFixed(2)} MB), version ${manifest.version}`);
