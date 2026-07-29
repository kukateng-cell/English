// 快速验证 opencc-js 的 Converter API（用完即删）。
const OpenCC = require("opencc-js");

try {
  const conv = OpenCC.Converter({ from: "cn", to: "tw" });
  console.log("cn->tw 测试：");
  console.log("  认读 =>", conv("认读"));
  console.log("  英语单词认读 =>", conv("英语单词认读"));
  console.log("  学习记录 =>", conv("学习记录"));
  console.log("  计算机 =>", conv("计算机"));
  console.log("  系统 =>", conv("系统"));
  console.log("  全部 =>", conv("全部"));
  console.log("OK");
} catch (e) {
  console.error("Converter API 失败：", e.message);
}
