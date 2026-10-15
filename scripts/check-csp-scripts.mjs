#!/usr/bin/env node
// dist/**/*.html の <script> が public/_headers の CSP (script-src 'self') に
// 違反しないことを検証する (#130)。html-validate は HTML の整合性しか見ないため、
// インラインスクリプトや別オリジンの src を追加しても a11y 検査が通ってしまう。
// 許可: 同一オリジンの src 付き script / 実行されないデータブロック (type が JS 以外)。
// CSP の script-src を変更する場合は、この検査も合わせて更新する。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const JS_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

export function readSiteOrigin() {
  const config = readFileSync(join(ROOT, "astro.config.mjs"), "utf8");
  const match = /\bsite:\s*["']([^"']+)["']/.exec(config);
  if (!match) throw new Error("astro.config.mjs の site を取得できません");
  return new URL(match[1]).origin;
}

function attr(attrs, name) {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    "i"
  );
  const m = re.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

export function findViolations(html, siteOrigin) {
  const violations = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const m of html.matchAll(re)) {
    const attrs = m[1];
    const body = m[2];
    const type = (attr(attrs, "type") ?? "").trim().toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    const src = attr(attrs, "src");
    if (src === undefined) {
      violations.push(
        "インラインスクリプトは script-src 'self' で拒否されます" +
          (body.trim() ? "" : " (空の script 要素)")
      );
      continue;
    }
    let origin;
    try {
      origin = new URL(src, `${siteOrigin}/`).origin;
    } catch {
      violations.push(`script src を解釈できません: ${src}`);
      continue;
    }
    if (origin !== siteOrigin) {
      violations.push(`別オリジンの script src は拒否されます: ${src}`);
    }
  }
  return violations;
}

function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

function main() {
  const siteOrigin = readSiteOrigin();
  let failures = 0;
  let count = 0;
  for (const file of htmlFiles(DIST)) {
    count += 1;
    for (const v of findViolations(readFileSync(file, "utf8"), siteOrigin)) {
      console.error(`${file}: ${v}`);
      failures += 1;
    }
  }
  if (count === 0) {
    console.error("dist/ に HTML がありません。先に build を実行してください");
    process.exit(1);
  }
  if (failures > 0) process.exit(1);
  console.log(`CSP script-src 検査: ${count} ファイル OK`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
