# keroway 標準 justfile。中身は既存の package.json scripts への薄い委譲のみ。

default:
    @just --list

build:
    pnpm run build

test:
    @echo "test スクリプトは未整備（e2e/unit テストなし。astro check (typecheck) は 'just check' 参照）" >&2
    @exit 1

lint:
    pnpm run lint

format:
    pnpm run format

# format:check / lint / typecheck をまとめて実行（コミット前の全通し確認）。
# pnpm run a11y は dist/ のビルドが前提のため、build を含まないこのレシピには含めない（'just a11y' 参照）
check:
    pnpm run format:check
    pnpm run lint
    pnpm run check

# dist/ をビルドしてから a11y（html-validate）チェックを実行
a11y:
    pnpm run build
    pnpm run a11y
