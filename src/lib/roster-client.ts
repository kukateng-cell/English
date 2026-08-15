import { getCsrfToken } from "next-auth/react";

export async function rosterFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return fetch(input, init);
  const token = await getCsrfToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("x-csrf-token", token);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
