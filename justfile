# keroway 標準 justfile。中身は既存の package.json scripts への薄い委譲のみ。
# このリポジトリは npm（ワークスペース標準は pnpm。移行コストが高いため justfile で
# インタフェースだけ揃える）。

default:
    @just --list

build:
    npm run build

test:
    @echo "test スクリプトは未整備（e2e/unit テストなし。astro check (typecheck) は 'just check' 参照）"

lint:
    npm run lint

format:
    npm run format

# format:check / lint / typecheck をまとめて実行（コミット前の全通し確認）
check:
    npm run format:check
    npm run lint
    npm run check
