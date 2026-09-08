import { getCsrfToken } from "next-auth/react";

export class RosterRequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT" as const;

  constructor() {
    super("REQUEST_TIMEOUT");
    this.name = "RosterRequestTimeoutError";
  }
}

export async function readResponseJsonWithTimeout(
  response: Response,
  timeoutMs = 15_000,
): Promise<unknown> {
  const reader = response.body?.getReader();
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = globalThis.setTimeout(() => reject(new RosterRequestTimeoutError()), timeoutMs);
  });
  try {
    if (!reader) {
      return await Promise.race([response.json(), timeout]);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    const readBody = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        total += value.byteLength;
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    })();
    return await Promise.race([readBody, timeout]);
  } catch (error) {
    if (error instanceof RosterRequestTimeoutError && reader) {
      await reader.cancel("response deadline exceeded").catch(() => {});
    }
    throw error;
  } finally {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    reader?.releaseLock();
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let timedOut = false;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abortFromCaller();
    else externalSignal.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RosterRequestTimeoutError();
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function csrfTokenWithTimeout(timeoutMs: number): Promise<string | null> {
  const response = await fetchWithTimeout("/api/auth/csrf", {
    credentials: "same-origin",
    cache: "no-store",
  }, timeoutMs);
  const data = await readResponseJsonWithTimeout(response, timeoutMs);
  return typeof data === "object" && data !== null && "csrfToken" in data && typeof data.csrfToken === "string"
    ? data.csrfToken
    : null;
}

export async function rosterFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {},
) {
  const method = (init.method ?? "GET").toUpperCase();
  const timeoutMs = options.timeoutMs;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return timeoutMs === undefined ? fetch(input, init) : fetchWithTimeout(input, init, timeoutMs);
  }
  const token = timeoutMs === undefined ? await getCsrfToken() : await csrfTokenWithTimeout(timeoutMs);
  const headers = new Headers(init.headers);
  if (token) headers.set("x-csrf-token", token);
  const request = { ...init, headers, credentials: "same-origin" } as RequestInit;
  return timeoutMs === undefined ? fetch(input, request) : fetchWithTimeout(input, request, timeoutMs);
}
