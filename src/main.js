import { shadowcast, lightWallDepth } from './shadowcast.js';
import { TILE, SPRITES, ALERT, buildLevel, stamp, dropShadow, drawFlame } from './art.js';

// ---------- マップ ----------
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

// 背景（床・壁・飾り）と壁松明の位置は art.js でコード生成する
const { bg, sconces } = buildLevel(MAP, W, H, 1337);

// ---------- 光源 ----------
const AMBIENT = [0.045, 0.05, 0.09];
const TORCH = [1.0 * 1.15, 0.80 * 1.15, 0.55 * 1.15];
const SCONCE = [1.0 * 0.8, 0.68 * 0.8, 0.40 * 0.8];
const MAGIC = [0.45, 0.75, 1.1];
const FOG_TINT = [0.30, 0.32, 0.40];

const $ = (id) => document.getElementById(id);
const opt = () => ({ banding: $('banding').checked, dilate: $('dilate').checked, tileMode: $('tileMode').checked });

function makeLight(x, y, radius, color, phase) {
  return { x, y, radius, color, phase, key: '', seen: new Uint8Array(N), band: new Float32Array(N), box: [0, 0, -1, -1] };
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

// 再計算したら所要時間（ms）を、キャッシュが効いたら -1 を返す
function updateLight(L, o) {
  const x = Math.round(L.x), y = Math.round(L.y);
  const key = `${x},${y},${L.radius},${o.banding},${o.dilate},${o.tileMode}`;
  if (key === L.key) return -1;                   // 記事の推奨: 光が別セルに移ったときだけ再計算
  L.key = key;
  const t0 = performance.now();
  castFrom(x, y, L.radius, L.seen, o);
  L.band.fill(0);
  const R = L.radius, x0 = Math.max(0, x - R - 6), x1 = Math.min(W - 1, x + R + 6);
  const y0 = Math.max(0, y - R - 6), y1 = Math.min(H - 1, y + R + 6);
  L.box = [x0, y0, x1, y1];
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const i = py * W + px;
    if (!L.seen[i]) continue;
    let t = Math.min(1, Math.max(0, 1 - Math.hypot(px - x, py - y) / R)) ** 0.8;
    if (o.banding) t = Math.ceil(t * 6) / 6;        // 6 段階のフラットな帯
    L.band[i] = t;
  }
  return performance.now() - t0;
}

// ---------- ゲーム状態 ----------
const player = { x: 3 * TILE + 8, y: 2 * TILE + 8, facing: 1, moving: false, walkT: 0 };
const torch = makeLight(player.x, player.y, 92, TORCH, 0);
const wallTorches = sconces.map((s, k) => makeLight(s.lightX, s.lightY, 60, SCONCE, 1 + k * 2.3));
const braziers = [];
const explored = new Uint8Array(N);
window.demo = { player, explored, sconces };              // デバッグ用（コンソールから位置を動かせる）

const ENEMY_RANGE = 72;
const enemies = [
  [1, 7, 25, 7], [11, 12, 30, 12], [14, 1, 14, 16],
].map(([ax, ay, bx, by], k) => {
  const a = { x: ax * TILE + 8, y: ay * TILE + 8 }, b = { x: bx * TILE + 8, y: by * TILE + 8 };
  for (let s = 0; s <= 1; s += 0.01) {
    const px = Math.round(a.x + (b.x - a.x) * s), py = Math.round(a.y + (b.y - a.y) * s);
    if (walls[py * W + px]) console.warn(`enemy ${k} patrol crosses a wall at`, px, py);
  }
  return { a, b, s: k * 0.3, dir: 1, speed: 26 + k * 6, x: a.x, y: a.y, phase: k * 1.7, sees: false, sight: new Uint8Array(N) };
});

// 火の粉
const embers = [];
function spawnEmbers(x, y, dt, rate) {
  if (Math.random() < rate * dt) {
    const life = 0.5 + Math.random() * 0.8;
    // 見えている炎から出た火の粉なので、壁の上など視界の外へ舞い上がっても描く
    embers.push({ x: x + (Math.random() - 0.5) * 2, y: y - 3, vx: (Math.random() - 0.5) * 8, vy: -(12 + Math.random() * 14), life, max: life, fromVisible: true });
  }
}

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
const accR = new Float32Array(N), accG = new Float32Array(N), accB = new Float32Array(N);
const emissive = [];
let prev = performance.now(), fps = 60, enemyMs = 0, composeMs = 0, lastCastMs = 0;

function tick(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  const t = now / 1000;
  const o = opt();

  // 移動
  let mx = 0, my = 0;
  if (keys.has('a') || keys.has('arrowleft')) mx--;
  if (keys.has('d') || keys.has('arrowright')) mx++;
  if (keys.has('w') || keys.has('arrowup')) my--;
  if (keys.has('s') || keys.has('arrowdown')) my++;
  const len = Math.hypot(mx, my) || 1, sp = 72 * dt;
  const ox = player.x, oy = player.y;
  if (!blocked(player.x + mx / len * sp, player.y)) player.x += mx / len * sp;
  if (!blocked(player.x, player.y + my / len * sp)) player.y += my / len * sp;
  player.moving = player.x !== ox || player.y !== oy;
  if (mx) player.facing = Math.sign(mx);
  player.walkT = player.moving ? player.walkT + dt : 0;

  // 光とフォグ
  torch.x = player.x; torch.y = player.y;
  const ms = updateLight(torch, o);
  if (ms >= 0) { lastCastMs = ms; for (let i = 0; i < N; i++) explored[i] |= torch.seen[i]; }
  for (const L of wallTorches) updateLight(L, o);
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
  emissive.length = 0;
  // 壁松明の炎は壁の中にあり膨張処理でも届かないことがあるので、真下の床（光源の位置）が見えていれば描く
  const flames = wallTorches
    .map((L, k) => ({ x: sconces[k].flameX, y: sconces[k].flameY, phase: L.phase, shown: vis[sconces[k].lightY * W + sconces[k].lightX] === 1 }))
    .filter((f) => f.shown);
  for (const b of braziers) {
    const bx = Math.round(b.x), by = Math.round(b.y);
    dropShadow(frame, W, H, bx, by + 4, 3, 1.2);
    const bob = Math.round(Math.sin(t * 2.5 + b.phase));
    stamp(frame, W, H, SPRITES.lamp.slice(0, 5), bx - 3, by - 4 + bob, { emissive });
    stamp(frame, W, H, SPRITES.lamp.slice(5), bx - 3, by + 1);
  }
  const ordered = [...enemies.map((e) => ({ kind: 'enemy', e, y: e.y })), { kind: 'player', y: player.y }].sort((a, b) => a.y - b.y);
  for (const s of ordered) {
    if (s.kind === 'enemy') {
      const e = s.e, ex = Math.round(e.x), ey = Math.round(e.y);
      const rows = Math.floor(t * 3 + e.phase) % 2 ? SPRITES.slimeSquash : SPRITES.slimeTall;
      dropShadow(frame, W, H, ex, ey + 4, 5, 1.5);
      stamp(frame, W, H, rows, ex - 5, ey + 4 - rows.length, { recolor: e.sees ? ALERT : null });
      if (e.sees) {                                  // 頭上の「!」（発光）
        const top = ey + 4 - rows.length - 2;
        for (const dy of [-5, -4, -3, -1]) emissive.push((top + dy) * W + ex, 255, 220, 80);
      }
    } else {
      const px = Math.round(player.x), py = Math.round(player.y);
      const walking = player.moving && Math.floor(player.walkT * 8) % 2 === 1;
      const rows = walking ? SPRITES.playerWalk : SPRITES.playerIdle;
      dropShadow(frame, W, H, px, py + 5, 4, 1.5);
      stamp(frame, W, H, rows, px - 4, py + 5 - rows.length, { flip: player.facing < 0 });
      const hx = px + (player.facing > 0 ? 4 : -5), hy = py - 1;
      for (let k = 0; k < 3; k++) { const p = ((hy - k) * W + hx) * 4; frame[p] = 112; frame[p + 1] = 72; frame[p + 2] = 40; }
      flames.push({ x: hx, y: hy - 3, phase: 0 });
    }
  }

  // 光の合計: ambient + Σ light × color × flicker（各光源は届く範囲の矩形だけ足す）
  const tc = performance.now();
  accR.fill(AMBIENT[0]); accG.fill(AMBIENT[1]); accB.fill(AMBIENT[2]);
  for (const L of [torch, ...wallTorches, ...braziers]) {
    const f = $('flicker').checked
      ? 1 + 0.06 * Math.sin(t * 11 + L.phase) + 0.04 * Math.sin(t * 23.3 + L.phase * 2) + 0.03 * Math.sin(t * 37.1 + L.phase)
      : 1;
    const cr = L.color[0] * f, cg = L.color[1] * f, cb = L.color[2] * f, band = L.band;
    const [x0, y0, x1, y1] = L.box;
    for (let py = y0; py <= y1; py++) for (let i = py * W + x0, end = py * W + x1; i <= end; i++) {
      const v = band[i];
      if (v) { accR[i] += v * cr; accG[i] += v * cg; accB[i] += v * cb; }
    }
  }

  // 合成: lit = scene × 光の合計
  const d = out.data, fog = $('fog').checked;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    if (vis[i]) {
      d[p] = frame[p] * accR[i]; d[p + 1] = frame[p + 1] * accG[i]; d[p + 2] = frame[p + 2] * accB[i];
      if (showSight && sightMask[i]) { d[p] += 60; d[p + 1] *= 0.7; d[p + 2] *= 0.7; }
    } else if (fog && explored[i]) {
      const m = (bg[p] + bg[p + 1] + bg[p + 2]) / 3;   // 探索済み・視界外は灰青のモノクロ
      d[p] = m * FOG_TINT[0]; d[p + 1] = m * FOG_TINT[1]; d[p + 2] = m * FOG_TINT[2];
    } else {
      d[p] = d[p + 1] = d[p + 2] = 0;
    }
    d[p + 3] = 255;
  }

  // 発光するもの（結晶・「!」・炎・火の粉）は、ライティングの後に明るさそのままで描く
  for (let k = 0; k < emissive.length; k += 4) {
    const i = emissive[k];
    if (i < 0 || i >= N || !vis[i]) continue;
    d[i * 4] = emissive[k + 1]; d[i * 4 + 1] = emissive[k + 2]; d[i * 4 + 2] = emissive[k + 3];
  }
  for (const fl of flames) {
    drawFlame(d, null, W, H, fl.x, fl.y, t, fl.phase);
    spawnEmbers(fl.x, fl.y, dt, 2.5);
  }
  for (let k = embers.length - 1; k >= 0; k--) {
    const e = embers[k];
    e.life -= dt;
    if (e.life <= 0) { embers.splice(k, 1); continue; }
    e.vx += (Math.random() - 0.5) * 30 * dt;
    e.x += e.vx * dt; e.y += e.vy * dt;
    const x = Math.round(e.x), y = Math.round(e.y), i = y * W + x;
    if (x < 0 || y < 0 || x >= W || y >= H || (!vis[i] && !e.fromVisible)) continue;
    const a = e.life / e.max, p = i * 4;
    d[p] += 255 * a; d[p + 1] += (90 + 140 * a) * a; d[p + 2] += 30 * a;
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
    `光源            ${1 + wallTorches.length + braziers.length} 個\n` +
    `探索率          ${(ex / (N / 7) * 100).toFixed(1)} %\n` +
    `発見された      ${spotted ? `⚠ ${spotted} 体` : '—'}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
