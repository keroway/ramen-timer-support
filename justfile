# keroway 標準 justfile。中身は既存の package.json scripts への薄い委譲のみ。

default:
    @just --list

build:
    pnpm run build

test:
    @echo "test スクリプトは未整備（e2e/unit テストなし。astro check (typecheck) は 'just check' 参照）"

lint:
    pnpm run lint

format:
    pnpm run format

# format:check / lint / typecheck をまとめて実行（コミット前の全通し確認）
check:
    pnpm run format:check
    pnpm run lint
    pnpm run check
