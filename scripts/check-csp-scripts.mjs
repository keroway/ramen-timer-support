#!/usr/bin/env node
// dist/**/*.html の <script> が public/_headers の CSP (script-src 'self') に
// 違反しないことを検証する (#130)。あわせて _headers 自体の script-src / style-src が
// 'self' のみであることも検証する (#219)。html-validate は HTML の整合性しか見ないため、
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

// public/_headers の Content-Security-Policy 行を取り出す (#219)。無ければ null。
export function extractCsp(headersText) {
  for (const line of headersText.split(/\r?\n/)) {
    const m = /^\s*content-security-policy\s*:\s*(.*)$/i.exec(line);
    if (m) return m[1].trim();
  }
  return null;
}

// script-src / style-src が 'self' のみであることを検証する。以降の HTML 検査は
// この前提 (同一オリジンのみ・インライン不可) をハードコードしているため、
// _headers 側が緩められたら失敗させる。
export function checkCspPolicy(csp) {
  if (csp === null) {
    return ["public/_headers に Content-Security-Policy がありません"];
  }
  const directives = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (!directives.has(name)) directives.set(name, tokens.slice(1));
  }
  const violations = [];
  for (const name of ["script-src", "style-src"]) {
    const values = directives.get(name);
    if (values === undefined) {
      violations.push(`CSP に ${name} がありません`);
    } else if (values.length !== 1 || values[0].toLowerCase() !== "'self'") {
      violations.push(
        `CSP の ${name} は 'self' のみ許可です (現在: ${values.join(" ") || "(空)"})`
      );
    }
  }
  // 要素 / 属性専用ディレクティブは script-src / style-src より優先される (#221)。
  // 存在する場合は HTML 検査の前提 (同一オリジンのみ) を超えないよう 'self' か
  // 属性専用は HTML 検査が常にインライン属性を拒否するので 'none' も許可する。
  // 要素専用の 'none' は HTML 検査が同一オリジンの script / stylesheet を許可し続け
  // 矛盾するため、'self' のみ許可する (#223)。
  const allowed = {
    "script-src-elem": ["'self'"],
    "style-src-elem": ["'self'"],
    "script-src-attr": ["'self'", "'none'"],
    "style-src-attr": ["'self'", "'none'"],
  };
  for (const [name, ok] of Object.entries(allowed)) {
    const values = directives.get(name);
    if (values === undefined) continue;
    const v = values.length === 1 ? values[0].toLowerCase() : "";
    if (!ok.includes(v)) {
      violations.push(
        `CSP の ${name} は ${ok.join(" または ")} のみ許可です (現在: ${values.join(" ") || "(空)"})`
      );
    }
  }
  return violations;
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

// on で始まる属性はインラインイベントハンドラー (onclick 等)。data-onclick は対象外。
function collectHandlers(rawAttrs, violations) {
  for (const name of parseAttrs(rawAttrs).keys()) {
    if (/^on[a-z]/.test(name)) {
      violations.push(
        `インラインイベントハンドラー ${name} は script-src 'self' で拒否されます`
      );
    } else if (name === "style") {
      // style 属性も style-src 'self' で拒否される (#217)。
      violations.push(
        "インライン style 属性は style-src 'self' で拒否されます"
      );
    }
  }
}

// rel に stylesheet を含む link の href は style-src 'self' に従い同一オリジンのみ許可 (#215)。
function collectStylesheet(rawAttrs, siteOrigin, violations) {
  const attrs = parseAttrs(rawAttrs);
  const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
  if (!rel.includes("stylesheet")) return;
  const href = attrs.get("href");
  if (href === undefined) return;
  try {
    if (new URL(href.trim(), `${siteOrigin}/`).origin !== siteOrigin) {
      violations.push(`別オリジンの stylesheet href は拒否されます: ${href}`);
    }
  } catch {
    violations.push(`stylesheet href を解釈できません: ${href}`);
  }
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
  // タグ名の終端は \b ではなく空白 / "/" / ">" の先読みで判定する。\b だと
  // "<textarea-example>" のようなハイフン付き別要素も一致してしまう (#193)。
  // template の内容は文書に挿入されるまで実行されないので、開始 / 終了タグを入れ子の
  // 深さで数え、対応する終了タグ (無ければ入力末尾) まで script を判定しない (#207)。
  // style-src 'self' に反するインライン style 要素と、script-src に反する on* 属性
  // (インラインイベントハンドラー) も同じ走査で検知する (#211)。template 内は対象外。
  const re =
    /<!--(?:-?>|[\s\S]*?(?:-->|$))|<(?<rcdata>textarea|title)(?=[\s/>])(?<rcAttrs>(?:"[^"]*"|'[^']*'|[^'">])*)>[\s\S]*?(?:<\/\k<rcdata>\s*>|$)|<style(?=[\s/>])(?<styleAttrs>(?:"[^"]*"|'[^']*'|[^'">])*)>[\s\S]*?(?:<\/style\s*>|$)|<(?<tplOpen>template)(?=[\s/>])(?<tplAttrs>(?:"[^"]*"|'[^']*'|[^'">])*)>|(?<tplClose><\/template\s*>)|<script(?=[\s/>])(?<attrs>(?:"[^"]*"|'[^']*'|[^'">])*)>(?<body>[\s\S]*?)<\/script\s*>|<(?<tagName>[a-z][^\s/>]*)(?<tagAttrs>(?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let templateDepth = 0;
  for (const m of html.matchAll(re)) {
    const g = m.groups;
    if (g.tplOpen !== undefined && templateDepth === 0)
      collectHandlers(g.tplAttrs, violations);
    if (g.tplOpen !== undefined) templateDepth += 1;
    else if (g.tplClose !== undefined)
      templateDepth = Math.max(0, templateDepth - 1);
    if (templateDepth > 0) continue;
    if (g.styleAttrs !== undefined) {
      violations.push(
        "インライン style 要素は style-src 'self' で拒否されます"
      );
      collectHandlers(g.styleAttrs, violations);
      continue;
    }
    if (g.rcAttrs !== undefined) collectHandlers(g.rcAttrs, violations);
    if (g.tagAttrs !== undefined) {
      collectHandlers(g.tagAttrs, violations);
      if (g.tagName.toLowerCase() === "link")
        collectStylesheet(g.tagAttrs, siteOrigin, violations);
    }
    if (g.attrs === undefined) continue;
    collectHandlers(g.attrs, violations);
    const attrs = parseAttrs(g.attrs);
    const body = g.body;
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
  const csp = extractCsp(
    readFileSync(join(ROOT, "public", "_headers"), "utf8")
  );
  for (const v of checkCspPolicy(csp)) {
    console.error(`public/_headers: ${v}`);
    failures += 1;
  }
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
