// README の図を、デモと同じコード（src/*.js）から生成する: npm run figures
// 出力先: docs/images/*.png
import { shadowcast } from '../src/shadowcast.js';
import { SPRITES, ALERT, stamp, dropShadow, drawFlame } from '../src/art.js';
import { createWorld } from '../src/world.js';
import {
  TORCH, SCONCE, MAGIC, DEFAULT_OPTIONS, castFrom, makeLight, updateLight, accumulateLights, composite,
} from '../src/lighting.js';
import { Img, hcat } from './image.mjs';

const OUT = new URL('../docs/images/', import.meta.url).pathname;
const world = createWorld();
const { W, H, N, walls, bg, sconces } = world;
const save = (img, name) => { img.save(OUT + name); console.log(`wrote ${name} (${img.w}x${img.h})`); };
const opts = (o = {}) => ({ ...DEFAULT_OPTIONS, ...o });
const flicker = (t) => (L) => 1 + 0.06 * Math.sin(t * 11 + L.phase) + 0.04 * Math.sin(t * 23.3 + L.phase * 2) + 0.03 * Math.sin(t * 37.1 + L.phase);

// ---------- デモと同じ手順で 1 フレームを描く ----------
function render({
  player, radius = 92, o = opts(), cone = null, lamps = [], enemies = [], explored = null,
  showSight = false, t = 0.37, facing = 1, fog = true,
}) {
  const torch = makeLight(world, player.x, player.y, radius, TORCH);
  torch.cone = cone;
  updateLight(world, torch, o);
  const wallTorches = sconces.map((s, k) => {
    const L = makeLight(world, s.lightX, s.lightY, 60, SCONCE, 1 + k * 2.3); updateLight(world, L, o); return L;
  });
  const lampLights = lamps.map(([x, y], k) => {
    const L = makeLight(world, x, y, 64, MAGIC, k * 3); updateLight(world, L, o); return L;
  });
  const vis = torch.seen;
  const exp = explored ? explored.slice() : new Uint8Array(N);
  for (let i = 0; i < N; i++) exp[i] |= vis[i];

  const pi = Math.round(player.y) * W + Math.round(player.x);
  const sightMask = showSight ? new Uint8Array(N) : null;
  const es = enemies.map(([x, y], k) => {
    const sight = shadowcast(walls, W, H, x, y, 72);
    if (sightMask) for (let i = 0; i < N; i++) sightMask[i] |= sight[i];
    return { x, y, phase: k * 1.7, sees: sight[pi] === 1 };
  });

  const frame = Uint8ClampedArray.from(bg);
  const emissive = [];
  const flames = wallTorches
    .map((L, k) => ({ x: sconces[k].flameX, y: sconces[k].flameY, phase: L.phase, shown: vis[sconces[k].lightY * W + sconces[k].lightX] === 1 }))
    .filter((f) => f.shown);
  for (const [x, y] of lamps) {
    dropShadow(frame, W, H, x, y + 4, 3, 1.2);
    stamp(frame, W, H, SPRITES.lamp.slice(0, 5), x - 3, y - 4, { emissive });
    stamp(frame, W, H, SPRITES.lamp.slice(5), x - 3, y + 1);
  }
  const actors = [...es.map((e) => ({ e, y: e.y })), { player: true, y: player.y }].sort((a, b) => a.y - b.y);
  for (const a of actors) {
    if (a.e) {
      const { e } = a, rows = SPRITES.slimeTall;
      dropShadow(frame, W, H, e.x, e.y + 4, 5, 1.5);
      stamp(frame, W, H, rows, e.x - 5, e.y + 4 - rows.length, { recolor: e.sees ? ALERT : null });
      if (e.sees) for (const dy of [-5, -4, -3, -1]) emissive.push((e.y + 4 - rows.length - 2 + dy) * W + e.x, 255, 220, 80);
    } else {
      const px = Math.round(player.x), py = Math.round(player.y), rows = SPRITES.playerIdle;
      dropShadow(frame, W, H, px, py + 5, 4, 1.5);
      stamp(frame, W, H, rows, px - 4, py + 5 - rows.length, { flip: facing < 0 });
      const hx = px + (facing > 0 ? 4 : -5), hy = py - 1;
      for (let k = 0; k < 3; k++) { const p = ((hy - k) * W + hx) * 4; frame[p] = 112; frame[p + 1] = 72; frame[p + 2] = 40; }
      flames.push({ x: hx, y: hy - 3, phase: 0 });
    }
  }

  const acc = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  accumulateLights(world, [torch, ...wallTorches, ...lampLights], acc, flicker(t));
  const out = new Uint8ClampedArray(N * 4);
  composite(world, { frame, vis, explored: exp, acc, fog, sightMask, out });
  for (let k = 0; k < emissive.length; k += 4) {
    const i = emissive[k];
    if (!vis[i]) continue;
    out[i * 4] = emissive[k + 1]; out[i * 4 + 1] = emissive[k + 2]; out[i * 4 + 2] = emissive[k + 3];
  }
  for (const f of flames) drawFlame(out, null, W, H, f.x, f.y, t, f.phase);
  return { img: Img.from(out, W, H), torch, es };
}

// 道のりに沿って松明をキャストし、探索済みマスクを作る
function exploreAlong(path, radius = 92, o = opts()) {
  const explored = new Uint8Array(N);
  const L = makeLight(world, 0, 0, radius, TORCH);
  for (let k = 0; k < path.length - 1; k++) {
    const [ax, ay] = path[k], [bx, by] = path[k + 1];
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
    for (let s = 0; s <= n; s++) {
      L.x = ax + (bx - ax) * s / n; L.y = ay + (by - ay) * s / n;
      if (walls[Math.round(L.y) * W + Math.round(L.x)]) continue;
      updateLight(world, L, o);
      for (let i = 0; i < N; i++) explored[i] |= L.seen[i];
    }
  }
  return explored;
}

// 可視マスクを色分けして描く（床/壁 × 見える/見えない）
const MASK = { floorHidden: [22, 24, 34], wallHidden: [62, 64, 86], floorSeen: [214, 176, 108], wallSeen: [255, 228, 156], added: [80, 220, 255] };
function maskImage(seen, before = null) {
  const im = new Img(W, H);
  for (let i = 0; i < N; i++) {
    let c;
    if (before && seen[i] && !before[i]) c = MASK.added;
    else if (walls[i]) c = seen[i] ? MASK.wallSeen : MASK.wallHidden;
    else c = seen[i] ? MASK.floorSeen : MASK.floorHidden;
    im.set1(i * 4, c);
  }
  return im;
}
const markLight = (im, x, y, c = [255, 255, 255]) => { im.rect(x - 2, y - 2, 5, 5, [20, 20, 20]); im.rect(x - 1, y - 1, 3, 3, c); return im; };

// ---------- 図 ----------
const P = { x: 232, y: 120 };                       // 多くの図で使うプレイヤー位置（中央の十字路）
const PATH = [[56, 40], [72, 60], [72, 104], [72, 120], [150, 120], [232, 120]];
const LAMPS = [[170, 150], [300, 96]];               // プレイヤーから見える位置に置く
for (const [x, y] of LAMPS) if (walls[y * W + x]) throw new Error(`lamp at ${x},${y} is inside a wall`);
const ENEMIES = [[290, 120], [232, 40], [400, 200]];

// 1. ヒーロー画像: マップ全体
{
  const { img } = render({ player: P, explored: exploreAlong(PATH), lamps: LAMPS, enemies: ENEMIES });
  save(img.scale(2), 'hero.png');
}

// 2. 処理の流れ（ステップごと）
{
  const crop = (im) => im.crop(136, 56, 192, 128).scale(3);
  const o = opts();
  const raw = castFrom(world, P.x, P.y, 92, new Uint8Array(N), opts({ dilate: false }), null);
  const dil = castFrom(world, P.x, P.y, 92, new Uint8Array(N), o, null);
  const wallsIm = new Img(W, H);
  for (let i = 0; i < N; i++) wallsIm.set1(i * 4, walls[i] ? [150, 152, 180] : [22, 24, 34]);
  save(crop(markLight(wallsIm, P.x, P.y, [255, 210, 80])), 'step1-walls.png');
  save(crop(markLight(maskImage(raw), P.x, P.y)), 'step2-seen.png');
  save(crop(markLight(maskImage(dil, raw), P.x, P.y)), 'step3-dilate.png');
  const L = makeLight(world, P.x, P.y, 92, TORCH); updateLight(world, L, o);
  const bands = new Img(W, H);
  for (let i = 0; i < N; i++) { const v = L.band[i]; bands.set1(i * 4, [255 * v, 214 * v, 150 * v]); }
  save(crop(bands), 'step4-bands.png');
  save(crop(render({ player: P }).img), 'step5-final.png');
}

// 3. オクタント
{
  const R = 10, size = 2 * R + 1, cs = 18;
  const OCT = [[1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1], [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1]];
  const COLORS = [[231, 111, 81], [244, 162, 97], [233, 196, 106], [138, 201, 38], [42, 157, 143], [69, 123, 157], [131, 96, 195], [214, 106, 168]];
  const im = new Img(size * cs + 1, size * cs + 1, [16, 17, 24]);
  const sums = COLORS.map(() => [0, 0, 0]);
  for (let gy = 0; gy < size; gy++) for (let gx = 0; gx < size; gx++) {
    const ox = gx - R, oy = gy - R;
    let col = [16, 17, 24];
    if (ox === 0 && oy === 0) col = [255, 255, 255];
    else if (ox * ox + oy * oy < R * R) {
      const k = OCT.findIndex(([xx, xy, yx, yy]) => {
        const dx = ox * xx + oy * yx, dy = ox * xy + oy * yy;  // 変換の逆（直交行列なので転置）
        return dy < 0 && dx >= dy && dx <= 0;
      });
      col = COLORS[k];
      sums[k][0] += gx; sums[k][1] += gy; sums[k][2]++;
    }
    im.rect(gx * cs + 1, gy * cs + 1, cs - 1, cs - 1, col);
  }
  sums.forEach(([sx, sy, n], k) => {
    const cx = (sx / n + 0.5) * cs, cy = (sy / n + 0.5) * cs;
    im.rect(Math.round(cx) - 8, Math.round(cy) - 12, 17, 25, [20, 20, 28]);
    im.text(String(k), Math.round(cx) - 5, Math.round(cy) - 9, [255, 255, 255], 4);
  });
  save(im, 'octants.png');
}

// 4. 影の扇形（タイル単位の小さな例）
{
  const GW = 27, GH = 16, cs = 18, lx = 13, ly = 14, R = 16;
  const g = new Uint8Array(GW * GH);
  const runs = [[[12, 10], [13, 10], [14, 10]], [[5, 9]], [[19, 7], [20, 7]], [[8, 4], [8, 3]]];
  for (const run of runs) for (const [x, y] of run) g[y * GW + x] = 1;
  const seen = shadowcast(g, GW, GH, lx, ly, R);
  const im = new Img(GW * cs + 1, GH * cs + 1, [10, 11, 16]);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x, inR = (x - lx) ** 2 + (y - ly) ** 2 < R * R;
    let c = [10, 11, 16];
    if (g[i]) c = seen[i] ? [255, 196, 92] : [96, 70, 40];
    else if (seen[i]) c = [214, 176, 108];
    else if (inR) c = [40, 48, 78];                  // 半径内だが影になって見えない
    im.rect(x * cs + 1, y * cs + 1, cs - 1, cs - 1, c);
  }
  const cx = (lx + 0.5) * cs, cy = (ly + 0.5) * cs;
  for (const run of runs) {                          // 壁の両端の角を通る光線 = 影の境界
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of run) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const a = Math.atan2((y + dy) * cs - cy, (x + dx) * cs - cx);
      lo = Math.min(lo, a); hi = Math.max(hi, a);
    }
    for (const a of [lo, hi]) im.line(cx, cy, cx + Math.cos(a) * R * cs * 1.2, cy + Math.sin(a) * R * cs * 1.2, [255, 240, 160], 0.55, 2);
  }
  im.rect(Math.round(cx) - 6, Math.round(cy) - 6, 13, 13, [20, 20, 20]);
  im.rect(Math.round(cx) - 4, Math.round(cy) - 4, 9, 9, [255, 255, 255]);
  save(im, 'shadow-wedge.png');
}

// 5. タイル単位とピクセル単位
{
  const crop = (im) => im.crop(136, 56, 192, 128).scale(3);
  save(crop(render({ player: P, o: opts({ tileMode: true }) }).img), 'tile-mode.png');
  save(crop(render({ player: P }).img), 'pixel-mode.png');
}

// 6. 壁の照らし込み（膨張）のあり／なし
{
  const crop = (im) => im.crop(232, 96, 112, 64).scale(5);
  save(crop(render({ player: P, o: opts({ dilate: false }) }).img), 'dilate-off.png');
  save(crop(render({ player: P }).img), 'dilate-on.png');
}

// 7. 減衰: なめらか／6 段階
{
  const bandImg = (banding) => {
    const L = makeLight(world, P.x, P.y, 92, TORCH); updateLight(world, L, opts({ banding }));
    const im = new Img(W, H);
    for (let i = 0; i < N; i++) { const v = L.band[i]; im.set1(i * 4, [255 * v, 214 * v, 150 * v]); }
    return markLight(im, P.x, P.y).crop(136, 26, 192, 188).scale(2);
  };
  save(bandImg(false), 'falloff-smooth.png');
  save(bandImg(true), 'falloff-bands.png');
}

// 8. radial / 扇形 / 影なし
{
  const crop = (im) => im.crop(104, 40, 256, 160).scale(2);
  save(crop(render({ player: P }).img), 'mode-radial.png');
  save(crop(render({ player: P, cone: { angle: 0.75 * Math.PI, half: 35 * Math.PI / 180 } }).img), 'mode-cone.png');
  save(crop(render({ player: P, o: opts({ noShadow: true }) }).img), 'mode-noshadow.png');
}

// 9. 敵の視線
{
  const { img, es } = render({ player: P, enemies: ENEMIES, showSight: true, explored: exploreAlong(PATH) });
  save(img.crop(120, 16, 320, 208).scale(2), 'enemy-sight.png');
  console.log('  enemies that see the player:', es.filter((e) => e.sees).length);
}

// 10. 非対称性: A から B は見えるが、B から A は見えない例を探して描く
{
  const GW = 13, GH = 9, cs = 22, R = 9;
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let found = null;
  for (let tries = 0; tries < 5000 && !found; tries++) {
    const g = new Uint8Array(GW * GH).map(() => (rnd() < 0.22 ? 1 : 0));
    const floors = [];
    for (let i = 0; i < g.length; i++) if (!g[i]) floors.push(i);
    for (const a of floors) {
      const sa = shadowcast(g, GW, GH, a % GW, a / GW | 0, R);
      for (const b of floors) {
        const d = Math.hypot(a % GW - b % GW, (a / GW | 0) - (b / GW | 0));
        if (d < 5 || !sa[b]) continue;
        const sb = shadowcast(g, GW, GH, b % GW, b / GW | 0, R);
        if (!sb[a]) { found = { g, a, b, sa, sb }; break; }
      }
      if (found) break;
    }
  }
  const panel = (seen, from, to, fromCol, toCol) => {
    const { g } = found;
    const im = new Img(GW * cs + 1, GH * cs + 1, [10, 11, 16]);
    for (let i = 0; i < GW * GH; i++) {
      const x = i % GW, y = i / GW | 0;
      const c = g[i] ? (seen[i] ? [255, 196, 92] : [80, 64, 44]) : (seen[i] ? [214, 176, 108] : [36, 42, 66]);
      im.rect(x * cs + 1, y * cs + 1, cs - 1, cs - 1, c);
    }
    for (const [idx, col, ch] of [[from, fromCol, from === found.a ? 'A' : 'B'], [to, toCol, to === found.a ? 'A' : 'B']]) {
      const x = (idx % GW) * cs + 1, y = (idx / GW | 0) * cs + 1;
      im.rect(x, y, cs - 1, cs - 1, col);
      im.text(ch, x + 5, y + 3, [255, 255, 255], 3);
    }
    return im;
  };
  const blue = [40, 110, 230], red = [210, 50, 60];
  save(hcat([panel(found.sa, found.a, found.b, blue, red), panel(found.sb, found.b, found.a, red, blue)], 24), 'asymmetry.png');
}

// 11. グラフィック: ライティング前の背景と、ライティング後
{
  const crop = (im) => im.crop(8, 120, 192, 96).scale(3);
  save(crop(Img.from(bg, W, H)), 'art-raw.png');
  save(crop(render({ player: { x: 100, y: 165 }, lamps: [[40, 140]], radius: 110 }).img), 'art-lit.png');
}

// 12. スプライト一覧
{
  const BG = [24, 26, 36];
  const sprite = (rows, o = {}) => {
    const im = new Img(rows[0].length + 2, rows.length + 2, BG);
    stamp(im.data, im.w, im.h, rows, 1, 1, o);
    return im.scale(8);
  };
  save(hcat([
    sprite(SPRITES.playerIdle), sprite(SPRITES.playerWalk), sprite(SPRITES.playerIdle, { flip: true }),
    sprite(SPRITES.slimeTall), sprite(SPRITES.slimeSquash), sprite(SPRITES.slimeTall, { recolor: ALERT }),
    sprite(SPRITES.lamp), sprite(SPRITES.skull), sprite(SPRITES.bones),
  ], 16, BG), 'sprites.png');
  const flames = [0, 0.09, 0.18, 0.27, 0.36, 0.45].map((t) => {
    const im = new Img(11, 12, BG);
    drawFlame(im.data, null, 11, 12, 5, 9, t, 0);
    return im.scale(8);
  });
  save(hcat(flames, 12, BG), 'flames.png');
}

// 13. 壁松明の光源の置き場所
{
  const s = sconces[1];
  const lightOnly = (x, y) => {
    const L = makeLight(world, x, y, 60, SCONCE, 0); updateLight(world, L, opts());
    const acc = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
    accumulateLights(world, [L], acc);
    const out = new Uint8ClampedArray(N * 4);
    composite(world, { frame: bg, vis: L.seen, explored: new Uint8Array(N), acc, out });
    drawFlame(out, null, W, H, s.flameX, s.flameY, 0.3, 0);
    return markLight(Img.from(out, W, H), x, y, [80, 220, 255]).crop(s.flameX - 80, 0, 160, 96).scale(3);
  };
  save(lightOnly(s.flameX, s.flameY), 'sconce-in-wall.png');
  save(lightOnly(s.lightX, s.lightY), 'sconce-on-floor.png');
}
