export type CatalogPendingSummary = {
  restricted: true;
  kind: string;
  status: string;
};

export function catalogPendingRequestForActor<
  T extends { proposerId: string; kind: string; status: string },
>(
  request: T | null | undefined,
  actorId: string,
  canReview: boolean,
): T | CatalogPendingSummary | null {
  if (!request) return null;
  if (canReview || request.proposerId === actorId) return request;
  return {
    restricted: true,
    kind: request.kind,
    status: request.status,
  };
}
