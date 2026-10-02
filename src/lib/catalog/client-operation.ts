export type PendingClientOperation = {
  fingerprint: string;
  operationId: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function clientOperationFingerprint(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function pendingClientOperation(
  current: PendingClientOperation | null,
  fingerprint: string,
  createId: () => string,
): PendingClientOperation {
  return current?.fingerprint === fingerprint
    ? current
    : { fingerprint, operationId: createId() };
}
