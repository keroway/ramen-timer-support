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
  while (current.startsWith("var(")) {
    const name = current.slice(4, -1).trim();
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

const css = stripComments(readFileSync(CSS_PATH, "utf8"));
const darkMatch = css.match(
  /@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]+)}/
);
if (!darkMatch) {
  throw new Error("ダークモードの :root ブロックが見つかりません");
}

const rootBlock = css.split("@media")[0];
const modes = [
  { name: "light", decls: parseDeclarations(rootBlock) },
  { name: "dark", decls: parseDeclarations(darkMatch[1]) },
];

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

if (hasFailure) {
  console.error(
    `\n白文字との対比が ${MIN_CONTRAST}:1 未満のトークンがあります。`
  );
  process.exit(1);
}
