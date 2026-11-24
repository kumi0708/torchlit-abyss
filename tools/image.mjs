// 図を作るための小さな画像ユーティリティ（依存なし）。RGBA 配列を PNG に書き出す。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export class Img {
  constructor(w, h, fill = [0, 0, 0]) {
    this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4);
    this.fill(fill);
  }
  static from(data, w, h) { const im = new Img(w, h); im.data.set(data); return im; }
  fill(c) { for (let i = 0; i < this.data.length; i += 4) this.set1(i, c); return this; }
  set1(p, c, a = 1) {
    const d = this.data;
    d[p] += (c[0] - d[p]) * a; d[p + 1] += (c[1] - d[p + 1]) * a; d[p + 2] += (c[2] - d[p + 2]) * a; d[p + 3] = 255;
  }
  px(x, y, c, a = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.set1((y * this.w + x) * 4, c, a);
  }
  rect(x, y, w, h, c, a = 1) { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c, a); return this; }
  line(x0, y0, x1, y1, c, a = 1, thick = 1) {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
      for (let t = 0; t < thick; t++) for (let s = 0; s < thick; s++) this.px(x + t - (thick >> 1), y + s - (thick >> 1), c, a);
    }
    return this;
  }
  crop(x, y, w, h) {
    const out = new Img(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const sx = x + xx, sy = y + yy;
      if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
      const s = (sy * this.w + sx) * 4, d = (yy * w + xx) * 4;
      out.data[d] = this.data[s]; out.data[d + 1] = this.data[s + 1]; out.data[d + 2] = this.data[s + 2]; out.data[d + 3] = 255;
    }
    return out;
  }
  scale(k) {                                       // 最近傍で拡大（ドットをぼかさない）
    const out = new Img(this.w * k, this.h * k);
    for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
      const s = ((y / k | 0) * this.w + (x / k | 0)) * 4, d = (y * out.w + x) * 4;
      out.data[d] = this.data[s]; out.data[d + 1] = this.data[s + 1]; out.data[d + 2] = this.data[s + 2]; out.data[d + 3] = 255;
    }
    return out;
  }
  blit(src, x, y) {
    for (let yy = 0; yy < src.h; yy++) for (let xx = 0; xx < src.w; xx++) {
      const s = (yy * src.w + xx) * 4;
      this.px(x + xx, y + yy, [src.data[s], src.data[s + 1], src.data[s + 2]]);
    }
    return this;
  }
  // 3×5 のドットフォントで文字を描く（数字と一部の英字だけ）
  text(str, x, y, c, k = 1) {
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch];
      if (g) g.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === '#') this.rect(cx + rx * k, y + ry * k, k, k, c); }));
      cx += 4 * k;
    }
    return this;
  }
  save(path) {
    const { w, h, data } = this;
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w * 4 + 1)] = 0;
      Buffer.from(data.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
    ]));
  }
}

// 横に並べる
export function hcat(images, gap = 8, bg = [13, 14, 20]) {
  const w = images.reduce((s, im) => s + im.w, 0) + gap * (images.length - 1);
  const h = Math.max(...images.map((im) => im.h));
  const out = new Img(w, h, bg);
  let x = 0;
  for (const im of images) { out.blit(im, x, 0); x += im.w + gap; }
  return out;
}

const FONT = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['###', '..#', '###', '#..', '###'],
  3: ['###', '..#', '###', '..#', '###'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '###', '..#', '###'],
  6: ['###', '#..', '###', '#.#', '###'], 7: ['###', '..#', '..#', '..#', '..#'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '###'], A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
};
