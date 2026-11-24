// 背景とスプライトを、画像ファイルを使わずにコードで生成する。
// すべてのピクセルを RGBA 配列に直接書き込む（キャンバスの描画 API は使わない）。

export const TILE = 16;

export function createRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
// 座標から決まる疑似乱数（レンガ1個ごとの色むらなど、場所に固定したい値に使う）
function hash(x, y, salt = 0) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------- パレットとスプライト ----------
// 1 文字 = 1 ピクセル、'.' は透明
export const PAL = {
  k: [22, 18, 28],                                   // 輪郭
  H: [44, 96, 70], h: [76, 146, 100],                // フード
  s: [236, 190, 150], e: [30, 20, 24],               // 肌・目
  c: [74, 62, 116], C: [48, 40, 82], b: [160, 108, 52], // 服・影・ベルト
  p: [64, 54, 50], o: [96, 62, 42],                  // ズボン・ブーツ
  g: [112, 62, 156], l: [182, 136, 222], G: [70, 36, 104], // スライム
  w: [240, 240, 240], q: [24, 10, 24],               // 白目・瞳
  r: [206, 52, 52], L: [255, 150, 130], R: [122, 26, 30], // 警戒中のスライム
  m: [92, 88, 102], M: [150, 146, 162],              // 金属
  x: [90, 170, 255], X: [180, 230, 255], y: [255, 255, 255], // 魔法の結晶（発光）
  B: [222, 214, 192], D: [150, 140, 122], z: [40, 30, 30],   // 骨
};
export const EMISSIVE = new Set(['x', 'X', 'y']);
export const ALERT = { g: 'r', l: 'L', G: 'R' };

const PLAYER_BODY = [
  '..kkkk..',
  '.kHhhhk.',
  'kHHHhhhk',
  'kHHsssek',
  '.kHHsssk',
  'kcccccck',
  'kcCcccck',
  'kCbbbbCk',
  'kcCcccck',
  '.kcCcck.',
];
export const SPRITES = {
  playerIdle: [...PLAYER_BODY, '.kpkkpk.', '.kokkok.'],
  playerWalk: [...PLAYER_BODY, 'kpk..kpk', 'kok..kok'],
  slimeTall: [
    '...kkkk...',
    '..kgllggk.',
    '.kglgggggk',
    'kgwqggwqgk',
    'kggggggggk',
    'kGggggggGk',
    '.kGGGGGGk.',
    '..kkkkkk..',
  ],
  slimeSquash: [
    '..kkkkkk..',
    '.kgllgggk.',
    'kglggggggk',
    'kgwqggwqgk',
    'kggggggggk',
    'kGGggggGGk',
    '.kkkkkkkk.',
  ],
  lamp: ['...X...', '..xXx..', '.xXyXx.', '..xXx..', '...x...', '..kmk..', '...m...', '..kMk..', '.kmmmk.'],
  skull: ['.BBB.', 'BzBzB', 'BBBBB', '.DBD.'],
  bones: ['B....B', '.BDDB.', 'B....B'],
};
for (const [name, rows] of Object.entries(SPRITES)) {
  rows.forEach((r, i) => { if (r.length !== rows[0].length) throw new Error(`sprite ${name} row ${i} width mismatch`); });
}

// スプライトを RGBA バッファに書き込む。flip で左右反転、recolor で文字を別の色に読み替える。
// emissive 配列を渡すと、発光する文字のピクセルを集めて返す（ライティング後に上書きするため）。
export function stamp(buf, W, H, rows, x0, y0, { flip = false, recolor = null, emissive = null } = {}) {
  const w = rows[0].length;
  for (let dy = 0; dy < rows.length; dy++) {
    const row = rows[dy];
    for (let dx = 0; dx < w; dx++) {
      let ch = row[dx];
      if (ch === '.') continue;
      if (recolor && recolor[ch]) ch = recolor[ch];
      const x = x0 + (flip ? w - 1 - dx : dx), y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const col = PAL[ch], i = y * W + x, p = i * 4;
      buf[p] = col[0]; buf[p + 1] = col[1]; buf[p + 2] = col[2];
      if (emissive && EMISSIVE.has(ch)) emissive.push(i, col[0], col[1], col[2]);
    }
  }
}

// 足元の楕円形の影
export function dropShadow(buf, W, H, cx, cy, rx, ry, k = 0.5) {
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++) {
      if ((dx / rx) ** 2 + (dy / ry) ** 2 > 1) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = (y * W + x) * 4;
      buf[p] *= k; buf[p + 1] *= k; buf[p + 2] *= k;
    }
  }
}

// 炎（発光するのでライティング後の出力に直接描く）。
// vis が null なら常に描き、配列ならそのピクセルが見えているときだけ描く。
const FLAME = { core: [255, 250, 220], yellow: [255, 214, 90], orange: [255, 140, 40], red: [210, 70, 30] };
export function drawFlame(out, vis, W, H, x, y, t, phase) {
  const put = (px, py, c, a = 1) => {
    if (px < 0 || py < 0 || px >= W || py >= H || (vis && !vis[py * W + px])) return;
    const p = (py * W + px) * 4;
    out[p] += (c[0] - out[p]) * a; out[p + 1] += (c[1] - out[p + 1]) * a; out[p + 2] += (c[2] - out[p + 2]) * a;
  };
  // 根元のほのかなにじみ
  for (let dy = -3; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d = Math.hypot(dx, dy * 1.2);
    if (d <= 3.2) put(x + dx, y + dy, FLAME.orange, 0.22 * (1 - d / 3.4));
  }
  const h = 4 + Math.round(1.2 * Math.sin(t * 13 + phase) + 0.8 * Math.sin(t * 29 + phase * 3));
  for (let k = 0; k < h; k++) {
    const r = k / h;
    const sway = Math.round(Math.sin(t * 8 + phase + k * 0.8) * r * 1.4);
    const half = r < 0.5 ? 1 : 0;
    for (let dx = -half; dx <= half; dx++) {
      const c = dx !== 0 ? FLAME.orange
        : r < 0.2 ? FLAME.core : r < 0.6 ? FLAME.yellow : r < 0.85 ? FLAME.orange : FLAME.red;
      put(x + dx + sway, y - k, c);
    }
  }
}

// ---------- レベルの背景 ----------
// 戻り値: { bg: RGBA の背景, sconces: 壁松明の位置（炎の位置と、光源を置く床の位置） }
export function buildLevel(map, W, H, seed = 1337) {
  const TW = map[0].length, TH = map.length;
  const wallTile = (tx, ty) => tx < 0 || ty < 0 || tx >= TW || ty >= TH || map[ty][tx] === '#';
  const wallPx = (x, y) => wallTile(Math.floor(x / TILE), Math.floor(y / TILE));
  const rnd = createRng(seed);
  const buf = new Uint8ClampedArray(W * H * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4; buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
  };
  const mul = (x, y, f) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4; buf[p] *= f; buf[p + 1] *= f; buf[p + 2] *= f;
  };
  const blend = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    buf[p] += (c[0] - buf[p]) * a; buf[p + 1] += (c[1] - buf[p + 1]) * a; buf[p + 2] += (c[2] - buf[p + 2]) * a;
  };

  // --- 床: 1 タイルを 1〜4 枚の石に分け、石ごとに面取り・色むら・ひびを付ける ---
  const drawFloorTile = (tx, ty) => {
    const x0 = tx * TILE, y0 = ty * TILE, u = rnd();
    let stones;
    if (u < 0.3) stones = [[0, 0, 16, 16]];
    else if (u < 0.65) { const s = [6, 8, 10][rnd() * 3 | 0]; stones = [[0, 0, 16, s], [0, s, 16, 16 - s]]; }
    else stones = [[0, 0, 8, 8], [8, 0, 8, 8], [0, 8, 8, 8], [8, 8, 8, 8]];
    for (const [sx, sy, sw, sh] of stones) {
      const base = 64 + rnd() * 18, warm = rnd() * 6;
      for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
        const x = x0 + sx + xx, y = y0 + sy + yy;
        if (xx === sw - 1 || yy === sh - 1) { set(x, y, 40, 36, 34); continue; }   // 目地
        let v = base + (rnd() - 0.5) * 7;
        if (yy === 0 || xx === 0) v += 12;                                        // 面取りのハイライト
        else if (yy === sh - 2 || xx === sw - 2) v -= 10;                         // 面取りの影
        set(x, y, v + warm + 4, v + warm * 0.5, v - 4);
      }
      if (rnd() < 0.16) {                                                         // ひび
        let cx = x0 + sx + 1 + (rnd() * (sw - 3) | 0), cy = y0 + sy + 1;
        const len = 4 + (rnd() * 6 | 0);
        for (let k = 0; k < len && cy < y0 + sy + sh - 1; k++) {
          mul(cx, cy, 0.55);
          cx = Math.min(x0 + sx + sw - 2, Math.max(x0 + sx, cx + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.6 ? 1 : 0)));
          cy += 1;
        }
      }
    }
    const nearWall = wallTile(tx - 1, ty) || wallTile(tx + 1, ty) || wallTile(tx, ty - 1) || wallTile(tx, ty + 1);
    if (rnd() < (nearWall ? 0.3 : 0.08)) {                                        // 目地に生えた苔
      const mx = x0 + (rnd() * 14 | 0), my = y0 + (rnd() * 14 | 0);
      for (let k = 0; k < 7; k++) {
        const px = mx + (rnd() * 5 | 0) - 2, py = my + (rnd() * 3 | 0) - 1;
        if (!wallPx(px, py)) set(px, py, ...(rnd() < 0.5 ? [58, 92, 48] : [84, 124, 60]));
      }
    }
  };

  // --- 壁: 上面（石のブロック）と、下が床なら手前のレンガ面 ---
  const faces = [];
  const drawWallTile = (tx, ty) => {
    const x0 = tx * TILE, y0 = ty * TILE;
    const face = !wallTile(tx, ty + 1);
    const topH = face ? 8 : 16;
    for (let yy = 0; yy < topH; yy++) for (let xx = 0; xx < 16; xx++) {
      const gx = x0 + xx, gy = y0 + yy;
      const tone = (hash(gx >> 3, gy >> 3, 7) - 0.5) * 10;
      let v = 56 + tone + (rnd() - 0.5) * 5;
      if ((gx & 7) === 0 || (gy & 7) === 0) v -= 7;                               // ブロックの継ぎ目
      set(gx, gy, v - 2, v, v + 16);
    }
    // 床と接する縁: 外側に濃い輪郭、内側にハイライト
    const edge = (cond, pts) => {
      if (!cond) return;
      for (const [x, y, dark] of pts) dark ? set(x, y, 22, 22, 32) : blend(x, y, [120, 122, 150], 0.55);
    };
    for (let k = 0; k < 16; k++) {
      if (k < topH) {
        edge(!wallTile(tx - 1, ty), [[x0, y0 + k, true], [x0 + 1, y0 + k, false]]);
        edge(!wallTile(tx + 1, ty), [[x0 + 15, y0 + k, true], [x0 + 14, y0 + k, false]]);
      }
      edge(!wallTile(tx, ty - 1), [[x0 + k, y0, true], [x0 + k, y0 + 1, false]]);
    }
    if (!face) return;
    for (let xx = 0; xx < 16; xx++) set(x0 + xx, y0 + topH - 1, 122, 124, 150); // 上面の縁（光が当たる）
    for (let r = 0; r < 8; r++) {
      const y = y0 + topH + r;
      for (let xx = 0; xx < 16; xx++) {
        const gx = x0 + xx;
        if (r === 0 || r === 4) { set(gx, y, 26, 24, 34); continue; }             // 縁の影・横目地
        const br = r < 4 ? 0 : 1, off = ((ty * 2 + br) & 1) * 4;
        if (((gx + off) & 7) === 7) { set(gx, y, 30, 28, 38); continue; }          // 縦目地
        const tone = hash((gx + off) >> 3, ty * 2 + br, 3) * 16;
        let v = 46 + tone;
        if (r === 1 || r === 5) v += 10;                                           // レンガ上端のハイライト
        v *= 1 - r * 0.035;
        if (r === 7) v *= 0.72;                                                    // 床との境目
        set(gx, y, v + 4, v, v + 12);
      }
    }
    faces.push({ tx, ty, x0, y0, topH });
  };

  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    if (wallTile(tx, ty)) drawWallTile(tx, ty); else drawFloorTile(tx, ty);
  }

  // --- 壁面の飾り: 壁松明・旗・苔のしずく ---
  const sconces = [];
  for (const f of faces) {
    const { tx, ty, x0, y0, topH } = f;
    const far = sconces.every((s) => Math.abs(s.tx - tx) + Math.abs(s.ty - ty) > 6);
    if (far && rnd() < 0.22) {
      const cx = x0 + 7, top = y0 + topH;
      set(cx - 1, top + 2, 150, 146, 162); set(cx, top + 2, 150, 146, 162); set(cx + 1, top + 2, 150, 146, 162);
      set(cx - 1, top + 1, 92, 88, 102); set(cx + 1, top + 1, 92, 88, 102);
      for (let k = 3; k <= 5; k++) set(cx, top + k, 92, 88, 102);
      set(cx - 1, top + 5, 70, 66, 80); set(cx + 1, top + 5, 70, 66, 80);
      // 光源は炎の位置ではなく真下の床に置く（壁の中に光源を置くと周囲 8 マスしか照らせないため）
      sconces.push({ tx, ty, flameX: cx, flameY: top + 1, lightX: cx, lightY: y0 + TILE });
    } else if (rnd() < 0.12) {
      const bx = x0 + 5, top = y0 + topH - 1;
      for (let xx = -1; xx < 7; xx++) set(bx + xx, top, 130, 120, 110);
      for (let r = 1; r < 8; r++) for (let xx = 0; xx < 6; xx++) {
        if (r === 7 && (xx < 2 || xx > 3)) continue;                              // 下端をとがらせる
        const edgeCol = xx === 0 || xx === 5;
        const c = edgeCol ? [92, 18, 28] : [148, 32, 42];
        set(bx + xx, top + r, ...c);
      }
      set(bx + 2, top + 3, 214, 170, 70); set(bx + 3, top + 3, 214, 170, 70);
      set(bx + 2, top + 4, 170, 130, 50); set(bx + 3, top + 4, 170, 130, 50);
    } else if (rnd() < 0.35) {
      const dx = x0 + 2 + (rnd() * 12 | 0), len = 1 + (rnd() * 3 | 0);
      for (let k = 0; k < len; k++) set(dx, y0 + topH + 1 + k, 62, 96 - k * 8, 52);
    }
  }

  // --- 床の飾り: じゅうたん・骨・小石・水たまり・クモの巣 ---
  const rug = { x0: 26, y0: 148, x1: 90, y1: 171 };
  for (let y = rug.y0; y <= rug.y1; y++) for (let x = rug.x0 - 2; x <= rug.x1 + 2; x++) {
    if (wallPx(x, y)) continue;
    if (x < rug.x0 || x > rug.x1) { if ((y & 1) === 0) set(x, y, 206, 192, 160); continue; } // 房
    const ix = x - rug.x0, iy = y - rug.y0, w = rug.x1 - rug.x0, h = rug.y1 - rug.y0;
    const border = ix === 2 || iy === 2 || ix === w - 2 || iy === h - 2;
    const cx = (rug.x0 + rug.x1) / 2, cy = (rug.y0 + rug.y1) / 2;
    const diamond = (Math.abs(x - cx) + Math.abs(y - cy) * 2) % 10 < 1;
    let c = [112, 28, 38];
    if (ix === 0 || iy === 0 || ix === w || iy === h) c = [70, 16, 24];
    else if (border) c = [196, 154, 66];
    else if (diamond) c = [160, 112, 50];
    const n = (rnd() - 0.5) * 10;
    set(x, y, c[0] + n, c[1] + n * 0.5, c[2] + n * 0.5);
  }
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    if (wallTile(tx, ty)) continue;
    const x0 = tx * TILE, y0 = ty * TILE;
    const onRug = x0 + 16 > rug.x0 - 2 && x0 < rug.x1 + 2 && y0 + 16 > rug.y0 && y0 < rug.y1;
    if (!onRug && rnd() < 0.035) stamp(buf, W, H, SPRITES.skull, x0 + 3 + (rnd() * 8 | 0), y0 + 3 + (rnd() * 8 | 0));
    else if (!onRug && rnd() < 0.05) stamp(buf, W, H, SPRITES.bones, x0 + 2 + (rnd() * 8 | 0), y0 + 3 + (rnd() * 9 | 0));
    const nearWall = wallTile(tx - 1, ty) || wallTile(tx + 1, ty) || wallTile(tx, ty - 1) || wallTile(tx, ty + 1);
    if (!onRug && nearWall && rnd() < 0.45) {                                     // 壁ぎわの小石
      for (let k = 2 + (rnd() * 3 | 0); k > 0; k--) {
        const px = x0 + 1 + (rnd() * 13 | 0), py = y0 + 1 + (rnd() * 13 | 0);
        set(px, py, 120, 114, 106); set(px + 1, py, 94, 88, 82);
        set(px, py + 1, 86, 80, 76); set(px + 1, py + 1, 70, 64, 60);
        mul(px, py + 2, 0.6); mul(px + 1, py + 2, 0.6);
      }
    }
    if (!onRug && rnd() < 0.03) {                                                 // 水たまり
      const cx = x0 + 8, cy = y0 + 8, rx = 4 + rnd() * 2, ry = 2 + rnd();
      for (let dy = -3; dy <= 3; dy++) for (let dx = -6; dx <= 6; dx++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 <= 1) blend(cx + dx, cy + dy, [36, 46, 66], 0.75);
      }
      set(cx - 2, cy - 1, 130, 150, 180); set(cx - 1, cy - 1, 100, 120, 150);
    }
    if (wallTile(tx, ty - 1) && wallTile(tx - 1, ty) && rnd() < 0.6) {           // 隅のクモの巣
      const web = [205, 205, 215];
      for (let k = 0; k < 7; k++) {
        blend(x0 + k, y0 + k, web, 0.45); blend(x0 + k, y0 + (k >> 1), web, 0.35); blend(x0 + (k >> 1), y0 + k, web, 0.35);
      }
      for (const rr of [3, 6]) for (let a = 0; a <= rr; a++) blend(x0 + a, y0 + rr - a, web, 0.3);
    }
  }

  // --- 接地の影（アンビエントオクルージョン）: 壁の根元の床を暗くする ---
  const UP = [0.5, 0.64, 0.78, 0.9], SIDE = [0.7, 0.86];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (wallPx(x, y)) continue;
    let f = 1;
    for (let d = 1; d <= 4; d++) if (wallPx(x, y - d)) { f = Math.min(f, UP[d - 1]); break; }
    for (let d = 1; d <= 2; d++) if (wallPx(x - d, y) || wallPx(x + d, y)) { f = Math.min(f, SIDE[d - 1]); break; }
    if (f < 1) mul(x, y, f);
  }

  for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
  return { bg: buf, sconces };
}
