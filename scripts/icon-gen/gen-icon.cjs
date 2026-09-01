// 程序化生成应用图标（羊驼启动器 llama Launcher），零外部依赖。
// 圆角方牌(纯蓝系渐变，与 UI app-icon.svg 的 #appTile 渐变同色：#60a5fa→#2563eb→#1d4ed8，
// 2026-08-26 全站「移除彩虹、统一蓝色系」时随动) + 白色羊驼头部剪影(双耳+圆头+吻部)。
// 说明：不再绘制内耳——采样判定中外耳三角完全包含内耳，先判外耳会导致内耳永不渲染
// （旧版窗口图标实际无内耳，而 SVG 因画家算法会显示，造成两处图标不一致；小尺寸下内耳成脏点）。
// 输出多尺寸 PNG 与合成 icon.ico / icon.png，写入 apps/desktop/resources。
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const OUT = path.resolve(__dirname, '../../apps/desktop/resources');
// 标准 Windows ICO 尺寸上限 256：任务栏/Alt-Tab 最大只需 256，
// 且 ICO 中 256 以 width=0 哨兵表示，若再含 512 会产生重复 256 维度条目，
// 导致 rcedit 拒绝对内部 app exe 注入图标（任务栏回退为 electron 默认图标）。
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ---- 数学/颜色 ----
const lerp = (a, b, t) => a + (b - a) * t;
const lerpRGB = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const WHITE = [255, 255, 255];
// 品牌蓝渐变（与 UI app-icon.svg 的 appTile 完全同色，按 x 方向）
const BLUE = [
  [96, 165, 250],   // #60a5fa
  [37, 99, 235],    // #2563eb
  [29, 78, 216],    // #1d4ed8
];
const BLUE_STOPS = [0, 0.45, 1];
function blueAt(t) {
  for (let i = 0; i < BLUE_STOPS.length - 1; i++) {
    const s0 = BLUE_STOPS[i], s1 = BLUE_STOPS[i + 1];
    if (t <= s1) return lerpRGB(BLUE[i], BLUE[i + 1], (t - s0) / (s1 - s0));
  }
  return BLUE[BLUE.length - 1];
}

function inEllipse(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx, dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}
function inTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function inRoundedRect(x, y, rx0, ry0, w, h, r) {
  if (x < rx0 || x > rx0 + w || y < ry0 || y > ry0 + h) return false;
  const cx = x < rx0 + r ? rx0 + r : x > rx0 + w - r ? rx0 + w - r : x;
  const cy = y < ry0 + r ? ry0 + r : y > ry0 + h - r ? ry0 + h - r : y;
  const dx = x - cx, dy = y - cy;
  if (dx * dx + dy * dy > r * r) return false;
  return true;
}

// 羊驼剪影（基于 256 设计网格）
function llamaColor(x, y) {
  // 耳朵（两个尖三角，白色）
  if (inTriangle(x, y, 96, 38, 78, 116, 120, 112)) return WHITE;
  if (inTriangle(x, y, 160, 38, 178, 116, 136, 112)) return WHITE;
  // 头部椭圆
  if (inEllipse(x, y, 128, 158, 62, 66)) return WHITE;
  // 吻部/口鼻（略低、稍小）
  if (inEllipse(x, y, 128, 184, 40, 34)) return WHITE;
  return null;
}

function render(size) {
  const S = size;
  const m = S * 0.06, tile = S - 2 * m, radius = tile * 0.22;
  const out = Buffer.alloc(S * S * 4); // RGBA 全透明
  const SS = 4; // 超采样倍数，做抗锯齿
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * (256 / S);
          const y = (py + (sy + 0.5) / SS) * (256 / S);
          let col = null, a = 0;
          if (inRoundedRect(x, y, m * (256 / S), m * (256 / S), tile * (256 / S), tile * (256 / S), radius * (256 / S))) {
            const t = (x - m * (256 / S)) / (tile * (256 / S));
            col = blueAt(clamp01(t));
            a = 1;
          }
          const lc = llamaColor(x, y);
          if (lc) { col = lc; a = 1; }
          if (a > 0) { ar += col[0]; ag += col[1]; ab += col[2]; aa += 1; }
        }
      }
      const i = (py * S + px) * 4;
      if (aa > 0) {
        out[i] = Math.round(ar / aa);
        out[i + 1] = Math.round(ag / aa);
        out[i + 2] = Math.round(ab / aa);
        out[i + 3] = Math.round((aa / (SS * SS)) * 255);
      }
    }
  }
  return out;
}

// ---- PNG 编码 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---- ICO 编码（每帧直接内嵌 PNG，现代 Windows 支持） ----
function encodeICO(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(count * 16);
  let offset = 6 + count * 16;
  pngs.forEach((p, i) => {
    const size = p.size;
    entries[i * 16] = size >= 256 ? 0 : size;      // 宽度(256 记为 0)
    entries[i * 16 + 1] = size >= 256 ? 0 : size;  // 高度
    entries[i * 16 + 2] = 0; // 调色板
    entries[i * 16 + 3] = 0;
    entries[i * 16 + 4] = 1; // 平面数
    entries[i * 16 + 5] = 32; // bpp
    entries.writeUInt32LE(p.png.length, i * 16 + 8);
    entries.writeUInt32LE(offset, i * 16 + 12);
    offset += p.png.length;
  });
  return Buffer.concat([header, entries, ...pngs.map((p) => p.png)]);
}

// ---- 主流程 ----
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const pngs = SIZES.map((s) => {
  const rgba = render(s);
  const png = encodePNG(s, rgba);
  const file = path.join(OUT, `icon-${s}.png`);
  fs.writeFileSync(file, png);
  console.log('saved', file);
  return { size: s, png };
});

// icon.ico（按尺寸降序，256 放最后）
const ico = encodeICO([...pngs].sort((a, b) => a.size - b.size));
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico);
console.log('saved icon.ico');

// icon.png（256，供 Linux / 通用）
const big = pngs.find((p) => p.size === 256);
fs.writeFileSync(path.join(OUT, 'icon.png'), big.png);
console.log('saved icon.png');
