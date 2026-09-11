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
      { encoding: "utf8" }
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const { name, css, expectedExitCode } of CASES) {
  test(`check-contrast.mjs: ${name} -> exit ${expectedExitCode}`, () => {
    const result = runCheckContrast(css);
    assert.equal(
      result.status,
      expectedExitCode,
      result.stdout + result.stderr
    );
  });
}
