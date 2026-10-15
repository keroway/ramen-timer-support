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
