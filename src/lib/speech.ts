"use client";

/**
 * 统一的语音朗读工具。
 *
 * 浏览器原生 SpeechSynthesis 在 macOS / Chrome 上常出现「卡顿、首字吞音、
 * 声音突兀」等问题，根因通常是：
 *  1. 语音引擎异步加载，第一次调用时 voice 还没就绪；
 *  2. 默认 voice 可能是低质量的合成声音；
 *  3. 连续调用没有 cancel()，多条 utterance 堆叠导致抢断。
 *
 * 本模块负责：
 *  - 提前加载并缓存可用英文 voice，挑选质量最好的一个；
 *  - 每次 speak 前先 cancel，避免堆叠；
 *  - 暴露一个稳定的 speak() 供所有组件复用。
 */

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReady = false;

/** 在所有可用 voice 里挑出「听起来最自然」的英文声音 */
function pickBestVoice(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter(
    (v) => v.lang && v.lang.toLowerCase().startsWith("en")
  );
  const pool = en.length ? en : voices;

  // 按优先级匹配高质量引擎关键字
  const preferred = [
    /google\s*(us\s*)?english/i, // Chrome 上的 Google 美式英语（最自然）
    /(siri|natural|enhanced)/i, // Apple Siri / Natural / Enhanced 系列
    /samantha/i, // macOS 高质量女声
    /aria|jenny|zira|guy/i, // Windows Natural / 自然声音
    /daniel|karen|moira|tessa/i, // 其他英联邦自然声
    /在线语音|online/i, // 某些中文系统里的「在线」英文声
  ];
  for (const re of preferred) {
    const hit = pool.find((v) => re.test(v.name));
    if (hit) return hit;
  }

  // 其次优先 en-US
  const us = pool.find((v) => v.lang.toLowerCase() === "en-us");
  if (us) return us;

  // 兜底：任一 en-* 声音
  return pool[0];
}

function refreshVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) {
    cachedVoice = pickBestVoice(voices);
    voicesReady = true;
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoice();
  // voices 是异步加载的（尤其 Chrome），监听变化重新挑选
  window.speechSynthesis.onvoiceschanged = refreshVoice;
}

/**
 * 预热语音引擎。建议在用户首次交互（如进入页面、第一次点击）时调用，
 * 可以显著减少首次朗读的延迟与吞音。
 */
export function warmUpSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  refreshVoice();
  // 触发一次静音朗读，强制引擎就绪
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/**
 * 清晰朗读一段英文文本。
 * - 每次先 cancel，避免堆叠卡顿；
 * - 自动选择最自然的英文 voice；
 * - 语速略慢，便于学习。
 */
export function speakEnglish(text: string, opts?: { rate?: number }) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;

  // 先停掉之前的朗读，避免堆叠抢断造成卡顿
  synth.cancel();

  // 确保 voice 列表已加载
  if (!voicesReady) refreshVoice();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  u.rate = opts?.rate ?? getSpeechRate(); // 默认使用用户设置的语速
  u.pitch = 1;
  u.volume = 1;
  if (cachedVoice) u.voice = cachedVoice;
  synth.speak(u);
}

/** 停止朗读 */
export function stopSpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}

/* ───────── 语速设置（持久化 + 全局默认） ───────── */

const SPEECH_RATE_KEY = "english.speechRate";
export const SPEECH_RATE_EVENT = "english:speechRateChange";
const DEFAULT_SPEECH_RATE = 0.85;
const MIN_RATE = 0.5;
const MAX_RATE = 1.5;

/** 语速取值范围（0.5× ~ 1.5×），供 UI 控件使用 */
export const SPEECH_RATE_BOUNDS = { min: MIN_RATE, max: MAX_RATE };

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SPEECH_RATE;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 100) / 100));
}

/** 读取用户设置（持久化于 localStorage）的朗读语速 */
export function getSpeechRate(): number {
  if (typeof window === "undefined") return DEFAULT_SPEECH_RATE;
  try {
    const raw = window.localStorage.getItem(SPEECH_RATE_KEY);
    const v = raw != null ? parseFloat(raw) : NaN;
    return clampRate(v);
  } catch {
    return DEFAULT_SPEECH_RATE;
  }
}

/** 设置并持久化朗读语速，同时派发自定义事件供 React 组件订阅 */
export function setSpeechRate(rate: number): void {
  if (typeof window === "undefined") return;
  const clamped = clampRate(rate);
  try {
    window.localStorage.setItem(SPEECH_RATE_KEY, String(clamped));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent(SPEECH_RATE_EVENT, { detail: clamped }),
  );
}
