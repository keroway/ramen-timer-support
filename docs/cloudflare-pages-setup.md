# Cloudflare Pages セットアップ

このサイトは GitHub Actions から Cloudflare Pages へ direct upload します。

## 初回のみ

1. Cloudflare Dashboard の **Workers & Pages** → **Create** → **Pages** → **Direct Upload** で、`ramen-timer-support` プロジェクトを作成する。
   - CLI を利用できる場合は `npx wrangler pages project create ramen-timer-support` でも作成できる。
2. Cloudflare の API Token（**Cloudflare Pages — Edit**）を発行する。
3. GitHub リポジトリ Settings → Secrets and variables → Actions に以下を追加する。

   | Secret | 値 |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | 手順 2 の API Token |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

4. Cloudflare Dashboard の Pages プロジェクト → **Custom domains** から `ramentimer.keroway.com` を追加する。
   - 表示される DNS 設定を Cloudflare Dashboard で確定する。DNS API Token は不要。

## デプロイ

`main` への push で `.github/workflows/deploy.yml` が `npm run build` を実行し、`dist/` を Pages にアップロードします。

デプロイ後の公開 URL:

- サポート: `https://ramentimer.keroway.com`
- プライバシーポリシー: `https://ramentimer.keroway.com/privacy`

## ローカル確認

```bash
npm ci
npm run check
npm run build
npm run preview
```

`public/_headers` はビルド時に `dist/_headers` へコピーされ、Cloudflare Pages がセキュリティヘッダーとして適用します。
