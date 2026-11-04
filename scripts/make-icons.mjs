// Uygulama ikonlarını üretir (bağımlılıksız PNG kodlayıcı). Kullanım: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x / size, y / size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BG = [14, 17, 22], RING = [42, 49, 60], GREEN = [46, 160, 67], AMBER = [210, 153, 34], BLUE = [88, 166, 255];
function radar(pad) {
  return (u, v) => {
    const x = (u - 0.5) / (0.5 - pad), y = (v - 0.5) / (0.5 - pad);
    const r = Math.hypot(x, y);
    if (pad === 0 && r > 1.0) return [0, 0, 0, 0];
    let col = BG;
    for (const rr of [0.35, 0.65, 0.95]) if (Math.abs(r - rr) < 0.025) col = RING;
    if (Math.abs(x) < 0.012 && r < 0.95 || Math.abs(y) < 0.012 && r < 0.95) col = RING;
    const ang = Math.atan2(y, x);
    if (r < 0.95 && ang > -1.6 && ang < -0.6) col = col.map((c, i) => Math.round(c * 0.7 + BLUE[i] * 0.3 * (1 - r)));
    const dot = (cx, cy, rad, c) => (Math.hypot(x - cx, y - cy) < rad ? c : null);
    col = dot(0.32, -0.42, 0.1, GREEN) ?? dot(-0.45, 0.25, 0.08, AMBER) ?? dot(0.15, 0.55, 0.06, BLUE) ?? col;
    return [...col, 255];
  };
}
mkdirSync('icons', { recursive: true });
writeFileSync('icons/icon-192.png', png(192, radar(0.02)));
writeFileSync('icons/icon-512.png', png(512, radar(0.02)));
writeFileSync('icons/maskable-512.png', png(512, (u, v) => { const p = radar(0.14)(u, v); return p[3] ? p : [...BG, 255]; }));
console.log('ikonlar yazıldı');
