import { shadowcast, lightWallDepth } from './shadowcast.js';

// ---------- マップ ----------
const TILE = 16;
const MAP = [
  '################################',
  '#......#..........#............#',
  '#......#..........#....##......#',
  '#..##.....####.........##......#',
  '#......#..........#............#',
  '#......#....##....######..######',
  '####.###....##.........#.......#',
  '#..........................#...#',
  '#......##.......#####..........#',
  '#......##.......#...#...####...#',
  '#...............#...#...#......#',
  '####..#####.....##.##...#..##..#',
  '#.........#....................#',
  '#..##.....#.........##.........#',
  '#.........#.....#...##....#....#',
  '#...............#..............#',
  '#..........##.........#........#',
  '################################',
];
const TW = MAP[0].length, TH = MAP.length;
MAP.forEach((r, i) => { if (r.length !== TW) throw new Error(`MAP row ${i} has ${r.length} cols`); });
const W = TW * TILE, H = TH * TILE, N = W * H;
const isWallTile = (tx, ty) => tx < 0 || ty < 0 || tx >= TW || ty >= TH || MAP[ty][tx] === '#';

// 遮蔽データ: タイル単位とピクセル単位の両方を持つ
const tileWalls = new Uint8Array(TW * TH);
const walls = new Uint8Array(N);
for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
  if (!isWallTile(tx, ty)) continue;
  tileWalls[ty * TW + tx] = 1;
  for (let y = 0; y < TILE; y++) walls.fill(1, (ty * TILE + y) * W + tx * TILE, (ty * TILE + y) * W + tx * TILE + TILE);
}

// ---------- 背景（ピクセルアートを手続き生成） ----------
let seed = 1337;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const bg = (() => {
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d');
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const x0 = tx * TILE, y0 = ty * TILE;
    if (!isWallTile(tx, ty)) {
      const v = 52 + rand() * 14 | 0;
      g.fillStyle = `rgb(${v + 6},${v},${v - 6})`; g.fillRect(x0, y0, TILE, TILE);
      g.fillStyle = `rgb(${v - 14},${v - 18},${v - 22})`;           // 石畳の目地
      g.fillRect(x0, y0 + 15, TILE, 1); g.fillRect(x0 + 15, y0, 1, TILE);
      g.fillRect(x0 + ((ty & 1) ? 7 : 3), y0 + 7, 1, 8); g.fillRect(x0, y0 + 7, TILE, 1);
      for (let k = 0; k < 6; k++) {                                   // 小石・ひび
        const d = rand() < 0.5 ? -16 : 12;
        g.fillStyle = `rgb(${v + d + 6},${v + d},${v + d - 6})`;
        g.fillRect(x0 + (rand() * 15 | 0), y0 + (rand() * 15 | 0), 1, 1);
      }
      if (rand() < 0.06) { g.fillStyle = '#4c5a34'; g.fillRect(x0 + 4, y0 + 10, 3, 2); g.fillRect(x0 + 5, y0 + 9, 1, 1); }
    } else {
      const front = !isWallTile(tx, ty + 1);                          // 下が床なら手前の壁面を描く
      g.fillStyle = '#5f6378'; g.fillRect(x0, y0, TILE, TILE);
      g.fillStyle = '#6c7088';
      for (let k = 0; k < 5; k++) g.fillRect(x0 + (rand() * 14 | 0), y0 + (rand() * 10 | 0), 2, 1);
      if (isWallTile(tx, ty - 1) === false) { g.fillStyle = '#7a7e96'; g.fillRect(x0, y0, TILE, 1); }
      if (front) {
        g.fillStyle = '#34374a'; g.fillRect(x0, y0 + 9, TILE, 7);
        g.fillStyle = '#272a39';
        g.fillRect(x0, y0 + 9, TILE, 1); g.fillRect(x0, y0 + 12, TILE, 1);
        for (let bx = (tx & 1) * 4; bx < TILE; bx += 8) g.fillRect(x0 + bx, y0 + 9, 1, 3);
        for (let bx = 4 - (tx & 1) * 4; bx < TILE; bx += 8) g.fillRect(x0 + bx, y0 + 12, 1, 4);
      }
    }
  }
  return g.getImageData(0, 0, W, H).data;
})();

// ---------- スプライト ----------
const PAL = { h: [60, 38, 26], s: [232, 186, 150], b: [70, 110, 200], d: [40, 60, 120], f: [255, 150, 40], F: [255, 230, 120],
  g: [120, 70, 150], G: [90, 50, 115], r: [210, 50, 50], R: [150, 30, 30], e: [240, 240, 240], p: [20, 10, 20],
  o: [90, 80, 70], m: [130, 120, 110], c: [120, 200, 255], C: [220, 250, 255] };
const SPRITES = {
  player: ['..hhh..', '.hsssh.', '..sss.F', '.bbbbbf', 'd.bbb.m', '..b.b..', '..d.d..'],
  enemy: ['..ggg..', '.ggggg.', 'gepgepg', 'ggggggg', 'GgGgGgG', 'G.G.G.G'],
  brazier: ['.C.C.', '.cCc.', 'ommmo', '.mmm.', '.m.m.'],
};
function stamp(buf, name, cx, cy, recolor) {
  const rows = SPRITES[name], x0 = Math.round(cx) - (rows[0].length >> 1), y0 = Math.round(cy) - (rows.length >> 1);
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
    if (ch === '.') return;
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const col = PAL[(recolor && recolor[ch]) || ch], i = (y * W + x) * 4;
    buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2];
  }));
}

// ---------- 光源 ----------
const AMBIENT = [0.045, 0.05, 0.09];
const TORCH = [1.0 * 1.15, 0.80 * 1.15, 0.55 * 1.15];
const MAGIC = [0.45, 0.75, 1.1];
const FOG_TINT = [0.30, 0.32, 0.40];

const $ = (id) => document.getElementById(id);
const opt = () => ({ banding: $('banding').checked, dilate: $('dilate').checked, tileMode: $('tileMode').checked });

function makeLight(x, y, radius, color, phase) {
  return { x, y, radius, color, phase, key: '', seen: new Uint8Array(N), band: new Float32Array(N) };
}

const tileSeen = new Uint8Array(TW * TH);
function castFrom(x, y, radius, out, o) {
  if (o.tileMode) {
    // 記事の「タイル単位の可視判定をピクセルに拡大すると壁を突き抜けて四角くなる」比較用
    shadowcast(tileWalls, TW, TH, Math.floor(x / TILE), Math.floor(y / TILE), Math.round(radius / TILE), tileSeen);
    for (let py = 0; py < H; py++) {
      const trow = (py / TILE | 0) * TW, row = py * W;
      for (let px = 0; px < W; px++) out[row + px] = tileSeen[trow + (px / TILE | 0)];
    }
  } else {
    shadowcast(walls, W, H, x, y, radius, out);
  }
  if (o.dilate) lightWallDepth(out, walls, W, H, 5);
  return out;
}

let lastCastMs = 0;
function updateLight(L, o) {
  const x = Math.round(L.x), y = Math.round(L.y);
  const key = `${x},${y},${L.radius},${o.banding},${o.dilate},${o.tileMode}`;
  if (key === L.key) return false;                // 記事の推奨: 光が別セルに移ったときだけ再計算
  L.key = key;
  const t0 = performance.now();
  castFrom(x, y, L.radius, L.seen, o);
  L.band.fill(0);
  const R = L.radius, x0 = Math.max(0, x - R - 6), x1 = Math.min(W - 1, x + R + 6);
  const y0 = Math.max(0, y - R - 6), y1 = Math.min(H - 1, y + R + 6);
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const i = py * W + px;
    if (!L.seen[i]) continue;
    let t = Math.min(1, Math.max(0, 1 - Math.hypot(px - x, py - y) / R)) ** 0.8;
    if (o.banding) t = Math.ceil(t * 6) / 6;        // 6 段階のフラットな帯
    L.band[i] = t;
  }
  lastCastMs = performance.now() - t0;
  return true;
}

// ---------- ゲーム状態 ----------
const player = { x: 3 * TILE + 8, y: 2 * TILE + 8 };
const torch = makeLight(player.x, player.y, 92, TORCH, 0);
const braziers = [];
const explored = new Uint8Array(N);

const ENEMY_RANGE = 72;
const enemies = [
  [1, 7, 25, 7], [11, 12, 30, 12], [14, 1, 14, 16],
].map(([ax, ay, bx, by], k) => {
  const a = { x: ax * TILE + 8, y: ay * TILE + 8 }, b = { x: bx * TILE + 8, y: by * TILE + 8 };
  for (let s = 0; s <= 1; s += 0.01) {
    const px = Math.round(a.x + (b.x - a.x) * s), py = Math.round(a.y + (b.y - a.y) * s);
    if (walls[py * W + px]) console.warn(`enemy ${k} patrol crosses a wall at`, px, py);
  }
  return { a, b, s: k * 0.3, dir: 1, speed: 26 + k * 6, x: a.x, y: a.y, sees: false, sight: new Uint8Array(N) };
});

const keys = new Set();
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); if (e.key.startsWith('Arrow')) e.preventDefault(); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
const blocked = (x, y) => {
  for (const [dx, dy] of [[-3, -3], [3, -3], [-3, 3], [3, 3], [0, 0]]) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= W || py >= H || walls[py * W + px]) return true;
  }
  return false;
};

const canvas = $('view'), ctx = canvas.getContext('2d');
canvas.addEventListener('click', (e) => {
  const r = canvas.getBoundingClientRect();
  const x = Math.round((e.clientX - r.left) * W / r.width), y = Math.round((e.clientY - r.top) * H / r.height);
  const hit = braziers.findIndex((b) => Math.hypot(b.x - x, b.y - y) < 8);
  if (hit >= 0) braziers.splice(hit, 1);
  else if (!walls[y * W + x] && braziers.length < 8) braziers.push(makeLight(x, y, 64, MAGIC, Math.random() * 10));
});
$('radius').addEventListener('input', (e) => { torch.radius = +e.target.value; $('radiusVal').textContent = e.target.value; });
$('resetFog').addEventListener('click', () => explored.fill(0));
$('clearLights').addEventListener('click', () => (braziers.length = 0));

// ---------- メインループ ----------
const frame = new Uint8ClampedArray(N * 4);
const out = ctx.createImageData(W, H);
const sightMask = new Uint8Array(N);
let prev = performance.now(), fps = 60, enemyMs = 0, composeMs = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const o = opt();

  // 移動
  let mx = 0, my = 0;
  if (keys.has('a') || keys.has('arrowleft')) mx--;
  if (keys.has('d') || keys.has('arrowright')) mx++;
  if (keys.has('w') || keys.has('arrowup')) my--;
  if (keys.has('s') || keys.has('arrowdown')) my++;
  const len = Math.hypot(mx, my) || 1, sp = 72 * dt;
  if (!blocked(player.x + mx / len * sp, player.y)) player.x += mx / len * sp;
  if (!blocked(player.x, player.y + my / len * sp)) player.y += my / len * sp;

  // 光とフォグ
  torch.x = player.x; torch.y = player.y;
  if (updateLight(torch, o)) for (let i = 0; i < N; i++) explored[i] |= torch.seen[i];
  for (const b of braziers) updateLight(b, o);
  const vis = torch.seen;                          // プレイヤーの視界 = 松明の届く範囲

  // 敵: 巡回し、自分の位置からキャストした視界でプレイヤーを探す
  const te = performance.now();
  const showSight = $('enemySight').checked;
  if (showSight) sightMask.fill(0);
  const pi = Math.round(player.y) * W + Math.round(player.x);
  for (const e of enemies) {
    const dist = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    e.s += e.dir * e.speed * dt / dist;
    if (e.s > 1 || e.s < 0) { e.dir *= -1; e.s = Math.min(1, Math.max(0, e.s)); }
    e.x = e.a.x + (e.b.x - e.a.x) * e.s; e.y = e.a.y + (e.b.y - e.a.y) * e.s;
    shadowcast(walls, W, H, Math.round(e.x), Math.round(e.y), ENEMY_RANGE, e.sight);
    e.sees = e.sight[pi] === 1;
    if (showSight) for (let i = 0; i < N; i++) sightMask[i] |= e.sight[i];
  }
  enemyMs = performance.now() - te;

  // スプライトを描いたフレーム（フォグ部分は背景のみを使うので敵の記憶は残らない）
  frame.set(bg);
  for (const b of braziers) stamp(frame, 'brazier', b.x, b.y);
  for (const e of enemies) stamp(frame, 'enemy', e.x, e.y, e.sees ? { g: 'r', G: 'R' } : null);
  stamp(frame, 'player', player.x, player.y);

  // 合成: lit = scene * (ambient + Σ light * color)
  const tc = performance.now(), t = now / 1000;
  const lights = [torch, ...braziers].map((L) => {
    const f = $('flicker').checked
      ? 1 + 0.06 * Math.sin(t * 11 + L.phase) + 0.04 * Math.sin(t * 23.3 + L.phase * 2) + 0.03 * Math.sin(t * 37.1)
      : 1;
    return { band: L.band, r: L.color[0] * f, g: L.color[1] * f, b: L.color[2] * f };
  });
  const d = out.data, fog = $('fog').checked;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    if (vis[i]) {
      let lr = AMBIENT[0], lg = AMBIENT[1], lb = AMBIENT[2];
      for (let k = 0; k < lights.length; k++) {
        const v = lights[k].band[i];
        if (v) { lr += v * lights[k].r; lg += v * lights[k].g; lb += v * lights[k].b; }
      }
      d[p] = frame[p] * lr; d[p + 1] = frame[p + 1] * lg; d[p + 2] = frame[p + 2] * lb;
      if (showSight && sightMask[i]) { d[p] += 60; d[p + 1] *= 0.7; d[p + 2] *= 0.7; }
    } else if (fog && explored[i]) {
      const m = (bg[p] + bg[p + 1] + bg[p + 2]) / 3;   // 探索済み・視界外は灰青のモノクロ
      d[p] = m * FOG_TINT[0]; d[p + 1] = m * FOG_TINT[1]; d[p + 2] = m * FOG_TINT[2];
    } else {
      d[p] = d[p + 1] = d[p + 2] = 0;
    }
    d[p + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  composeMs = performance.now() - tc;

  let ex = 0; for (let i = 0; i < N; i += 7) ex += explored[i];
  const spotted = enemies.filter((e) => e.sees).length;
  $('stats').textContent =
    `FPS            ${fps.toFixed(0)}\n` +
    `松明キャスト    ${lastCastMs.toFixed(2)} ms\n` +
    `敵の視線 x${enemies.length}    ${enemyMs.toFixed(2)} ms\n` +
    `合成            ${composeMs.toFixed(2)} ms\n` +
    `探索率          ${(ex / (N / 7) * 100).toFixed(1)} %\n` +
    `発見された      ${spotted ? `⚠ ${spotted} 体` : '—'}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
