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
// HTML Standard の「JavaScript MIME type essence match」に列挙された互換 type (#147)。
// ここに無い type は実行されないデータブロックとして扱う。
const JS_TYPES = new Set([
  "",
  "module",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

export function readSiteOrigin() {
  const config = readFileSync(join(ROOT, "astro.config.mjs"), "utf8");
  const match = /\bsite:\s*["']([^"']+)["']/.exec(config);
  if (!match) throw new Error("astro.config.mjs の site を取得できません");
  return new URL(match[1]).origin;
}

// ブラウザは属性値の文字参照を復号してから URL として解釈する。URL の判定に
// 影響しうる名前付き参照のみ扱い、未知の名前はそのまま残す (#137)。
const NAMED_REFS = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  sol: "/",
  bsol: "\\",
  colon: ":",
  period: ".",
  Tab: "\t",
  NewLine: "\n",
};

function decodeCharRefs(value) {
  return value.replace(
    /&(?:#[xX]([0-9a-fA-F]+);?|#([0-9]+);?|([A-Za-z]+);)/g,
    (whole, hex, dec, name) => {
      if (name !== undefined) return NAMED_REFS[name] ?? whole;
      const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(dec);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    }
  );
}

// 属性列を先頭から順に走査し、引用符内の文字列を別属性として拾わない (#139)。
// 同名属性が重複した場合は HTML 仕様どおり最初のものを採用する。
function parseAttrs(attrs) {
  const map = new Map();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of attrs.matchAll(re)) {
    const name = m[1].toLowerCase();
    if (map.has(name)) continue;
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    map.set(name, decodeCharRefs(raw));
  }
  return map;
}

export function findViolations(html, siteOrigin) {
  const violations = [];
  // HTML コメントは実行されないので、script と同じ正規表現の選択肢として先頭から
  // 順に消費し読み飛ばす。script 本文中の "<!--" はその script が先に消費される (#144)。
  // 閉じていないコメントは仕様どおり入力末尾まで、"<!-->" / "<!--->" は空コメント。
  // textarea / title (RCDATA) と style (raw text) は中身がテキスト扱いなので、対応する終了タグ
  // (無ければ入力末尾) まで同様に読み飛ばす (#153)。終了タグは開始した要素名と
  // 同じものだけを対象にする (#158)。script 以外の開始タグも最後の選択肢として
  // 引用符付き属性値ごと消費し、属性値内の "<script>" を拾わない (#167)。
  const re =
    /<!--(?:-?>|[\s\S]*?(?:-->|$))|<(?<rcdata>textarea|title|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?(?:<\/\k<rcdata>\s*>|$)|<script\b(?<attrs>(?:"[^"]*"|'[^']*'|[^'">])*)>(?<body>[\s\S]*?)<\/script\s*>|<[a-z][^\s/>]*(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  for (const m of html.matchAll(re)) {
    if (m.groups.attrs === undefined) continue;
    const attrs = parseAttrs(m.groups.attrs);
    const body = m.groups.body;
    const type = (attrs.get("type") ?? "").trim().toLowerCase();
    if (!JS_TYPES.has(type)) continue;
    const src = attrs.get("src");
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
