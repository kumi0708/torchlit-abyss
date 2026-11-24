// 記事に載っている期待値でシャドウキャストを検証する: node test/shadowcast.test.mjs
import assert from 'node:assert/strict';
import { shadowcast } from '../src/shadowcast.js';

const grid = (w, h, fill = 0) => new Uint8Array(w * h).fill(fill);
const count = (a) => a.reduce((s, v) => s + v, 0);
const at = (a, w, x, y) => a[y * w + x] === 1;
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

test('空の 11x11、半径 3/4/5 → 25/45/69 セル', () => {
  const w = grid(11, 11);
  assert.equal(count(shadowcast(w, 11, 11, 5, 5, 3)), 25);
  assert.equal(count(shadowcast(w, 11, 11, 5, 5, 4)), 45);
  assert.equal(count(shadowcast(w, 11, 11, 5, 5, 5)), 69);
});

test('半径 4: (8,5) は見える、(9,5) は見えない', () => {
  const s = shadowcast(grid(11, 11), 11, 11, 5, 5, 4);
  assert.ok(at(s, 11, 8, 5));
  assert.ok(!at(s, 11, 9, 5));
});

test('(7,5) に壁、半径 6 → 106 セル、壁は見え奥は見えない', () => {
  const w = grid(11, 11); w[5 * 11 + 7] = 1;
  const s = shadowcast(w, 11, 11, 5, 5, 6);
  assert.equal(count(s), 106);
  assert.ok(at(s, 11, 7, 5));
  for (const x of [8, 9, 10]) assert.ok(!at(s, 11, x, 5));
});

test('全部壁の 7x7、半径 3 → 9 セル', () => {
  assert.equal(count(shadowcast(grid(7, 7, 1), 7, 7, 3, 3, 3)), 9);
});

test('空の 6x6、角 (0,0)、半径 4 → 15 セル', () => {
  assert.equal(count(shadowcast(grid(6, 6), 6, 6, 0, 0, 4)), 15);
});

test('閉じた部屋の外からは床が見えない', () => {
  const W = 11, w = grid(W, W);
  for (let i = 3; i <= 7; i++) { w[3 * W + i] = w[7 * W + i] = w[i * W + 3] = w[i * W + 7] = 1; }
  for (const r of [3, 6, 10]) {
    const s = shadowcast(w, W, W, 1, 1, r);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) assert.ok(!at(s, W, x, y));
  }
});

test('敵の視線: 列 5 の壁で遮られ、(5,5) を開けると見える', () => {
  const W = 11, w = grid(W, W);
  for (let y = 0; y < W; y++) w[y * W + 5] = 1;
  assert.ok(!at(shadowcast(w, W, W, 2, 5, 10), W, 8, 5));
  w[5 * W + 5] = 0;
  assert.ok(at(shadowcast(w, W, W, 2, 5, 10), W, 8, 5));
});

console.log(`\n${passed} tests passed`);
