# 2D Shadowcasting — 松明とフォグ・オブ・ウォー

[2D Shadowcasting for Torchlight and Fog of War](https://www.spritecook.ai/blog/2d-shadowcasting-torchlight-fog-of-war) の手法をブラウザ（素の JavaScript、依存なし）で実装したデモです。

## 動かし方

```bash
node serve.mjs
```

http://localhost:8173 を開きます。

- **WASD / 矢印キー**: 移動
- **クリック**: 青い灯火を設置／撤去
- 右パネルで各機能を切り替え

## 実装内容

- **再帰的シャドウキャスティング**（8 オクタント、スタックによる反復実装）— [src/shadowcast.js](src/shadowcast.js)
- **ピクセル単位のキャスト**と、比較用の**タイル単位キャスト**
- **光の減衰**: `t = clamp(1 - d/R)^0.8` を 6 段階に量子化
- **ライティング**: `scene × (ambient + light × torch_color)`
- **壁上面の照明**: 見えている領域を 5px 膨張して壁ピクセルに適用
- **フォグ・オブ・ウォー**: 視界内／探索済み（灰青のモノクロ）／未探索（黒）
- **敵の視線判定**: 敵の位置からキャストし、プレイヤーが見えるか判定
- 追加要素: 松明の揺らぎ、複数光源の加算

## テスト

記事に記載された期待値で検証します。

```bash
node test/shadowcast.test.mjs
```
