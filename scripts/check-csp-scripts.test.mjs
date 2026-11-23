#!/usr/bin/env node
// check-csp-scripts.mjs の回帰検査 (#130)。CSP の script-src 'self' に反する
// script を検知でき、許可すべきものは誤検知しないことを確認する。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkCspPolicy,
  extractCsp,
  findViolations,
  readSiteOrigin,
} from "./check-csp-scripts.mjs";

const headersCsp = () =>
  extractCsp(
    readFileSync(new URL("../public/_headers", import.meta.url), "utf8")
  );

test("現行の public/_headers の CSP は通る (#219)", () => {
  assert.deepEqual(checkCspPolicy(headersCsp()), []);
});

test("CSP の緩和・削除を拒否する (#219)", () => {
  const base = headersCsp();
  assert.equal(
    checkCspPolicy(
      `${base}; x`.replace(
        "style-src 'self'",
        "style-src 'self' 'unsafe-inline'"
      )
    ).length,
    1
  );
  assert.equal(
    checkCspPolicy(
      base.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")
    ).length,
    1
  );
  assert.equal(
    checkCspPolicy(
      base.replace(
        "script-src 'self'",
        "script-src https://cdn.example.invalid"
      )
    ).length,
    1
  );
  assert.equal(
    checkCspPolicy(base.replace("style-src 'self'; ", "")).length,
    1
  );
  assert.equal(checkCspPolicy(null).length, 1);
  assert.equal(checkCspPolicy("default-src 'self'").length, 2);
});

test("要素 / 属性専用ディレクティブによる許可元の変更を拒否する (#221)", () => {
  const base = headersCsp();
  for (const name of [
    "script-src-elem",
    "style-src-elem",
    "script-src-attr",
    "style-src-attr",
  ]) {
    for (const value of [
      "*",
      "https://cdn.example.invalid",
      "'unsafe-inline'",
    ]) {
      assert.equal(
        checkCspPolicy(`${base}; ${name} ${value}`).length,
        1,
        `${name} ${value}`
      );
    }
    assert.deepEqual(checkCspPolicy(`${base}; ${name} 'self'`), []);
    // 要素専用の none は HTML 検査と矛盾するので拒否、属性専用は許可 (#223)
    assert.equal(
      checkCspPolicy(`${base}; ${name} 'none'`).length,
      name.endsWith("-elem") ? 1 : 0,
      `${name} 'none'`
    );
  }
});

test("_headers から CSP 行を抽出する (#219)", () => {
  assert.equal(
    extractCsp("/*\n  Content-Security-Policy: script-src 'self'\n"),
    "script-src 'self'"
  );
  assert.equal(extractCsp("/*\n  X-Frame-Options: DENY\n"), null);
});

const GOOD = "script-src 'self'; style-src 'self'";

test("限定パスだけの CSP は全体ポリシー欠落として拒否する (#229)", () => {
  const csp = extractCsp(`/private/*\n  Content-Security-Policy: ${GOOD}\n`);
  assert.equal(csp, null);
  assert.equal(checkCspPolicy(csp).length, 1);
});

test("限定パスの後の /* の CSP を検証する (#229)", () => {
  const csp = extractCsp(
    `/private/*\n  Content-Security-Policy: ${GOOD}\n\n/*\n  Content-Security-Policy: script-src *; style-src *\n`
  );
  assert.equal(csp, "script-src *; style-src *");
  assert.equal(checkCspPolicy(csp).length, 2);
});

test("/* より前の限定パスがあっても /* の CSP を取り出す (#229)", () => {
  assert.equal(
    extractCsp(
      `/a/*\n  X-Foo: 1\n/*\n  Content-Security-Policy: ${GOOD}\n/b/*\n  Content-Security-Policy: x\n`
    ),
    GOOD
  );
});

const SITE = "https://ramentimer.keroway.com";
const page = (body) =>
  `<!doctype html><html lang="ja"><body>${body}</body></html>`;

test("site origin を astro.config.mjs から取得する", () => {
  assert.equal(readSiteOrigin(), SITE);
});

test("スクリプトなしは通る", () => {
  assert.deepEqual(findViolations(page("<main></main>"), SITE), []);
});

test("インラインスクリプトを拒否する", () => {
  const html = page("<script>document.title = 'changed'</script>");
  assert.equal(findViolations(html, SITE).length, 1);
});

test("別オリジンの src を拒否する", () => {
  const html = page('<script src="https://example.invalid/app.js"></script>');
  assert.equal(findViolations(html, SITE).length, 1);
});

test("プロトコル相対 URL の別オリジンを拒否する", () => {
  const html = page('<script src="//example.invalid/app.js"></script>');
  assert.equal(findViolations(html, SITE).length, 1);
});

test("文字参照で書かれた別オリジンの src を拒否する (#137)", () => {
  for (const src of [
    "&#47;&#47;example.invalid/app.js",
    "&#x2F;&#x2f;example.invalid/app.js",
    "&sol;&sol;example.invalid/app.js",
    "https&colon;//example.invalid/app.js",
  ]) {
    const html = page(`<script src="${src}"></script>`);
    assert.equal(findViolations(html, SITE).length, 1, src);
  }
});

test("文字参照で書かれた同一オリジンの src は通る (#137)", () => {
  const html = page('<script src="&#47;_astro/app.js"></script>');
  assert.deepEqual(findViolations(html, SITE), []);
});

test("文字参照で書かれた type のデータブロックは通る (#137)", () => {
  const html = page('<script type="application&sol;ld+json">{"a":1}</script>');
  assert.deepEqual(findViolations(html, SITE), []);
});

test("同一オリジンの外部ファイルは通る", () => {
  const html = page(
    `<script src="/_astro/app.js"></script><script type="module" src="${SITE}/a.js"></script>`
  );
  assert.deepEqual(findViolations(html, SITE), []);
});

test("実行されないデータブロックは通る", () => {
  const html = page('<script type="application/ld+json">{"a":1}</script>');
  assert.deepEqual(findViolations(html, SITE), []);
});

test("別属性の引用符内の偽 src に惑わされず別オリジンを拒否する (#139)", () => {
  const html = page(
    '<script data-note=" src=/_astro/safe.js" src="https://example.invalid/app.js"></script>'
  );
  assert.equal(findViolations(html, SITE).length, 1);
});

test("別属性の引用符内の偽 type に惑わされずインラインを拒否する (#139)", () => {
  const html = page(
    '<script data-note=" type=application/json">alert(1)</script>'
  );
  assert.equal(findViolations(html, SITE).length, 1);
});

test("属性順序が違っても src と type を正しく読む (#139)", () => {
  const html = page(
    `<script src="/_astro/a.js" data-x="y" type="module"></script><script data-x='>' type="application/ld+json">{}</script>`
  );
  assert.deepEqual(findViolations(html, SITE), []);
});

test("HTML コメント内の script は対象外 (#144)", () => {
  const html = page(`<!-- <script>alert(1)</script> -->`);
  assert.deepEqual(findViolations(html, SITE), []);
});

test("コメント終了後の本物の script は検出する (#144)", () => {
  const html = page(`<!-- <script>a()</script> --><script>alert(1)</script>`);
  assert.equal(findViolations(html, SITE).length, 1);
});

test("script 本文中の <!-- でコメント扱いにならず後続を検出する (#144)", () => {
  const html = page(
    `<script type="module" src="/_astro/a.js"></script><script>var a = "<!--";</script><script>b()</script>`
  );
  assert.equal(findViolations(html, SITE).length, 2);
});

test("空コメントと閉じていないコメントを仕様どおり扱う (#144)", () => {
  assert.equal(
    findViolations(page(`<!--><script>a()</script>`), SITE).length,
    1
  );
  assert.equal(
    findViolations(page(`<!---><script>a()</script>`), SITE).length,
    1
  );
  assert.deepEqual(findViolations(page(`<!-- <script>a()</script>`), SITE), []);
});

test("textarea・title 内の script 文字列は対象外で、終了後の本物は検出する (#153)", () => {
  assert.deepEqual(
    findViolations(
      page(`<textarea aria-label=example><script>alert(1)</script></textarea>`),
      SITE
    ),
    []
  );
  assert.deepEqual(
    findViolations(
      page(`<title>Example <script>alert(1)</script></title>`),
      SITE
    ),
    []
  );
  assert.equal(
    findViolations(
      page(`<textarea><script>a()</script></textarea><script>b()</script>`),
      SITE
    ).length,
    1
  );
  assert.equal(
    findViolations(page(`<title>t</title><script>b()</script>`), SITE).length,
    1
  );
});

test("textarea・title は開始した要素と同名の終了タグまで読み飛ばす (#158)", () => {
  assert.deepEqual(
    findViolations(
      page(`<textarea></title><script>alert(1)</script></textarea>`),
      SITE
    ),
    []
  );
  assert.deepEqual(
    findViolations(
      page(`<title></textarea><script>alert(1)</script></title>`),
      SITE
    ),
    []
  );
  assert.equal(
    findViolations(
      page(
        `<textarea></title><script>a()</script></textarea><script>b()</script>`
      ),
      SITE
    ).length,
    1
  );
});

test("style 内の script 文字列は対象外で、終了後の本物は検出する (#187)", () => {
  // style 要素自体は #211 で違反になるため、スクリプト検出の数だけを確認する。
  assert.equal(
    findViolations(page(`<style>/* <script>alert(1)</script> */</style>`), SITE)
      .length,
    1
  );
  assert.equal(
    findViolations(
      page(`<style>/* <script>a()</script> */</style><script>b()</script>`),
      SITE
    ).length,
    2
  );
});

test("インライン style 要素を拒否する (#211)", () => {
  assert.equal(
    findViolations(
      `<!doctype html><html lang="ja"><head><style>body { display: none; }</style></head><body></body></html>`,
      SITE
    ).length,
    1
  );
  assert.equal(
    findViolations(page('<style media="print">a{}</style>'), SITE).length,
    1
  );
});

test("別オリジン・プロトコル相対の stylesheet 参照を拒否する (#215)", () => {
  for (const html of [
    '<link rel="stylesheet" href="https://example.invalid/style.css">',
    '<link rel="stylesheet" href="//example.invalid/style.css">',
    '<link href="https://example.invalid/style.css" rel="preload STYLESHEET">',
    '<link rel="stylesheet" href="https&colon;//example.invalid/style.css">',
  ]) {
    assert.equal(findViolations(page(html), SITE).length, 1, html);
  }
});

test("同一オリジンの stylesheet 参照と非 stylesheet の link は通る (#215)", () => {
  for (const html of [
    '<link rel="stylesheet" href="/styles.css">',
    '<link rel="stylesheet" href="styles.css">',
    `<link rel="stylesheet" href="${SITE}/styles.css">`,
    '<link rel="icon" href="https://example.invalid/favicon.svg">',
    '<link rel="canonical" href="https://example.invalid/">',
  ]) {
    assert.deepEqual(findViolations(page(html), SITE), [], html);
  }
});

test("インラインイベントハンドラー属性を拒否する (#211)", () => {
  for (const html of [
    '<button type="button" onclick="alert(1)">Example</button>',
    "<img src=a.png onerror=alert(1)>",
    '<a href="/" ONFOCUS="x()">Example</a>',
    '<textarea onfocus="x()"></textarea>',
  ]) {
    assert.equal(findViolations(page(html), SITE).length, 1, html);
  }
});

test("インライン style 属性を拒否する (#217)", () => {
  for (const html of [
    '<main style="display: none;">Example</main>',
    "<p STYLE=color:red>Example</p>",
    '<textarea style="x"></textarea>',
    '<svg style="fill:red"><path d="M0 0"/></svg>',
  ]) {
    assert.equal(findViolations(page(html), SITE).length, 1, html);
  }
});

test("style 属性の説明文・類似属性・コメント・template 内は誤検知しない (#217)", () => {
  for (const html of [
    '<main data-style="x" class="style">Example</main>',
    '<a href="/?x=style=1" title="style=color:red">Example</a>',
    "<p>style=&quot;color:red&quot; の説明</p>",
    '<!-- <b style="x"> -->',
    '<template><b style="x"></b></template>',
  ]) {
    assert.deepEqual(findViolations(page(html), SITE), [], html);
  }
});

test("外部 CSS・data 属性・テキスト・コメント・template 内は誤検知しない (#211)", () => {
  for (const html of [
    '<link rel="stylesheet" href="/styles.css"><main data-onclick="x" class="onclick">Example</main>',
    "<p>onclick=&quot;alert(1)&quot; と &lt;style&gt; の説明</p>",
    '<!-- <style>a{}</style> <b onclick="x()"> -->',
    '<template><style>a{}</style><b onclick="x()"></b></template>',
    '<a href="/?x=onclick=1" title="onclick=alert(1)">Example</a>',
  ]) {
    assert.deepEqual(findViolations(page(html), SITE), [], html);
  }
});

test("通常要素の属性値内の script 文字列は対象外で、終了後の本物は検出する (#167)", () => {
  assert.deepEqual(
    findViolations(
      page(`<div data-example="<script>alert(1)</script>">Example</div>`),
      SITE
    ),
    []
  );
  assert.deepEqual(
    findViolations(
      page(`<div data-example='<script>alert(1)</script>'>Example</div>`),
      SITE
    ),
    []
  );
  assert.equal(
    findViolations(
      page(
        `<div data-example="<script>a()</script>">Example</div><script>b()</script>`
      ),
      SITE
    ).length,
    1
  );
});

test("JavaScript の互換 MIME type のインラインと別オリジン src を拒否する (#147)", () => {
  for (const type of [
    "text/javascript1.5",
    "application/x-javascript",
    "text/jscript",
    "text/livescript",
    "application/x-ecmascript",
    "TEXT/X-JAVASCRIPT",
  ]) {
    assert.equal(
      findViolations(page(`<script type="${type}">a()</script>`), SITE).length,
      1,
      `${type} inline`
    );
    assert.equal(
      findViolations(
        page(
          `<script type="${type}" src="https://example.invalid/a.js"></script>`
        ),
        SITE
      ).length,
      1,
      `${type} src`
    );
  }
});

test("textarea・title・style・script の接頭辞を持つ別要素は通常要素として扱い、後続 script を検出する (#193)", () => {
  for (const name of [
    "textarea-example",
    "title-example",
    "style-example",
    "script-example",
  ]) {
    assert.equal(
      findViolations(page(`<${name}></${name}><script>alert(1)</script>`), SITE)
        .length,
      1,
      name
    );
  }
});

test("互換 MIME type でも同一オリジン src とデータブロックは通る (#147)", () => {
  const html = page(
    '<script type="text/javascript1.5" src="/_astro/a.js"></script><script type="application/json">{}</script>'
  );
  assert.deepEqual(findViolations(html, SITE), []);
});

test("template 内の script は対象外で、終了後の本物は検出する (#207)", () => {
  assert.deepEqual(
    findViolations(
      page("<template><script>alert(1)</script></template>"),
      SITE
    ),
    []
  );
  assert.deepEqual(
    findViolations(
      page(
        '<template><script src="https://example.invalid/a.js"></script></template>'
      ),
      SITE
    ),
    []
  );
  assert.equal(
    findViolations(
      page(
        "<template><script>alert(1)</script></template><script>alert(2)</script>"
      ),
      SITE
    ).length,
    1
  );
});

test("入れ子の template は対応する終了タグまで読み飛ばす (#207)", () => {
  assert.deepEqual(
    findViolations(
      page(
        "<template><template><script>a()</script></template><script>b()</script></template>"
      ),
      SITE
    ),
    []
  );
  assert.equal(
    findViolations(
      page("<template><template></template></template><script>c()</script>"),
      SITE
    ).length,
    1
  );
  assert.equal(
    findViolations(
      page("<template-example></template-example><script>d()</script>"),
      SITE
    ).length,
    1
  );
});
