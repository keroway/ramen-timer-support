# .claude/ — Stop hook 構成

Claude Code のターン終了時（Stop）に、安い順の決定的チェック（fmt / lint / typecheck）を
自動実行するための設定。lefthook の pre-commit は staged ファイルにしか効かないため、
未コミットのままターンが終わるケースをここで拾う。

## 構成

```text
.claude/
├── settings.json           # Stop hook の登録
├── hooks/
│   └── post-stop-check.sh  # 実際に検証を行うスクリプト
└── README.md                # このファイル
```

## post-stop-check.sh の挙動

1. **無限ループ防止**: stdin の JSON から `stop_hook_active` を読み、`true`（＝この
   hook が既に一度ブロックした後の再実行）なら即 exit 0 で素通りする。`jq` が無い環境
   でも動くよう、`jq` 不在時は簡易な文字列マッチにフォールバックする。
2. **差分スコープ判定（3段 degrade）**: どこまでの差分をチェック対象にするかを
   `@{u}`（upstreamブランチとの差分）→ `origin/main..HEAD`（upstream未設定時）→ 空
   （どちらも取れない場合。ただし未コミット分は常に合算する）の順に決める。未コミット分は
   `git status --porcelain -z`（NUL区切り）で取得し、空白を含むパスも壊さず判定する。
3. **影響領域のみ実行**: 変更ファイルの拡張子に応じて `pnpm run lint`（`*.ts/*.js/*.mjs/*.json`
   が対象）、`pnpm run check`（`*.astro/*.ts` が対象）、`prettier --check "**/*.{astro,css}"`
   （`*.astro/*.css` が対象）を選択的に実行する。
4. **silent-pass 禁止**: リポジトリルートへの `cd` 失敗や `git` / `pnpm` コマンド不在は
   検証をスキップせず exit 2（ブロッキングエラー）として扱う。

## 終了コード

- `0`: チェック対象なし、またはチェック通過。
- `2`: チェック失敗（または前提コマンド不在など）。stderr の内容が Claude にそのまま
  フィードバックされ、修正を促す。

## タイムアウト

`settings.json` 側のタイムアウトは 120 秒。ワークスペース標準の目安は軽量リポジトリで
30 秒だが、本リポジトリは Astro（SSG）のため `astro check` の起動コストを見込んで
120 秒に緩めている。スクリプト内部でも `pnpm run lint` は 30 秒、`pnpm run check` は
90 秒を上限に `timeout` コマンドで区切っている（`timeout` が無い環境では上限なしで実行）。

## 一時的に無効化したい場合

環境変数 `CLAUDE_SKIP_STOP_HOOK=1` を設定すると、hook はチェックを行わず exit 0 で
終了する。恒常的な無効化ではなく、一時的なデバッグ用途に限定すること。
