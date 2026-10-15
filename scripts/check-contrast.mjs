#!/usr/bin/env node
// src/styles/global.css の CTA ボタン背景トークンが、白文字との
// コントラスト比 4.5:1 (WCAG AA) を満たすことを検証する。
// 対象: :root (ライトモード) と @media (prefers-color-scheme: dark) の
// --color-cta-bg / --color-cta-bg-hover。global.css の変更のみで
// 気づかれずに閾値を割り込む再発 (#90) を防ぐ。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS_PATH = fileURLToPath(
  new URL("../src/styles/global.css", import.meta.url)
);
const MIN_CONTRAST = 4.5;
const TOKENS = ["--color-cta-bg", "--color-cta-bg-hover"];
// 背景トークンを白文字前提で検査しているため、これらのセレクタの文字色も
// 白であることを前提条件として検証する (#128)。
const WHITE_TEXT_SELECTORS = [".cta-primary", ".skip-link"];
const WHITE_VALUES = new Set(["#fff", "#ffffff", "white"]);

function relativeLuminance(hex) {
  const channels = [0, 2, 4].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255
  );
  const [r, g, b] = channels.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastWithWhite(hex) {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block) {
  const decls = new Map();
  for (const match of stripComments(block).matchAll(
    /(--[\w-]+)\s*:\s*([^;]+);/g
  )) {
    decls.set(match[1], match[2].trim());
  }
  return decls;
}

function resolve(decls, value) {
  let current = value;
  const visited = new Set();
  while (current.startsWith("var(")) {
    const name = current.slice(4, -1).trim();
    if (visited.has(name)) {
      throw new Error(
        `カスタムプロパティが循環参照しています: ${[...visited, name].join(" -> ")}`
      );
    }
    visited.add(name);
    if (!decls.has(name)) {
      throw new Error(`未定義のカスタムプロパティを参照しています: ${name}`);
    }
    current = decls.get(name);
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(current)) {
    throw new Error(`16進カラー以外は未対応です: ${current}`);
  }
  return current.slice(1);
}

// 波括弧のネストを考慮して { prelude, body } の列を出現順に返す。
function parseBlocks(source) {
  const blocks = [];
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0) {
        prelude = source.slice(start, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude, body: source.slice(bodyStart, i) });
        start = i + 1;
      }
    }
  }
  return blocks;
}

const DARK_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/;

// :root の宣言を CSS 全体から出現順に解決する (#127, #129)。
// ライトは無条件の :root のみ、ダークはそれに加えてダーク条件内の :root を
// 同じソース順で重ねる（後勝ち）。他セレクタの同名プロパティは混入させない (#123)。
function collectModes(source) {
  const light = new Map();
  const dark = new Map();
  let hasLightRoot = false;
  let hasDarkRoot = false;
  for (const { prelude, body } of parseBlocks(source)) {
    if (prelude === ":root") {
      hasLightRoot = true;
      for (const [k, v] of parseDeclarations(body)) {
        light.set(k, v);
        dark.set(k, v);
      }
    } else if (DARK_MEDIA.test(prelude)) {
      for (const inner of parseBlocks(body)) {
        if (inner.prelude !== ":root") continue;
        hasDarkRoot = true;
        for (const [k, v] of parseDeclarations(inner.body)) dark.set(k, v);
      }
    }
  }
  if (!hasLightRoot) {
    throw new Error("ライトモードの :root ブロックが見つかりません");
  }
  if (!hasDarkRoot) {
    throw new Error("ダークモードの :root ブロックが見つかりません");
  }
  return [
    { name: "light", decls: light },
    { name: "dark", decls: dark },
  ];
}

const css = stripComments(readFileSync(CSS_PATH, "utf8"));
const modes = collectModes(css);

let hasFailure = false;
for (const { name, decls } of modes) {
  for (const token of TOKENS) {
    if (!decls.has(token)) {
      throw new Error(`${name} モードに ${token} がありません`);
    }
    const hex = resolve(decls, decls.get(token));
    const ratio = contrastWithWhite(hex);
    const ok = ratio >= MIN_CONTRAST;
    if (!ok) hasFailure = true;
    console.log(
      `${ok ? "OK " : "NG "} ${name} ${token} #${hex} white contrast ${ratio.toFixed(3)}`
    );
  }
}

for (const selector of WHITE_TEXT_SELECTORS) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`));
  if (!block) {
    throw new Error(`${selector} のルールが見つかりません`);
  }
  const color = block[1].match(/(?:^|[;\s])color\s*:\s*([^;]+?)\s*(?:;|$)/);
  const value = color?.[1].toLowerCase();
  const ok = value !== undefined && WHITE_VALUES.has(value);
  if (!ok) hasFailure = true;
  console.log(
    `${ok ? "OK " : "NG "} ${selector} color ${value ?? "(未指定)"} (白文字前提)`
  );
}

if (hasFailure) {
  console.error(
    `\n白文字との対比が ${MIN_CONTRAST}:1 未満のトークン、または白文字前提に反する文字色があります。`
  );
  process.exit(1);
}
