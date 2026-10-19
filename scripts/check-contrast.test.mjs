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

const DARK_HOVER_DECL = "    --color-cta-bg-hover: #b8511f;\n";

assert.ok(
  CSS_SOURCE.includes(DARK_HOVER_DECL),
  "global.css のダーク側 --color-cta-bg-hover 宣言が想定と異なります"
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
  {
    name: "trailing_light_root_white",
    css: `${CSS_SOURCE}\n:root {\n  --color-cta-bg: #ffffff;\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "trailing_light_root_safe",
    css: `${CSS_SOURCE}\n:root {\n  --color-cta-bg: #7a3416;\n}\n`,
    expectedExitCode: 0,
  },
  {
    name: "trailing_dark_media_root_white",
    css:
      `${CSS_SOURCE}\n${DARK_MEDIA}\n  :root {\n` +
      "    --color-cta-bg: #ffffff;\n    --color-cta-bg-hover: #ffffff;\n  }\n}\n",
    expectedExitCode: 1,
  },
  {
    name: "trailing_dark_media_root_safe",
    css:
      `${CSS_SOURCE}\n${DARK_MEDIA}\n  :root {\n` +
      "    --color-cta-bg: #7a3416;\n  }\n}\n",
    expectedExitCode: 0,
  },
  {
    name: "cta_primary_trailing_white_background",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background: #ffffff;\n  color: #fff;\n}\n`,
    expectedExitCode: 1,
    expectedStderr: "白文字前提",
  },
  {
    name: "cta_primary_direct_white_background",
    css: CSS_SOURCE.replace(
      ".cta-primary {\n  display: inline-block;\n  background: var(--color-cta-bg);",
      ".cta-primary {\n  display: inline-block;\n  background: #ffffff;"
    ),
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_trailing_background_color_override",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background-color: #ffffff;\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_hover_direct_white_background",
    css: CSS_SOURCE.replace(
      "  background: var(--color-cta-bg-hover);",
      "  background: #ffffff;"
    ),
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_hover_black_text",
    css: `${CSS_SOURCE}\n.cta-primary:hover {\n  color: #000;\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_dark_media_white_background",
    css: `${CSS_SOURCE}\n${DARK_MEDIA}\n  .cta-primary {\n    background: #ffffff;\n  }\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_light_black_text_masked_by_dark_white_text",
    css:
      `${CSS_SOURCE}\n.cta-primary {\n  color: #000;\n}\n` +
      `${DARK_MEDIA}\n  .cta-primary {\n    color: #fff;\n  }\n}\n`,
    expectedExitCode: 1,
    expectedStderr: "白文字前提",
  },
  {
    name: "cta_primary_dark_black_text_masked_by_light_white_text",
    css: `${CSS_SOURCE}\n${DARK_MEDIA}\n  .cta-primary {\n    color: #000;\n  }\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_light_white_background_masked_by_dark_token",
    css:
      `${CSS_SOURCE}\n.cta-primary {\n  background: #ffffff;\n}\n` +
      `${DARK_MEDIA}\n  .cta-primary {\n    background: var(--color-cta-bg);\n  }\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_dark_only_white_text_override_safe",
    css: `${CSS_SOURCE}\n${DARK_MEDIA}\n  .cta-primary {\n    color: #ffffff;\n  }\n}\n`,
    expectedExitCode: 0,
  },
  {
    name: "skip_link_trailing_white_background",
    css: `${CSS_SOURCE}\n.skip-link {\n  background: #ffffff;\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_trailing_same_token_background",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background: var(--color-cta-bg);\n}\n`,
    expectedExitCode: 0,
  },
  {
    name: "cta_primary_important_white_background_masked_by_later_normal",
    css:
      `${CSS_SOURCE}\n.cta-primary {\n  background: #ffffff !important;\n}\n` +
      ".cta-primary {\n  background: var(--color-cta-bg);\n}\n",
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_important_black_text_masked_by_later_normal",
    css:
      `${CSS_SOURCE}\n.cta-primary {\n  color: #000 !important;\n}\n` +
      ".cta-primary {\n  color: #fff;\n}\n",
    expectedExitCode: 1,
    expectedStderr: "白文字前提",
  },
  {
    name: "skip_link_important_safe_background_over_later_white_normal",
    css:
      `${CSS_SOURCE}\n.skip-link {\n  background: var(--color-cta-bg) !important;\n}\n` +
      ".skip-link {\n  background: #ffffff;\n}\n",
    expectedExitCode: 0,
  },
  {
    name: "cta_primary_same_block_important_white_masked_by_normal",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background: #ffffff !important;\n  background: var(--color-cta-bg);\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_same_block_shorthand_white_after_longhand",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background-color: var(--color-cta-bg);\n  background: #ffffff;\n}\n`,
    expectedExitCode: 1,
  },
  {
    name: "cta_primary_same_block_longhand_safe_after_shorthand_white",
    css: `${CSS_SOURCE}\n.cta-primary {\n  background: #ffffff;\n  background-color: var(--color-cta-bg);\n}\n`,
    expectedExitCode: 0,
  },
  {
    name: "width_media_root_white",
    css:
      `${CSS_SOURCE}\n@media (max-width: 600px) {\n  :root {\n` +
      "    --color-cta-bg: #ffffff;\n    --color-cta-bg-hover: #ffffff;\n  }\n}\n",
    expectedExitCode: 1,
  },
  {
    name: "supports_root_white",
    css:
      `${CSS_SOURCE}\n@supports (display: grid) {\n  :root {\n` +
      "    --color-cta-bg: #ffffff;\n    --color-cta-bg-hover: #ffffff;\n  }\n}\n",
    expectedExitCode: 1,
    expectedStderr: "白文字との対比",
  },
  {
    name: "supports_root_safe",
    css:
      `${CSS_SOURCE}\n@supports (display: grid) {\n  :root {\n` +
      "    --color-cta-bg: #7a3416;\n  }\n}\n",
    expectedExitCode: 0,
  },
  {
    name: "light_media_root_white",
    css:
      `${CSS_SOURCE}\n@media (prefers-color-scheme: light) {\n  :root {\n` +
      "    --color-cta-bg: #ffffff;\n    --color-cta-bg-hover: #ffffff;\n  }\n}\n",
    expectedExitCode: 1,
  },
  {
    name: "width_media_root_safe",
    css:
      `${CSS_SOURCE}\n@media (max-width: 600px) {\n  :root {\n` +
      "    --color-cta-bg: #7a3416;\n  }\n}\n",
    expectedExitCode: 0,
  },
  {
    name: "light_media_root_safe",
    css:
      `${CSS_SOURCE}\n@media (prefers-color-scheme: light) {\n  :root {\n` +
      "    --color-cta-bg: #7a3416;\n  }\n}\n",
    expectedExitCode: 0,
  },
  {
    name: "light_media_root_white_hover_only",
    css:
      `${CSS_SOURCE}\n@media (prefers-color-scheme: light) {\n  :root {\n` +
      "    --color-cta-bg-hover: #ffffff;\n  }\n}\n",
    expectedExitCode: 1,
    expectedStderr: "白文字との対比",
  },
  {
    name: "dark_omitted_token_resolves_from_common_root",
    css: CSS_SOURCE.replace(DARK_HOVER_DECL, ""),
    expectedExitCode: 0,
  },
  {
    name: "dark_omitted_token_inherits_unsafe_common_value",
    css: CSS_SOURCE.replace(DARK_HOVER_DECL, "").replace(
      OLD_HOVER_DECL,
      "  --color-cta-bg-hover: #ffffff;"
    ),
    expectedExitCode: 1,
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
