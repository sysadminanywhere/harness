import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const iconDir = path.join(root, 'build', 'icons');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function roundedStroke(x, y, x0, y0, x1, y1, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (length * length)));
  const px = x0 + t * dx;
  const py = y0 + t * dy;
  return Math.hypot(x - px, y - py) <= width / 2;
}

function png(size, variant = 'app') {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 512;
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels.set(color, offset);
  };
  const lime = [205, 251, 120, 255];
  const white = [233, 236, 230, 255];
  const dark = [23, 26, 25, 255];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = (x + 0.5) / scale;
      const sy = (y + 0.5) / scale;
      const edge = 34;
      const radius = 92;
      const inside = sx >= edge && sx < 512 - edge && sy >= edge && sy < 512 - edge &&
        (sx >= edge + radius || sx < 512 - edge - radius || sy >= edge + radius || sy < 512 - edge - radius ||
          Math.hypot(Math.max(edge + radius - sx, 0, sx - (512 - edge - radius)), Math.max(edge + radius - sy, 0, sy - (512 - edge - radius))) <= radius);
      if (!inside) continue;
      let color = dark;
      const strokeWidth = 66;
      const leftStem = sx >= 145 - strokeWidth / 2 && sx <= 145 + strokeWidth / 2 && sy >= 150 && sy <= 365;
      const shoulder = roundedStroke(sx, sy, 145, 230, 295, 230, strokeWidth);
      const rightStem = sx >= 295 - strokeWidth / 2 && sx <= 295 + strokeWidth / 2 && sy >= 230 && sy <= 365;
      const dot = variant === 'app' && Math.hypot(sx - 365, sy - 350) <= 32;
      const installerArrow = variant === 'installer' && (
        roundedStroke(sx, sy, 365, 170, 365, 320, 34) ||
        roundedStroke(sx, sy, 320, 275, 365, 320, 34) ||
        roundedStroke(sx, sy, 410, 275, 365, 320, 34) ||
        roundedStroke(sx, sy, 300, 365, 430, 365, 34)
      );
      if (leftStem || shoulder || rightStem) color = white;
      if (dot || installerArrow) color = lime;
      set(x, y, color);
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size === 256 ? 0 : image.size;
    entry[1] = entry[0];
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

function icns(images) {
  const chunks = images.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const result = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(result.length + 8, 4);
  return Buffer.concat([header, result]);
}

fs.mkdirSync(iconDir, { recursive: true });
const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const images = sizes.map((size) => ({ size, data: png(size, 'app') }));
const installerImages = sizes.map((size) => ({ size, data: png(size, 'installer') }));
for (const image of images) fs.writeFileSync(path.join(iconDir, `${image.size}x${image.size}.png`), image.data);
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico(images.filter(({ size }) => size <= 256)));
fs.writeFileSync(path.join(root, 'build', 'installer.ico'), ico(installerImages.filter(({ size }) => size <= 256)));
fs.writeFileSync(path.join(root, 'build', 'icon.icns'), icns([
  { type: 'ic07', data: images.find(({ size }) => size === 128).data },
  { type: 'ic08', data: images.find(({ size }) => size === 256).data },
  { type: 'ic09', data: images.find(({ size }) => size === 512).data },
]));
fs.writeFileSync(path.join(root, 'build', 'installer.icns'), icns([
  { type: 'ic07', data: installerImages.find(({ size }) => size === 128).data },
  { type: 'ic08', data: installerImages.find(({ size }) => size === 256).data },
  { type: 'ic09', data: installerImages.find(({ size }) => size === 512).data },
]));
console.log(`Created Harness Lab icons in ${path.relative(root, path.join(root, 'build'))}`);
