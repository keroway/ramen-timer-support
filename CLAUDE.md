# CLAUDE.md — まてた！ラーメンタイマー Support

## プロジェクト概要

「まてた！ラーメンタイマー」の公式サポート・プライバシーポリシーサイト（`ramentimer.keroway.com`）。App Store / Google Play のサポート URL 要件を満たすための静的サイトで、アプリ本体のコードはこのリポジトリには含まない。

- アプリ本体: [`ramen-timer`](https://github.com/keroway-family/ramen-timer)（PWA, React）
- モバイル版: [`ramen-timer-mobile`](https://github.com/keroway-family/ramen-timer-mobile)（Expo）
- このリポジトリはサポート窓口・プライバシーポリシーの掲載のみを担当する

## コマンド

```bash
pnpm install
pnpm run dev          # 開発サーバー
pnpm run build        # プロダクションビルド (astro build)
pnpm run preview      # ビルド後プレビュー
pnpm run check        # astro check（型・.astro の整合性チェック）
pnpm run lint         # biome ci（*.ts / *.js / *.mjs / *.json のみ、フォーマット崩れも検出）
pnpm run format       # biome format --write . && prettier --write "**/*.{astro,css}"
pnpm run format:check # format の内容を変更せず検証（CI で使用）
pnpm run a11y         # html-validate "dist/**/*.html"（アクセシビリティ回帰の検知。build 後の dist/ が対象）
pnpm run generate:og-image # assets/og-image.svg から public/og-image.png (1200x630) を生成
```

PR 前に `pnpm run format:check && pnpm run check && pnpm run build && pnpm run a11y` を通すこと（CI と同じ）。Node バージョンは [`.nvmrc`](.nvmrc) が唯一のソース（CI もここから読む）。

## ディレクトリ構成

```text
src/
├── layouts/BaseLayout.astro   # 全ページ共通レイアウト（title/description は必須 props）
├── pages/                     # index.astro / privacy.astro / 404.astro の3枚のみ
└── styles/global.css          # 唯一のスタイルシート（BaseLayout が import）
public/
├── _headers                   # Cloudflare Pages のセキュリティヘッダー（dist/_headers にコピーされる）
├── favicon.svg                # サイトアイコン
└── robots.txt                 # sitemap-index.xml を参照
docs/cloudflare-pages-setup.md # デプロイ・カスタムドメインの初期セットアップ手順
```

## 設計上の決定事項

- ページ追加は `src/pages/*.astro` に `BaseLayout` を被せた 1 ファイルで完結させる。コンポーネント分割はしていない
- CSS は `global.css` に集約する。コンポーネント単位・scoped スタイルは作らない
- **インライン `style=` 属性は書かない。** `public/_headers` の CSP は `style-src 'self'`（`'unsafe-inline'` を許可していない）で、`astro.config.mjs` の `build.inlineStylesheets: "never"` と合わせて「CSS は必ず外部ファイル」という前提が成り立っている。スタイルが必要な場合は `global.css` にクラスを追加する
- `public/_headers` の CSP は `script-src 'self'`（インラインスクリプト・外部 CDN 不可）。クライアント側 JS を追加する場合は `_headers` の見直しが必要
- フォーマットは対象ファイルで分担する: Biome（`files.includes` は `*.{ts,js,mjs,json}` のみ）+ Prettier + `prettier-plugin-astro`（`*.astro` / `*.css`）。`.astro` の正しさ自体は `astro check` が担保する
- `tsconfig.json` は `astro/tsconfigs/strict` を継承する。`src/env.d.ts` は不要（tsconfig の `include` に `.astro/types.d.ts` が入っていれば Astro 5 以降は自動生成される）
- `src/pages/privacy.astro` は日英併記の1ページ構成（`<section lang="ja">` / `<section lang="en">` で分離し、見出しが1〜7で対応）。改訂時は**両言語 + 冒頭の `lastUpdated` 定数**を必ず更新する
- `astro.config.mjs` の `site` は canonical URL・OGP `og:url`・sitemap 生成の共通ソース。ドメイン変更時はここを変更する
- 依存パッケージは全て完全固定バージョン（`^` なし）。[Renovate](.github/renovate.json5) が更新提案を出すが、適用は意図的に行う（Dependabot からは移行済みで `.github/dependabot.yml` は無い）。`typescript` の major は `@astrojs/check` の peerDependencies 制約により `enabled: false` で止めてある（#30）
- `.github/workflows/deploy.yml` の `--commit-message=${{ github.sha }}` は変更しない（Cloudflare Pages のデプロイ API が非 ASCII コミットメッセージを拒否するための回避）

## CI / デプロイ

- PR: `ci.yml`（Biome + Prettier のフォーマットチェック + `astro check` + build + `pnpm run a11y`（`html-validate` によるアクセシビリティ回帰チェック））と `gitleaks.yml`（secret scan、org 共通の reusable workflow）
- `main` push: `deploy.yml` が build 後 `dist/` を Cloudflare Pages（`ramen-timer-support` プロジェクト）へ direct upload
- 必要な GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- 初回セットアップ・カスタムドメイン設定は [`docs/cloudflare-pages-setup.md`](docs/cloudflare-pages-setup.md) を参照

## コミット規約

Conventional Commits（subject は日本語）。`main` への直 push はせず PR 経由。
