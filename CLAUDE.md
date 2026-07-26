# CLAUDE.md — まてた！ラーメンタイマー Support

## プロジェクト概要

「まてた！ラーメンタイマー」の公式サポート・プライバシーポリシーサイト（`ramentimer.keroway.com`）。App Store / Google Play のサポート URL 要件を満たすための静的サイトで、アプリ本体のコードはこのリポジトリには含まない。

- アプリ本体: [`ramen-timer`](https://github.com/keroway-family/ramen-timer)（PWA, React）
- モバイル版: [`ramen-timer-mobile`](https://github.com/keroway-family/ramen-timer-mobile)（Expo）
- このリポジトリはサポート窓口・プライバシーポリシーの掲載のみを担当する

## コマンド

```bash
npm ci
npm run dev      # 開発サーバー
npm run build    # プロダクションビルド (astro build)
npm run preview  # ビルド後プレビュー
npm run check    # astro check（型・.astro の整合性チェック）
npm run lint     # biome ci（*.ts / *.js / *.mjs / *.json のみ、フォーマット崩れも検出）
npm run format   # biome format --write .
```

PR 前に `npm run lint && npm run check && npm run build` を通すこと（CI と同じ）。

## ディレクトリ構成

```text
src/
├── layouts/BaseLayout.astro   # 全ページ共通レイアウト（title/description は必須 props）
├── pages/                     # index.astro / privacy.astro / 404.astro の3枚のみ
└── styles/global.css          # 唯一のスタイルシート（BaseLayout が import）
public/_headers                # Cloudflare Pages のセキュリティヘッダー（dist/_headers にコピーされる）
docs/cloudflare-pages-setup.md # デプロイ・カスタムドメインの初期セットアップ手順
```

## 設計上の決定事項

- ページ追加は `src/pages/*.astro` に `BaseLayout` を被せた 1 ファイルで完結させる。コンポーネント分割はしていない
- CSS は `global.css` に集約する。コンポーネント単位・scoped スタイルは作らない
- `public/_headers` の CSP は `script-src 'self'`（インラインスクリプト・外部 CDN 不可）。クライアント側 JS を追加する場合は `_headers` の見直しが必要
- Biome の `files.includes` は `*.{ts,js,mjs,json}` のみ。**`.astro` / `.css` は Biome の対象外**で、`.astro` の正しさは `astro check` が担保する
- `src/pages/privacy.astro` は日英併記の1ページ構成（日本語セクション・English セクションの見出しが1〜7で対応）。改訂時は**両言語 + 冒頭の `lastUpdated` 定数**を必ず更新する
- `astro.config.mjs` の `site` は canonical URL と sitemap 生成のソース。ドメイン変更時はここを変更する
- 依存パッケージは全て完全固定バージョン（`^` なし）。更新は意図的に行う
- `.github/workflows/deploy.yml` の `--commit-message=${{ github.sha }}` は変更しない（Cloudflare Pages のデプロイ API が非 ASCII コミットメッセージを拒否するための回避）

## CI / デプロイ

- PR: `ci.yml`（Biome lint + `astro check` + build）と `gitleaks.yml`（secret scan、org 共通の reusable workflow）
- `main` push: `deploy.yml` が build 後 `dist/` を Cloudflare Pages（`ramen-timer-support` プロジェクト）へ direct upload
- 必要な GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- 初回セットアップ・カスタムドメイン設定は [`docs/cloudflare-pages-setup.md`](docs/cloudflare-pages-setup.md) を参照

## コミット規約

Conventional Commits（subject は日本語）。`main` への直 push はせず PR 経由。
