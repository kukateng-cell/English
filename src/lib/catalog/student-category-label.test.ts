import assert from "node:assert/strict";
import test from "node:test";
import { convertText } from "../i18n/convert";
import { studentCategoryLabel } from "./student-category-label";
import { CATALOG_CATEGORIES } from "./taxonomy";

test("student category labels use the reviewed Traditional Chinese taxonomy names", () => {
  assert.equal(studentCategoryLabel("people-family"), "人物與家庭");
  assert.equal(studentCategoryLabel("food-drink"), "飲食");
  assert.equal(studentCategoryLabel("technology"), "科技");
  assert.equal(studentCategoryLabel("  people-family  "), "人物與家庭");
  assert.equal(studentCategoryLabel("other"), "其他主題");
});

test("student category labels show uncategorized for empty, legacy and unknown values", () => {
  assert.equal(studentCategoryLabel(null), "未分類");
  assert.equal(studentCategoryLabel(undefined), "未分類");
  assert.equal(studentCategoryLabel(""), "未分類");
  assert.equal(studentCategoryLabel("   "), "未分類");
  assert.equal(studentCategoryLabel("未分類"), "未分類");
  assert.equal(studentCategoryLabel("未分类"), "未分類");
  assert.equal(studentCategoryLabel("unexpected-internal-enum"), "未分類");
});

test("every catalog category has a dedicated student label", () => {
  for (const category of CATALOG_CATEGORIES) {
    const label = studentCategoryLabel(category);
    assert.notEqual(label, "未分類");
    assert.match(label, /[\u3400-\u9fff]/u);
  }
});

test("student category labels stay correct after locale conversion", () => {
  assert.equal(
    convertText(studentCategoryLabel("people-family"), "zh-Hant"),
    "人物與家庭",
  );
  assert.equal(
    convertText(studentCategoryLabel("people-family"), "zh-Hans"),
    "人物与家庭",
  );
  assert.equal(
    convertText(studentCategoryLabel("other"), "zh-Hans"),
    "其他主题",
  );
  assert.equal(convertText(studentCategoryLabel(null), "zh-Hans"), "未分类");
});
