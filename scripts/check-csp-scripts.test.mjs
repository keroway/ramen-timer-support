#!/usr/bin/env node
// check-csp-scripts.mjs の回帰検査 (#130)。CSP の script-src 'self' に反する
// script を検知でき、許可すべきものは誤検知しないことを確認する。

import assert from "node:assert/strict";
import test from "node:test";
import { findViolations, readSiteOrigin } from "./check-csp-scripts.mjs";

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

test("互換 MIME type でも同一オリジン src とデータブロックは通る (#147)", () => {
  const html = page(
    '<script type="text/javascript1.5" src="/_astro/a.js"></script><script type="application/json">{}</script>'
  );
  assert.deepEqual(findViolations(html, SITE), []);
});
