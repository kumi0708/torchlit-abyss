// マップと遮蔽データ。デモ（main.js）と図の生成スクリプト（tools/figures.mjs）で共有する。
import { TILE, buildLevel } from './art.js';

export const MAP = [
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

export function createWorld(map = MAP, seed = 1337) {
  const TW = map[0].length, TH = map.length;
  map.forEach((r, i) => { if (r.length !== TW) throw new Error(`MAP row ${i} has ${r.length} cols`); });
  const W = TW * TILE, H = TH * TILE, N = W * H;
  const isWallTile = (tx, ty) => tx < 0 || ty < 0 || tx >= TW || ty >= TH || map[ty][tx] === '#';

  // 遮蔽データ: タイル単位とピクセル単位の両方を持つ
  const tileWalls = new Uint8Array(TW * TH);
  const walls = new Uint8Array(N);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    if (!isWallTile(tx, ty)) continue;
    tileWalls[ty * TW + tx] = 1;
    for (let y = 0; y < TILE; y++) walls.fill(1, (ty * TILE + y) * W + tx * TILE, (ty * TILE + y) * W + tx * TILE + TILE);
  }

  // 背景（床・壁・飾り）と壁松明の位置は art.js でコード生成する
  const { bg, sconces } = buildLevel(map, W, H, seed);
  return { map, TILE, TW, TH, W, H, N, isWallTile, tileWalls, walls, bg, sconces, tileSeen: new Uint8Array(TW * TH) };
}
