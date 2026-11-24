// 再帰的シャドウキャスティング（Björn Bergström 方式）をスタックで反復実装したもの。
// walls: Uint8Array(w*h)  1 = 光を遮る。範囲外は壁として扱う。
// 戻り値: Uint8Array(w*h)  1 = 光源 (cx, cy) から見える。

const OCTANTS = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

export function shadowcast(walls, w, h, cx, cy, radius, out) {
  const seen = out ?? new Uint8Array(w * h);
  seen.fill(0);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return seen;
  seen[cy * w + cx] = 1;
  const r2 = radius * radius;

  for (const [xx, xy, yx, yy] of OCTANTS) {
    const stack = [[1, 1.0, 0.0]];
    while (stack.length) {
      let [row, start, end] = stack.pop();
      if (start < end) continue;
      let newStart = 0;
      for (let j = row; j <= radius; j++) {
        const dy = -j;
        let blocked = false;
        for (let dx = -j; dx <= 0; dx++) {
          const left = (dx - 0.5) / (dy + 0.5);
          const right = (dx + 0.5) / (dy - 0.5);
          if (start < right) continue;
          if (end > left) break;

          const x = cx + dx * xx + dy * xy;
          const y = cy + dx * yx + dy * yy;
          const inBounds = x >= 0 && y >= 0 && x < w && y < h;
          if (inBounds && dx * dx + dy * dy < r2) seen[y * w + x] = 1;
          const wall = !inBounds || walls[y * w + x] !== 0;

          if (blocked) {
            if (wall) { newStart = right; continue; }
            blocked = false;
            start = newStart;
          } else if (wall && j < radius) {
            blocked = true;
            stack.push([j + 1, start, left]);
            newStart = right;
          }
        }
        if (blocked) break;
      }
    }
  }
  return seen;
}

// scipy.ndimage.binary_dilation(seen, iterations=n) 相当（十字の構造要素 = マンハッタン距離 n）を
// 求め、壁ピクセルだけ seen に足す。壁の上面が「最初の1ピクセルだけ明るい」問題への対処。
//
// 膨張が届くのは見えている領域から距離 n 以内だけなので、見えている領域の外接矩形を
// n だけ広げた範囲だけを処理する（盤面全体を n 回なめるより大幅に速い）。
export function lightWallDepth(seen, walls, w, h, n) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) if (seen[row + x]) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0 || n <= 0) return seen;
  x0 = Math.max(0, x0 - n); y0 = Math.max(0, y0 - n);
  x1 = Math.min(w - 1, x1 + n); y1 = Math.min(h - 1, y1 + n);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  // 矩形の外には見えている画素がないので、矩形の外側は「見えていない」として扱ってよい
  let cur = new Uint8Array(bw * bh);
  let next = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) cur.set(seen.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + bw), y * bw);
  for (let it = 0; it < n; it++) {
    next.set(cur);
    for (let y = 0; y < bh; y++) {
      const row = y * bw;
      for (let x = 0; x < bw; x++) {
        const i = row + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < bw - 1 && cur[i + 1]) ||
            (y > 0 && cur[i - bw]) || (y < bh - 1 && cur[i + bw])) next[i] = 1;
      }
    }
    [cur, next] = [next, cur];
  }
  for (let y = 0; y < bh; y++) {
    const src = y * bw, dst = (y0 + y) * w + x0;
    for (let x = 0; x < bw; x++) if (cur[src + x] && walls[dst + x]) seen[dst + x] = 1;
  }
  return seen;
}
