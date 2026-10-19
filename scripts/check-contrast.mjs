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
// 背景トークンを白文字前提で検査しているため、CTA / skip-link の文字色も
// 白であることを前提条件として検証する (#128)。
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
const LIGHT_MEDIA = /^@media\s*\(\s*prefers-color-scheme\s*:\s*light\s*\)$/;

// @media の prelude が指定モードに適用されるか。配色条件のみモードで切り分け、
// それ以外の条件 (幅・印刷など) は呼び出し側が variant として個別に扱う (#143, #151)。
function schemeAppliesTo(prelude, mode) {
  if (DARK_MEDIA.test(prelude)) return mode === "dark";
  if (LIGHT_MEDIA.test(prelude)) return mode === "light";
  return null;
}

// 条件付き at-rule (@media / @supports) か。@supports も条件 variant として扱う (#157)。
function isConditional(prelude) {
  return prelude.startsWith("@media") || prelude.startsWith("@supports");
}

// 配色条件以外の @media / @supports の入れ子の連なり (外側 -> 内側の prelude 配列) を、
// 途中経路も含めて重複なく集める。入れ子条件は同時成立する経路ごとに別 variant で
// 検査する (#163)。キーは " > " 連結。
function collectConditions(source, chain = [], found = new Map()) {
  for (const { prelude, body } of parseBlocks(source)) {
    if (!isConditional(prelude)) continue;
    const isScheme = DARK_MEDIA.test(prelude) || LIGHT_MEDIA.test(prelude);
    const next = isScheme ? chain : [...chain, prelude];
    if (!isScheme) found.set(next.join(" > "), next);
    collectConditions(body, next, found);
  }
  return found;
}

// 指定モード・指定条件 (条件の連なり。空 = 条件なし) で適用される :root の宣言を、
// ソース順に後勝ちで重ねる。配色以外の条件付き at-rule は、入れ子の外側から順に
// condition と一致するときだけ適用する。他セレクタの同名プロパティは混入させない (#123)。
function applyRoots(source, mode, condition, decls, seen, depth = 0) {
  for (const { prelude, body } of parseBlocks(source)) {
    if (prelude === ":root") {
      seen.root = true;
      for (const [k, v] of parseDeclarations(body)) decls.set(k, v);
    } else if (isConditional(prelude)) {
      const scheme = schemeAppliesTo(prelude, mode);
      if (scheme === false) continue;
      if (scheme === null && prelude !== condition[depth]) continue;
      if (scheme === true)
        seen[mode === "dark" ? "darkRoot" : "lightRoot"] = true;
      applyRoots(
        body,
        mode,
        condition,
        decls,
        seen,
        scheme === null ? depth + 1 : depth
      );
    }
  }
}

// :root の宣言を CSS 全体から出現順に解決する (#127, #129, #151)。
// light / dark の各モードに、配色以外の @media 条件ごとの variant（条件なし + 各条件）を
// 掛け合わせて検査する。条件が満たされない場合と満たされる場合の両方を見るため、
// 幅条件内の上書きも、それが外れた状態の元の値も見逃さない。
function collectModes(source) {
  const conditions = [[], ...collectConditions(source).values()];
  const modes = [];
  let hasLightRoot = false;
  let hasDarkRoot = false;
  for (const mode of ["light", "dark"]) {
    for (const condition of conditions) {
      const decls = new Map();
      const seen = {};
      applyRoots(source, mode, condition, decls, seen);
      if (condition.length === 0) {
        if (seen.root) hasLightRoot = true;
        if (mode === "dark" && seen.darkRoot) hasDarkRoot = true;
      }
      modes.push({
        name:
          condition.length === 0 ? mode : `${mode} ${condition.join(" > ")}`,
        mode,
        decls,
      });
    }
  }
  if (!hasLightRoot) {
    throw new Error("ライトモードの :root ブロックが見つかりません");
  }
  if (!hasDarkRoot) {
    throw new Error("ダークモードの :root ブロックが見つかりません");
  }
  return modes;
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

// 宣言を適用する。!important は通常宣言より優先し、同じ重要度ならソース順で後勝ち (#149)。
function applyDecl(props, name, decl) {
  const prev = props.get(name);
  if (prev?.important && !decl.important) return;
  props.set(name, decl);
}

// 通常プロパティ (color / background など) の宣言を { value, important, order } で返す。
function parseProps(body) {
  const props = new Map();
  let order = 0;
  for (const decl of body.split(";")) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    const name = decl.slice(0, idx).trim().toLowerCase();
    if (!name || name.startsWith("--")) continue;
    const raw = decl.slice(idx + 1);
    applyDecl(props, name, {
      value: raw
        .replace(/\s*!important\s*$/i, "")
        .trim()
        .toLowerCase(),
      important: /!important\s*$/i.test(raw),
      order: order++,
    });
  }
  return props;
}

// @media の prelude が指定モードに適用されるか。配色条件のみモードで切り分け、
// それ以外の条件 (幅・印刷など) は両モードに適用されるものとして扱う (#143)。
function mediaAppliesTo(prelude, mode) {
  return schemeAppliesTo(prelude, mode) !== false;
}

// セレクタに一致するルールの宣言を、指定モードに適用される @media 内も含めて
// ソース順に集める。
function collectRules(source, selector, mode) {
  const rules = [];
  for (const { prelude, body } of parseBlocks(source)) {
    if (isConditional(prelude)) {
      if (mediaAppliesTo(prelude, mode)) {
        rules.push(...collectRules(body, selector, mode));
      }
    } else if (prelude.split(",").some((s) => s.trim() === selector)) {
      rules.push(parseProps(body));
    }
  }
  return rules;
}

// names 間 (background / background-color など) も、ルール内の宣言順を保って重ねる (#161)。
function lastValue(rules, names) {
  const merged = new Map();
  for (const props of rules) {
    const decls = names.filter((n) => props.has(n)).map((n) => props.get(n));
    decls.sort((a, b) => a.order - b.order);
    for (const decl of decls) applyDecl(merged, "value", decl);
  }
  return merged.get("value")?.value;
}

// 各セレクタの実効背景が検査対象トークンを参照し、実効文字色が白であることを
// 後続ルールによる上書きも含めて検証する (#140)。
const WHITE_TEXT_TARGETS = [
  { selector: ".cta-primary", bg: "--color-cta-bg" },
  {
    selector: ".cta-primary:hover",
    bg: "--color-cta-bg-hover",
    base: ".cta-primary",
  },
  { selector: ".skip-link", bg: "--color-cta-bg" },
];

for (const mode of ["light", "dark"]) {
  for (const { selector, bg, base } of WHITE_TEXT_TARGETS) {
    const own = collectRules(css, selector, mode);
    if (own.length === 0) {
      throw new Error(`${selector} のルールが見つかりません`);
    }
    const rules = [...(base ? collectRules(css, base, mode) : []), ...own];
    const bgValue = lastValue(rules, ["background", "background-color"]);
    const bgOk = bgValue === `var(${bg})`;
    const color = lastValue(rules, ["color"]);
    const colorOk = color !== undefined && WHITE_VALUES.has(color);
    if (!bgOk || !colorOk) hasFailure = true;
    console.log(
      `${bgOk ? "OK " : "NG "} ${mode} ${selector} background ${bgValue ?? "(未指定)"} (期待: var(${bg}))`
    );
    console.log(
      `${colorOk ? "OK " : "NG "} ${mode} ${selector} color ${color ?? "(未指定)"} (白文字前提)`
    );
  }
}

if (hasFailure) {
  console.error(
    `\n白文字との対比が ${MIN_CONTRAST}:1 未満のトークン、または白文字前提に反する文字色があります。`
  );
  process.exit(1);
}
