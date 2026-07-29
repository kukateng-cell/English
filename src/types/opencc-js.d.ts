/**
 * opencc-js 没有官方 TypeScript 类型声明（package.json 无 types/main 指向 UMD）。
 * 这里为它在项目里补一份最小化的 ambient module 声明，仅覆盖本项目用到的 API：
 *   - Converter({ from, to })  返回 (input: string) => string 的纯函数转换器
 *
 * 参考实测（见 scripts/test-opencc.cjs）：
 *   const conv = OpenCC.Converter({ from: 'cn', to: 'tw' });
 *   conv('认读') === '認讀'
 */
declare module "opencc-js" {
  export type ConverterOptions = {
    /** 来源变体：'cn'（简体，中国大陆）/ 'tw' / 'hk' / 't' / 'jp' 等。 */
    from: "cn" | "tw" | "hk" | "t" | "jp" | string;
    /** 目标变体。 */
    to: "cn" | "tw" | "hk" | "t" | "jp" | string;
    /** 可选：是否做空格/标点的全半角处理。 */
    flag?: number | string;
  };
  /** 建立 Converter；返回把字符串从 from 转到 to 的纯函数。 */
  export function Converter(opts: ConverterOptions): (input: string) => string;
}
