import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  localeToHtmlLang,
  normalizeLocale,
} from "./config";

test("locale normalization keeps the supported Hant/Hans aliases deterministic", () => {
  assert.equal(DEFAULT_LOCALE, "zh-Hant");
  assert.equal(normalizeLocale(null), "zh-Hant");
  assert.equal(normalizeLocale("zh-TW"), "zh-Hant");
  assert.equal(normalizeLocale("zh-Hant-MO"), "zh-Hant");
  assert.equal(normalizeLocale("zh-CN"), "zh-Hans");
  assert.equal(normalizeLocale("zh-Hans-SG"), "zh-Hans");
  assert.equal(normalizeLocale("not-a-locale"), "zh-Hant");
});

test("supported locales are written to html using their canonical BCP-47 tags", () => {
  assert.equal(localeToHtmlLang("zh-Hant"), "zh-Hant");
  assert.equal(localeToHtmlLang("zh-Hans"), "zh-Hans");
});
