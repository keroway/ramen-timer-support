# まてた！ラーメンタイマー — Support

[まてた！ラーメンタイマー](https://ramentimer.keroway.com) の公式サポート・プライバシーポリシーサイトです。

- Support: <https://ramentimer.keroway.com>
- Privacy policy: <https://ramentimer.keroway.com/privacy>
- Contact: `app@keroway.com`

## Development

```bash
npm ci
npm run dev
npm run check
npm run lint
npm run build
```

## CI / Deployment

- Pull request: `.github/workflows/ci.yml`（Biome lint + `astro check` + build）、`.github/workflows/gitleaks.yml`（secret scan）
- `main` への push: `.github/workflows/deploy.yml` が build 後、Cloudflare Pages（`ramen-timer-support` プロジェクト）へ direct upload
- デプロイ先: <https://ramentimer.keroway.com>

Deployment and custom-domain setup are documented in [docs/cloudflare-pages-setup.md](docs/cloudflare-pages-setup.md).
