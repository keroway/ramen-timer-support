#!/usr/bin/env node
// check-contrast.mjs の CSS コメント解析に関する回帰検査 (#99)。
// parseDeclarations() がコメント内のカスタムプロパティも宣言として拾ってしまい、
// 閾値未達の見逃し・正常な配色の誤検知を引き起こしていた不具合を再発させない。

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CSS_SOURCE = readFileSync(
  join(REPO_ROOT, "src/styles/global.css"),
  "utf8"
);
const SCRIPT_SOURCE = readFileSync(
  join(REPO_ROOT, "scripts/check-contrast.mjs"),
  "utf8"
);

const OLD_HOVER_DECL = "  --color-cta-bg-hover: #b8511f;";

assert.ok(
  CSS_SOURCE.includes(OLD_HOVER_DECL),
  "global.css の --color-cta-bg-hover 宣言が想定と異なります"
);

const LIGHT_CTA_DECL = "  --color-cta-bg: var(--color-accent);";
const DARK_MEDIA = "@media (prefers-color-scheme: dark) {";

assert.ok(
  CSS_SOURCE.includes(LIGHT_CTA_DECL) && CSS_SOURCE.includes(DARK_MEDIA),
  "global.css のライト側 --color-cta-bg 宣言またはダーク @media が想定と異なります"
);

const CASES = [
  { name: "baseline", css: CSS_SOURCE, expectedExitCode: 0 },
  {
    name: "white_hover",
    css: CSS_SOURCE.replace(OLD_HOVER_DECL, "  --color-cta-bg-hover: #ffffff;"),
    expectedExitCode: 1,
  },
  {
    name: "white_hover_with_old_value_comment",
    css: CSS_SOURCE.replace(
      OLD_HOVER_DECL,
      "  --color-cta-bg-hover: #ffffff;\n" +
        "  /* Previous value: --color-cta-bg-hover: #b8511f; */"
    ),
    expectedExitCode: 1,
  },
  {
    name: "safe_hover_with_white_comment",
    css: CSS_SOURCE.replace(
      OLD_HOVER_DECL,
      `${OLD_HOVER_DECL}\n  /* Example: --color-cta-bg-hover: #ffffff; */`
    ),
    expectedExitCode: 0,
  },
  {
    name: "self_referencing_var",
    css: CSS_SOURCE.replace(
      "--color-cta-bg: var(--color-accent);",
      "--color-cta-bg: var(--color-cta-bg);"
    ),
    expectedExitCode: 1,
    expectedStderr: "循環参照",
  },
  {
    name: "mutually_referencing_vars",
    css: CSS_SOURCE.replace(
      "--color-accent: #8b3d1a;",
      "--color-accent: var(--color-cta-bg);"
    ),
    expectedExitCode: 1,
    expectedStderr: "循環参照",
  },
  {
    name: "white_root_masked_by_unrelated_selector",
    css: CSS_SOURCE.replace(
      LIGHT_CTA_DECL,
      "  --color-cta-bg: #ffffff;"
    ).replace(
      DARK_MEDIA,
      `.unused {\n  --color-cta-bg: #8b3d1a;\n}\n\n${DARK_MEDIA}`
    ),
    expectedExitCode: 1,
  },
  {
    name: "safe_root_with_unrelated_white_selector",
    css: CSS_SOURCE.replace(
      DARK_MEDIA,
      `.unused {\n  --color-cta-bg: #ffffff;\n}\n\n${DARK_MEDIA}`
    ),
    expectedExitCode: 0,
  },
  {
    name: "cta_primary_black_text",
    css: CSS_SOURCE.replace(
      ".cta-primary {\n  display: inline-block;\n  background: var(--color-cta-bg);\n  color: #fff;",
      ".cta-primary {\n  display: inline-block;\n  background: var(--color-cta-bg);\n  color: #000;"
    ),
    expectedExitCode: 1,
    expectedStderr: "白文字前提",
  },
  {
    name: "skip_link_black_text",
    css: CSS_SOURCE.replace(
      "  background: var(--color-cta-bg);\n  color: #fff;\n  padding: var(--space-two) var(--space-three);",
      "  background: var(--color-cta-bg);\n  color: #000;\n  padding: var(--space-two) var(--space-three);"
    ),
    expectedExitCode: 1,
    expectedStderr: "白文字前提",
  },
  {
    name: "cta_primary_text_color_removed",
    css: CSS_SOURCE.replace(
      "  background: var(--color-cta-bg);\n  color: #fff;\n  text-decoration: none;",
      "  background: var(--color-cta-bg);\n  text-decoration: none;"
    ),
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_long_white_hex",
    css: CSS_SOURCE.replace(
      ".cta-primary {\n  display: inline-block;\n  background: var(--color-cta-bg);\n  color: #fff;",
      ".cta-primary {\n  display: inline-block;\n  background: var(--color-cta-bg);\n  color: #FFFFFF;"
    ),
    expectedExitCode: 0,
  },
];

function runCheckContrast(cssContent) {
  const dir = mkdtempSync(join(tmpdir(), "ramen-support-contrast-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "src/styles"), { recursive: true });
    writeFileSync(join(dir, "scripts/check-contrast.mjs"), SCRIPT_SOURCE);
    writeFileSync(join(dir, "src/styles/global.css"), cssContent);
    return spawnSync(
      process.execPath,
      [join(dir, "scripts/check-contrast.mjs")],
      { encoding: "utf8", timeout: 5000 }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { name, css, expectedExitCode, expectedStderr } of CASES) {
  test(`check-contrast.mjs: ${name} -> exit ${expectedExitCode}`, () => {
    const result = runCheckContrast(css);
    assert.equal(
      result.status,
      expectedExitCode,
      result.stdout + result.stderr
    );
    if (expectedStderr) {
      assert.ok(result.stderr.includes(expectedStderr), result.stderr);
    }
  });
}
