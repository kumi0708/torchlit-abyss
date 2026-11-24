import { shadowcast } from './shadowcast.js';
import { SPRITES, ALERT, stamp, dropShadow, drawFlame } from './art.js';
import { createWorld } from './world.js';
import { TORCH, SCONCE, MAGIC, makeLight, updateLight, accumulateLights, composite } from './lighting.js';

// マップ・遮蔽データ・背景（world.js）と光の計算（lighting.js）は、図の生成スクリプトと共有している
const world = createWorld();
const { TILE, W, H, N, walls, bg, sconces } = world;

const $ = (id) => document.getElementById(id);
const opt = () => ({
  banding: $('banding').checked, dilate: $('dilate').checked, tileMode: $('tileMode').checked, noShadow: $('noShadow').checked,
});

// ---------- ゲーム状態 ----------
const player = { x: 3 * TILE + 8, y: 2 * TILE + 8, facing: 1, moving: false, walkT: 0, aim: 0 };
const torch = makeLight(world, player.x, player.y, 92, TORCH, 0);
const wallTorches = sconces.map((s, k) => makeLight(world, s.lightX, s.lightY, 60, SCONCE, 1 + k * 2.3));
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
  else if (!walls[y * W + x] && braziers.length < 8) braziers.push(makeLight(world, x, y, 64, MAGIC, Math.random() * 10));
});
$('radius').addEventListener('input', (e) => { torch.radius = +e.target.value; $('radiusVal').textContent = e.target.value; });
$('coneAngle').addEventListener('input', (e) => { $('coneAngleVal').textContent = `${e.target.value}°`; });
const syncShapeUi = () => $('coneAngle').closest('label').classList.toggle('disabled', $('shape').value !== 'cone');
$('shape').addEventListener('change', syncShapeUi); syncShapeUi();
$('resetFog').addEventListener('click', () => explored.fill(0));
$('clearLights').addEventListener('click', () => (braziers.length = 0));

// ---------- メインループ ----------
const frame = new Uint8ClampedArray(N * 4);
const out = ctx.createImageData(W, H);
const sightMask = new Uint8Array(N);
const acc = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
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
  if (mx || my) {                                  // 懐中電灯は入力方向へなめらかに回す
    const target = Math.atan2(my, mx);
    player.aim += Math.atan2(Math.sin(target - player.aim), Math.cos(target - player.aim)) * Math.min(1, dt * 12);
  }

  // 光とフォグ
  torch.x = player.x; torch.y = player.y;
  torch.cone = $('shape').value === 'cone' ? { angle: player.aim, half: (+$('coneAngle').value / 2) * Math.PI / 180 } : null;
  const ms = updateLight(world, torch, o);
  if (ms >= 0) { lastCastMs = ms; for (let i = 0; i < N; i++) explored[i] |= torch.seen[i]; }
  for (const L of wallTorches) updateLight(world, L, o);
  for (const b of braziers) updateLight(world, b, o);
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

  // 光の合計を作って合成する（lighting.js）
  const tc = performance.now();
  const flickerOn = $('flicker').checked;
  accumulateLights(world, [torch, ...wallTorches, ...braziers], acc, (L) => (flickerOn
    ? 1 + 0.06 * Math.sin(t * 11 + L.phase) + 0.04 * Math.sin(t * 23.3 + L.phase * 2) + 0.03 * Math.sin(t * 37.1 + L.phase)
    : 1));
  const d = out.data;
  composite(world, { frame, vis, explored, acc, fog: $('fog').checked, sightMask: showSight ? sightMask : null, out: d });

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
