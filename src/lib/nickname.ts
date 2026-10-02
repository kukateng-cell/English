const MIN_NICKNAME_GRAPHEMES = 2;
const MAX_NICKNAME_GRAPHEMES = 24;

const RESERVED_NAMES = [
  "admin",
  "administrator",
  "teacher",
  "system",
  "root",
  "管理員",
  "管理员",
  "老師",
  "老师",
  "系統",
  "系统",
];

// Deliberately small, deterministic first-line list. It is kept local so
// minors' identity text is not sent to a third-party moderation service.
const BLOCKED_TERMS = [
  "仆街",
  "冚家",
  "屌",
  "𨳒",
  "撚",
  "柒",
  "戇鳩",
  "傻閪",
  "操你",
  "草泥馬",
  "草泥马",
  "fuck",
  "shit",
  "bitch",
  "nigger",
];

const graphemeSegmenter = new Intl.Segmenter("zh", {
  granularity: "grapheme",
});

function compactForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-Hans")
    .replace(/[\s._'’·-]+/gu, "");
}

export type NicknameValidation =
  | { ok: true; value: string; normalized: string }
  | { ok: false; error: string };

export function validateNickname(input: string): NicknameValidation {
  const value = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, error: "暱稱不能為空" };
  if (/[\p{Cc}\p{Cf}]/u.test(value)) {
    return { ok: false, error: "暱稱包含不可見或控制字元" };
  }

  const length = [...graphemeSegmenter.segment(value)].length;
  if (
    length < MIN_NICKNAME_GRAPHEMES ||
    length > MAX_NICKNAME_GRAPHEMES
  ) {
    return {
      ok: false,
      error:
        "暱稱必須為 " +
        MIN_NICKNAME_GRAPHEMES +
        "–" +
        MAX_NICKNAME_GRAPHEMES +
        " 個字元",
    };
  }

  if (!/^[\p{L}\p{M}\p{N} .'’·_-]+$/u.test(value)) {
    return {
      ok: false,
      error: "暱稱只可包含文字、數字、空格及有限分隔符",
    };
  }

  if (
    /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,})/iu.test(value) ||
    /(?:\+?\d[\d -]{6,}\d)/u.test(value)
  ) {
    return { ok: false, error: "暱稱不可包含網址、Email 或電話號碼" };
  }

  const normalized = compactForComparison(value);
  if (
    RESERVED_NAMES.some((term) => normalized === compactForComparison(term))
  ) {
    return { ok: false, error: "這個暱稱屬於系統保留名稱" };
  }
  if (
    BLOCKED_TERMS.some((term) =>
      normalized.includes(compactForComparison(term)),
    )
  ) {
    return { ok: false, error: "暱稱包含不適合作為名稱的內容" };
  }

  return { ok: true, value, normalized };
}

export function validateNicknameAgainstIdentity(
  input: string,
  identity: {
    legalName?: string | null;
    accountName?: string | null;
    contactEmail?: string | null;
  },
): NicknameValidation {
  const result = validateNickname(input);
  if (!result.ok) return result;
  const nicknameKey = result.normalized;
  const legalKey = identity.legalName
    ? compactForComparison(identity.legalName)
    : "";
  const accountKey = identity.accountName
    ? compactForComparison(identity.accountName)
    : "";
  const emailKey = identity.contactEmail
    ? compactForComparison(identity.contactEmail)
    : "";
  const emailLocalKey = identity.contactEmail
    ? compactForComparison(identity.contactEmail.split("@", 1)[0])
    : "";
  if (
    (legalKey && nicknameKey === legalKey) ||
    (accountKey && nicknameKey === accountKey) ||
    (emailKey && nicknameKey === emailKey) ||
    (emailLocalKey && nicknameKey === emailLocalKey)
  ) {
    return { ok: false, error: "暱稱不可使用真實姓名、帳號或聯絡資料" };
  }
  return result;
}

export const NICKNAME_LIMITS = {
  min: MIN_NICKNAME_GRAPHEMES,
  max: MAX_NICKNAME_GRAPHEMES,
} as const;
