// 将羊驼图标（来自 icon.ico 的各尺寸 PNG）原地写入 exe 的 RT_ICON 资源。
// 关键约束：保持每个图标图像的【字节长度不变】（用 tEXt 块把 PNG 填充到目标长度），
// 因此无需改动资源目录 / RVA / GROUP_ICON 头部 —— 零结构风险。
// Windows 通过 RT_ICON 数据开头的 PNG 签名识别 PNG 图标（GROUP_ICON 的 bpp=32 与此一致）。
const fs = require('fs');
const zlib = require('zlib');

function parseExeIconImages(exePath) {
  const exe = fs.readFileSync(exePath);
  const rbuf = (o, l) => exe.subarray(o, o + l);
  const u16 = (o) => rbuf(o, 2).readUInt16LE(0);
  const u32 = (o) => rbuf(o, 4).readUInt32LE(0);
  const e_lfanew = u32(0x3c);
  const magic = u16(e_lfanew + 24);
  const isP = magic === 0x20b;
  const dataDir = e_lfanew + 24 + (isP ? 112 : 96);
  const resRVA = u32(dataDir + 16);
  const nSec = u16(e_lfanew + 6);
  const sb = e_lfanew + 24 + (isP ? 240 : 224);
  let rsrcRaw = -1;
  for (let i = 0; i < nSec; i++) {
    const s = sb + i * 40;
    const va = u32(s + 12), vsz = u32(s + 16), raw = u32(s + 20);
    if (resRVA >= va && resRVA < va + Math.max(vsz, 1)) { rsrcRaw = raw - va; break; }
  }
  const R2O = (rva) => rva + rsrcRaw;
  const RDIR = R2O(resRVA);
  const dir = (off) => {
    const o = RDIR + off; const ne = u16(o + 14);
    const e = [];
    for (let i = 0; i < ne; i++) { const eo = o + 16 + i * 8; e.push({ id: u32(eo), ptr: u32(eo + 4) }); }
    return e;
  };
  const data = (off) => { const o = RDIR + off; return { rva: u32(o), size: u32(o + 4) }; };
  const root = dir(0);
  const icon = root.find((e) => (e.id & 0x80000000) === 0 && e.id === 3);
  if (!icon) return [];
  const sub = dir(icon.ptr & 0x7fffffff);
  const imgs = [];
  for (const e of sub) {
    let dp = e.ptr;
    if (dp & 0x80000000) { const l = dir(dp & 0x7fffffff)[0]; dp = l.ptr; if (dp & 0x80000000) dp = dir(dp & 0x7fffffff)[0].ptr; }
    const d = data(dp);
    const blob = rbuf(R2O(d.rva), d.size);
    let w = 0, h = 0;
    if (blob[0] === 0x89 && blob[1] === 0x50) { w = blob.readUInt32BE(16); h = blob.readUInt32BE(20); }
    else if (blob[0] === 0x28) { w = blob.readUInt32LE(4); h = blob.readUInt32LE(8) / 2; }
    imgs.push({ id: e.id, w, h, size: d.size, offset: R2O(d.rva) });
  }
  return imgs;
}

function parseIcoPngs(icoPath) {
  const ico = fs.readFileSync(icoPath);
  const cnt = ico.readUInt16LE(4);
  const map = new Map();
  for (let i = 0; i < cnt; i++) {
    const eo = 6 + i * 16;
    const w = ico[eo] === 0 ? 256 : ico[eo];
    const len = ico.readUInt32LE(eo + 8);
    const off = ico.readUInt32LE(eo + 12);
    if (ico[off] !== 0x89) continue; // 仅取 PNG 帧
    map.set(w, ico.subarray(off, off + len));
  }
  return map;
}

// 用 tEXt 块把 PNG 填充到 targetLen（合法 PNG，Windows 会忽略 tEXt）。
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function padPngTo(png, targetLen) {
  if (png.length === targetLen) return png;
  if (png.length > targetLen) throw new Error(`PNG ${png.length} > target ${targetLen}`);
  if (png.length < 12) throw new Error('PNG too small to pad');
  // 拆出 IEND 之前的部分（sig+IHDR+IDAT...），插入 tEXt 后再接 IEND
  const iendOff = png.length - 12; // IEND = len(4)+'IEND'(4)+crc(4)
  const head = png.subarray(0, iendOff);
  const iend = png.subarray(iendOff);
  const payloadLen = targetLen - png.length - 12;
  const type = Buffer.from('tEXt', 'ascii');
  const payload = Buffer.alloc(payloadLen);
  Buffer.from('llama').copy(payload, 0);
  const data = Buffer.concat([type, payload]);
  const chunk = Buffer.alloc(12 + payloadLen);
  chunk.writeUInt32BE(payloadLen, 0);
  type.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(data), 8 + payloadLen);
  return Buffer.concat([head, chunk, iend]);
}

function injectIcon(exePath, icoPath) {
  const imgs = parseExeIconImages(exePath);
  const pngs = parseIcoPngs(icoPath);
  if (imgs.length === 0) { console.warn('[inject-icon] no RT_ICON found'); return false; }
  const fd = fs.openSync(exePath, 'r+');
  try {
    let replaced = 0;
    for (const img of imgs) {
      const src = pngs.get(img.w) || pngs.get(img.h);
      if (!src) { console.warn(`[inject-icon] no llama PNG for size ${img.w}`); continue; }
      const out = padPngTo(Buffer.from(src), img.size);
      if (out.length !== img.size) throw new Error(`padded length ${out.length} != ${img.size}`);
      fs.writeSync(fd, out, 0, out.length, img.offset);
      replaced++;
      console.log(`[inject-icon] replaced ${img.w}x${img.h} (${img.size} bytes)`);
    }
    return replaced > 0;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { injectIcon, parseExeIconImages, parseIcoPngs };

if (require.main === module) {
  const exe = process.argv[2];
  const ico = process.argv[3];
  if (!exe || !ico) { console.error('usage: node inject-icon.cjs <exe> <icon.ico>'); process.exit(2); }
  injectIcon(exe, ico);
  console.log('done');
}
