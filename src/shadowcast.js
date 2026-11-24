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
export function lightWallDepth(seen, walls, w, h, n) {
  let cur = seen.slice();
  let next = new Uint8Array(w * h);
  for (let it = 0; it < n; it++) {
    next.set(cur);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (cur[i]) continue;
        if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) ||
            (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1;
      }
    }
    [cur, next] = [next, cur];
  }
  for (let i = 0; i < seen.length; i++) if (cur[i] && walls[i]) seen[i] = 1;
  return seen;
}
