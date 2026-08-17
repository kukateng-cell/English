/** Shared client/server limits for the learning-analytics comparison contract. */
// A school may have more than six classes in one grade.  Keep the comparison
// contract generous enough for a full-grade view while retaining a bounded
// request/response size for the scrollable comparison table.
export const MAX_ANALYTICS_CLASS_SELECTION = 200;

// Student exports may carry up to 500 opaque IDs.  Keep the query parser's
// 16 KiB cap, but give the export DTO enough room for its documented maximum
// (including IDs at the 128-byte validation limit).
export const MAX_ANALYTICS_EXPORT_BODY_BYTES = 96 * 1024;
