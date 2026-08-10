# まてた！ラーメンタイマー — Support

[まてた！ラーメンタイマー](https://ramentimer.keroway.com) の公式サポート・プライバシーポリシーサイトです。App Store / Google Play のサポート URL 要件を満たすための静的サイトで、アプリ本体のコードはこのリポジトリには含みません。

- Support: <https://ramentimer.keroway.com>
- Privacy policy: <https://ramentimer.keroway.com/privacy>
- Contact: `app@keroway.com`
- アプリ本体: [`ramen-timer`](https://github.com/keroway-family/ramen-timer)（PWA, React） / [`ramen-timer-mobile`](https://github.com/keroway-family/ramen-timer-mobile)（Expo）

## 技術スタック

| 領域 | 採用技術 |
|---|---|
| フレームワーク | [Astro](https://astro.build/)（`output: "static"` で完全静的サイトを生成） |
| 言語 | TypeScript（`astro/tsconfigs/strict`） |
| Lint / Format | [Biome](https://biomejs.dev/)（`*.ts` / `*.js` / `*.mjs` / `*.json`）+ [Prettier](https://prettier.io/) + `prettier-plugin-astro`（`*.astro` / `*.css`） |
| ホスティング | Cloudflare Pages（Direct Upload） |
| Node バージョン | [`.nvmrc`](.nvmrc) を参照（CI・ローカルとも同じソースを使用） |

依存パッケージは全て完全固定バージョン（`^` なし）で管理し、[Renovate](.github/renovate.json5) が更新を検知します。

## セットアップと開発

```bash
pnpm install
pnpm run dev
```

| コマンド | 内容 |
|---|---|
| `pnpm run dev` | 開発サーバーを起動 |
| `pnpm run build` | プロダクションビルド（`astro build`、出力先は `dist/`） |
| `pnpm run preview` | ビルド済み `dist/` をプレビュー |
| `pnpm run check` | `astro check`（TypeScript・`.astro` の型/整合性チェック） |
| `pnpm run lint` | `biome ci`（`*.ts` / `*.js` / `*.mjs` / `*.json` の Lint + フォーマット崩れ検出） |
| `pnpm run format` | Biome + Prettier で全対象ファイルを整形 |
| `pnpm run format:check` | `format` の内容を変更せずに検証（CI で使用） |

PR 前に次のコマンドを通すこと（CI と同じ）:

```bash
pnpm run format:check && pnpm run check && pnpm run build
```

## ディレクトリ構成

```text
src/
├── layouts/BaseLayout.astro   # 全ページ共通レイアウト（title/description は必須 props）
├── pages/                     # index.astro / privacy.astro / 404.astro の3枚のみ
└── styles/global.css          # 唯一のスタイルシート（BaseLayout が import）
public/
├── _headers                   # Cloudflare Pages のセキュリティヘッダー
├── favicon.svg                # サイトアイコン
└── robots.txt                 # sitemap-index.xml を参照
docs/cloudflare-pages-setup.md # デプロイ・カスタムドメインの初期セットアップ手順
```

ページを追加する場合は `src/pages/*.astro` に `BaseLayout` を被せた 1 ファイルで完結させます（コンポーネント分割はしていません）。CSS は `src/styles/global.css` に集約し、コンポーネント単位・scoped スタイルやインライン `style` 属性は使いません（`public/_headers` の CSP が `style-src 'self'` のみで `'unsafe-inline'` を許可していないため）。

## CI / デプロイ

- Pull request: [`ci.yml`](.github/workflows/ci.yml)（Biome + Prettier のフォーマットチェック、`astro check`、build）、[`gitleaks.yml`](.github/workflows/gitleaks.yml)（secret scan、org 共通の reusable workflow）
- `main` への push: [`deploy.yml`](.github/workflows/deploy.yml) が build 後、Cloudflare Pages（`ramen-timer-support` プロジェクト）へ direct upload
- 依存関係の更新提案: [`renovate.json5`](.github/renovate.json5)（npm / GitHub Actions、週次。minor / patch はグループ化、major は個別 PR）。
  ただし Renovate は現在 silent mode で動いており PR も Dependency Dashboard も出ない
- 脆弱性由来の更新: Dependabot security updates（リポジトリ設定側の機能で `.github/dependabot.yml` は不要）
- デプロイ先: <https://ramentimer.keroway.com>

初回セットアップ・カスタムドメイン設定は [docs/cloudflare-pages-setup.md](docs/cloudflare-pages-setup.md) を参照してください。

## プライバシーポリシーを改訂する場合

`src/pages/privacy.astro` は日英併記の1ページ構成で、日本語セクション・English セクションの見出しが1〜7で対応しています。改訂時は**両言語 + 冒頭の `lastUpdated` 定数**を必ず同時に更新してください。

## コミット規約

[Conventional Commits](https://www.conventionalcommits.org/)（subject は日本語）。`main` への直 push はせず PR 経由で行います。

## License

[MIT](LICENSE)
