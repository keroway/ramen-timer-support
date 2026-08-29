# アイコン生成手順

## 概要

`public/favicon.svg` と `public/apple-touch-icon.png` は、ルート SVG から生成される。
恒久依存を追加せず、`npx` で一発変換する。

## favicon.svg

`public/favicon.svg` は透明背景のまま編集し、保存する。

## apple-touch-icon.png

1. 生成元 SVG (`docs/apple-touch-icon-source.svg`) が、背景色 `#fff7e8` で塗りつぶされていることを確認する。
2. 以下のコマンドで `public/apple-touch-icon.png` (180x180) を生成する。

```bash
npx --yes sharp-cli@5.2.0 resize 180 180 \
  --input docs/apple-touch-icon-source.svg \
  --output public/apple-touch-icon.png
```

`sharp-cli` が利用できない場合は、同様に `npx resvg-cli` 等で 180x180 へ変換する。

## 検証

生成後は必ず以下を実行する。

```bash
pnpm run format:check && pnpm run check && pnpm run build
```

生成した PNG が `dist/` にコピーされ、`BaseLayout.astro` の `<link rel="apple-touch-icon">` 経由で参照されていることを確認する。
