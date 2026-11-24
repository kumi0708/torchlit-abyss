// 光の計算（キャスト → 扇形 → 壁の照らし込み → 減衰と量子化 → 合計 → 合成）。
// DOM に依存しないので、デモと図の生成スクリプトの両方から使う。
import { shadowcast, lightWallDepth } from './shadowcast.js';

export const AMBIENT = [0.045, 0.05, 0.09];
export const TORCH = [1.0 * 1.15, 0.80 * 1.15, 0.55 * 1.15];
export const SCONCE = [1.0 * 0.8, 0.68 * 0.8, 0.40 * 0.8];
export const MAGIC = [0.45, 0.75, 1.1];
export const FOG_TINT = [0.30, 0.32, 0.40];

// 扇形ライト: 中心から CONE_CORE px 以内は全方向を照らす（自分の足元が見えるように）。
// 扇の縁は CONE_SOFT ラジアンかけてなめらかに暗くする。
export const CONE_CORE = 12, CONE_SOFT = 0.18;
export const angleDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export const DEFAULT_OPTIONS = { banding: true, dilate: true, tileMode: false, noShadow: false };

export function makeLight(world, x, y, radius, color, phase = 0) {
  const { N } = world;
  return { x, y, radius, color, phase, cone: null, key: '', seen: new Uint8Array(N), band: new Float32Array(N), box: [0, 0, -1, -1] };
}

// 光源 (x, y) から見えるピクセルを out に書く
export function castFrom(world, x, y, radius, out, o, cone) {
  const { W, H, TW, TH, TILE, walls, tileWalls, tileSeen } = world;
  if (o.noShadow) {
    // 比較用: 壁を無視して半径内をすべて照らす、ただの radial light
    out.fill(0);
    const r2 = radius * radius;
    for (let py = Math.max(0, y - radius); py <= Math.min(H - 1, y + radius); py++) {
      for (let px = Math.max(0, x - radius); px <= Math.min(W - 1, x + radius); px++) {
        if ((px - x) ** 2 + (py - y) ** 2 < r2) out[py * W + px] = 1;
      }
    }
    if (cone) applyCone(world, out, x, y, radius, cone);
    return out;
  }
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
  // 扇形はシャドウキャストの結果を角度で絞るだけ。壁の照らし込みはその後にかけて、扇の内側の壁だけ照らす
  if (cone) applyCone(world, out, x, y, radius, cone);
  if (o.dilate) lightWallDepth(out, walls, W, H, 5);
  return out;
}

export function applyCone(world, seen, x, y, radius, cone) {
  const { W, H } = world;
  for (let py = Math.max(0, y - radius); py <= Math.min(H - 1, y + radius); py++) {
    for (let px = Math.max(0, x - radius); px <= Math.min(W - 1, x + radius); px++) {
      const i = py * W + px, dx = px - x, dy = py - y;
      if (!seen[i] || dx * dx + dy * dy <= CONE_CORE * CONE_CORE) continue;
      if (angleDiff(Math.atan2(dy, dx), cone.angle) > cone.half) seen[i] = 0;
    }
  }
}

// キャストし直して減衰（band）を作る。再計算したら所要時間（ms）を、キャッシュが効いたら -1 を返す
export function updateLight(world, L, o) {
  const { W, H } = world;
  const x = Math.round(L.x), y = Math.round(L.y);
  const cone = L.cone;                            // null なら radial
  const coneKey = cone ? `${Math.round(cone.angle * 180 / Math.PI)},${cone.half.toFixed(3)}` : 'radial';
  const key = `${x},${y},${L.radius},${o.banding},${o.dilate},${o.tileMode},${o.noShadow},${coneKey}`;
  if (key === L.key) return -1;                   // 記事の推奨: 光が別セルに移ったときだけ再計算
  L.key = key;
  const t0 = performance.now();
  castFrom(world, x, y, L.radius, L.seen, o, cone);
  L.band.fill(0);
  const R = L.radius, x0 = Math.max(0, x - R - 6), x1 = Math.min(W - 1, x + R + 6);
  const y0 = Math.max(0, y - R - 6), y1 = Math.min(H - 1, y + R + 6);
  L.box = [x0, y0, x1, y1];
  for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
    const i = py * W + px;
    if (!L.seen[i]) continue;
    const dist = Math.hypot(px - x, py - y);
    let t = Math.min(1, Math.max(0, 1 - dist / R)) ** 0.8;
    if (cone && dist > CONE_CORE) {                // 扇の縁に向かって暗くする
      t *= Math.min(1, Math.max(0, (cone.half - angleDiff(Math.atan2(py - y, px - x), cone.angle)) / CONE_SOFT));
    }
    if (o.banding) t = Math.ceil(t * 6) / 6;        // 6 段階のフラットな帯
    L.band[i] = t;
  }
  return performance.now() - t0;
}

// 光の合計: ambient + Σ light × color × flicker（各光源は届く範囲の矩形だけ足す）
export function accumulateLights(world, lights, acc, flicker = () => 1) {
  const { W } = world;
  const [accR, accG, accB] = acc;
  accR.fill(AMBIENT[0]); accG.fill(AMBIENT[1]); accB.fill(AMBIENT[2]);
  for (const L of lights) {
    const f = flicker(L);
    const cr = L.color[0] * f, cg = L.color[1] * f, cb = L.color[2] * f, band = L.band;
    const [x0, y0, x1, y1] = L.box;
    for (let py = y0; py <= y1; py++) for (let i = py * W + x0, end = py * W + x1; i <= end; i++) {
      const v = band[i];
      if (v) { accR[i] += v * cr; accG[i] += v * cg; accB[i] += v * cb; }
    }
  }
}

// 合成: 視界内は lit = scene × 光の合計、探索済みは灰青のモノクロ、未探索は黒
export function composite(world, { frame, vis, explored, acc, fog = true, sightMask = null, out }) {
  const { N, bg } = world;
  const [accR, accG, accB] = acc;
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    if (vis[i]) {
      out[p] = frame[p] * accR[i]; out[p + 1] = frame[p + 1] * accG[i]; out[p + 2] = frame[p + 2] * accB[i];
      if (sightMask && sightMask[i]) { out[p] += 60; out[p + 1] *= 0.7; out[p + 2] *= 0.7; }
    } else if (fog && explored[i]) {
      const m = (bg[p] + bg[p + 1] + bg[p + 2]) / 3;   // フォグは背景だけから作る（敵の記憶を残さない）
      out[p] = m * FOG_TINT[0]; out[p + 1] = m * FOG_TINT[1]; out[p + 2] = m * FOG_TINT[2];
    } else {
      out[p] = out[p + 1] = out[p + 2] = 0;
    }
    out[p + 3] = 255;
  }
}
