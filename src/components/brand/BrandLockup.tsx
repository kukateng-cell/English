"use client";

import Link from "next/link";

// The product name is a registered visual mark, not translatable UI copy.
// Keep the mark and accessible name identical in both supported locales.
const SEEWORD_BRAND_NAME = "見字會";
const SEEWORD_BRAND_LABEL = "見字會 SeeWord";

export default function BrandLockup({
  href = "/",
  compact = false,
  className,
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link href={href} className={["brand-lockup", compact && "is-compact", className].filter(Boolean).join(" ")} aria-label={SEEWORD_BRAND_LABEL}>
      <span className="brand-mark" aria-hidden="true">見</span>
      <span className="brand-lockup-copy">
        <span className="brand-name">{SEEWORD_BRAND_NAME}</span>
        <span className="brand-subtitle">SeeWord</span>
      </span>
    </Link>
  );
}
