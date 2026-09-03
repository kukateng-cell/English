import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import * as OpenCC from "opencc-js";
import ts from "typescript";

const ROOTS = ["src/app", "src/components", "src/lib", "src/proxy.ts"];

// 這些簡體字串只用來接收舊 CSV／身份輸入或收斂舊 i18n 錯字，永不直接顯示。
const INPUT_COMPATIBILITY_EXCEPTIONS: Record<string, ReadonlySet<string>> = {
  "src/app/api/admin/roster/import/preview/route.ts": new Set([
    "账号", "学生证", "学生证号码", "真实姓名", "昵称", "年级", "班别", "班级",
    "联络电邮", "班级权限", "可重设密码",
  ]),
  "src/lib/i18n/convert.ts": new Set([
    "乾擾項", "幹擾項", "幹扰項", "幹扰项", "干扰项", "登录", "载入", "加载", "帐号", "账号",
    "帐户", "账户", "联络", "联系", "连线", "连接", "伺服器", "服务器",
  ]),
  "src/lib/nickname.ts": new Set(["管理员", "老师", "系统", "草泥马"]),
  "src/lib/roster-file.ts": new Set(["账号", "学生证"]),
  "src/lib/units.ts": new Set(["未分类"]),
};

const NON_CANONICAL_VISIBLE_TERMS = [
  "當前", "上傳", "列表", "模板", "網絡連接", "連接失敗", "字符", "下劃線",
  "設置", "示例", "已禁用", "聯系", "存儲", "續期響應", "憑證響應",
  "組件", "菜單", "內存限流",
] as const;

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (entry: string) => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) walk(path.join(entry, name));
      return;
    }
    const normalizedEntry = entry.split(path.sep).join("/");
    if (!/\.(?:ts|tsx|mts)$/u.test(normalizedEntry)) return;
    if (normalizedEntry.includes("/generated/") || /\.(?:test|spec)\./u.test(normalizedEntry)) return;
    files.push(normalizedEntry);
  };
  for (const root of ROOTS) walk(root);
  return files;
}

function auditTraditional(text: string, converter: (text: string) => string): string {
  return converter(text)
    .replaceAll("乾擾項", "干擾項")
    .replaceAll("幹擾項", "干擾項")
    .replaceAll("幹扰項", "干擾項")
    // 這三個是經審定的現代繁體／電腦用語，不採 OpenCC 的異體偏好。
    .replaceAll("纔", "才")
    .replaceAll("遊標", "游標")
    .replaceAll("剛纔", "剛才");
}

test("production Chinese source literals use the Traditional canonical baseline", () => {
  const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });
  const failures: string[] = [];

  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, "utf8");
    const syntax = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, syntax);

    const visit = (node: ts.Node) => {
      const isTextNode = ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node)
        || ts.isJsxText(node);
      if (isTextNode) {
        const value = node.getText(sourceFile);
        if (/[\u3400-\u9fff]/u.test(value)) {
          const exception = INPUT_COMPATIBILITY_EXCEPTIONS[file]?.has(
            ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : value,
          );
          if (!exception && auditTraditional(value, toTraditional) !== value) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            failures.push(`${file}:${line} ${value}`);
          }
          if (!exception && NON_CANONICAL_VISIBLE_TERMS.some((term) => value.includes(term))) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            failures.push(`${file}:${line} 非 canonical 用詞 ${value}`);
          }
        }
      }

      if (
        ts.isConditionalExpression(node)
        && /locale|zh-Han/u.test(node.condition.getText(sourceFile))
        && ts.isStringLiteralLike(node.whenTrue)
        && ts.isStringLiteralLike(node.whenFalse)
        && /[\u3400-\u9fff]/u.test(`${node.whenTrue.text}${node.whenFalse.text}`)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        failures.push(`${file}:${line} 手寫繁簡雙份文案`);
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.deepEqual(failures, []);
});

test("Traditional runtime path does not initialise a Simplified-to-Traditional converter", () => {
  const source = fs.readFileSync("src/lib/i18n/convert.ts", "utf8");
  assert.doesNotMatch(source, /from:\s*["']cn["']/u);
});
