#!/usr/bin/env bash
# Stop hook: ターン終了ごとに fmt / lint / typecheck を安い順に実行する決定的チェック。
# lefthook の pre-commit は staged ファイルにしか効かないため、未コミットのまま
# ターンが終わるケースをここで拾う。exit 2 で Claude にブロッキングエラーを返す。
set -uo pipefail

if [ "${CLAUDE_SKIP_STOP_HOOK:-}" = "1" ]; then
  echo "post-stop-check: CLAUDE_SKIP_STOP_HOOK=1 のためスキップします" >&2
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)" || {
  echo "post-stop-check: スクリプト自身のディレクトリ解決に失敗しました" >&2
  exit 2
}
repo_root="$(cd "${script_dir}/../.." >/dev/null 2>&1 && pwd)" || {
  echo "post-stop-check: リポジトリルートへの cd に失敗しました" >&2
  exit 2
}
cd "$repo_root" || {
  echo "post-stop-check: cd '${repo_root}' に失敗しました" >&2
  exit 2
}

for bin in git pnpm; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "post-stop-check: 必須コマンド '${bin}' が見つかりません（silent-pass 禁止のため失敗として扱います）" >&2
    exit 2
  fi
done

# --- stdin(JSON) 読み取り + stop_hook_active による無限ループ防止 -----------
input="$(cat 2>/dev/null || true)"

stop_hook_active="false"
if command -v jq >/dev/null 2>&1; then
  stop_hook_active="$(printf '%s' "$input" | jq -r 'try .stop_hook_active catch false' 2>/dev/null || echo false)"
else
  # jq 非依存フォールバック: true/false のみを対象にした素朴な文字列抽出
  if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    stop_hook_active="true"
  fi
fi

if [ "$stop_hook_active" = "true" ]; then
  # 既にこの Stop hook が1度ブロックした後の再実行。無限ループを避けて素通りする。
  exit 0
fi

# --- 差分スコープ判定（3段 degrade: @{u} → origin/main..HEAD → 空） --------
committed_diff=""
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  committed_diff="$(git diff --name-only '@{u}' -- 2>/dev/null || true)"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
  committed_diff="$(git diff --name-only origin/main...HEAD -- 2>/dev/null || true)"
fi
# 上記どちらも取れない場合（origin未設定・履歴が浅い等）は committed_diff は空のまま。

# 未コミット分（staged/unstaged/untracked）は差分スコープが取れた場合も常に合算する。
# -z（NUL区切り）で取得し、空白を含むパスを壊さず取り出す。rename/copy はパスが
# 2件（新パス→旧パス）続けて出力されるため、旧パスはスキップする。
uncommitted_diff=""
skip_next=false
while IFS= read -r -d '' entry; do
  if [ "$skip_next" = "true" ]; then
    skip_next=false
    continue
  fi
  status="${entry:0:2}"
  path="${entry:3}"
  case "$status" in
  R* | C*) skip_next=true ;;
  esac
  uncommitted_diff="${uncommitted_diff}${path}"$'\n'
done < <(git status --porcelain --untracked-files=all -z 2>/dev/null)

changed_files="$(printf '%s\n%s\n' "$committed_diff" "$uncommitted_diff" | sed '/^$/d' | sort -u)"

if [ -z "$changed_files" ]; then
  # 差分ゼロ: チェック対象がないので何もしない
  exit 0
fi

# --- 影響領域の判定（拡張子ベースでスコープを絞る） --------------------------
run_biome=false
run_astro=false
run_prettier=false
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
  *.ts | *.js | *.mjs | *.json) run_biome=true ;;
  esac
  case "$f" in
  *.astro | *.ts) run_astro=true ;;
  esac
  case "$f" in
  *.astro | *.css) run_prettier=true ;;
  esac
done <<CHANGED
$changed_files
CHANGED

run_with_timeout() {
  # $1: 秒, $2..: コマンド。timeout が無い環境ではタイムアウト無しで実行する。
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    "$@"
  fi
}

fail=0
log_dir="$(mktemp -d 2>/dev/null || echo /tmp)"

if [ "$run_biome" = "true" ]; then
  if ! run_with_timeout 30 pnpm run lint >"${log_dir}/lint.log" 2>&1; then
    echo "post-stop-check: pnpm run lint（biome ci）が失敗しました" >&2
    cat "${log_dir}/lint.log" >&2
    fail=1
  fi
fi

if [ "$run_astro" = "true" ]; then
  if ! run_with_timeout 90 pnpm run check >"${log_dir}/check.log" 2>&1; then
    echo "post-stop-check: pnpm run check（astro check）が失敗しました" >&2
    cat "${log_dir}/check.log" >&2
    fail=1
  fi
fi

if [ "$run_prettier" = "true" ]; then
  if ! run_with_timeout 30 pnpm exec prettier --check "**/*.{astro,css}" >"${log_dir}/prettier.log" 2>&1; then
    echo "post-stop-check: prettier --check（astro/css）が失敗しました" >&2
    cat "${log_dir}/prettier.log" >&2
    fail=1
  fi
fi

rm -rf "$log_dir" 2>/dev/null || true

if [ "$fail" -ne 0 ]; then
  exit 2
fi

exit 0
