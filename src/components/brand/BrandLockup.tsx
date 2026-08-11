"use client";

import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

export default function BrandLockup({
  href = "/",
  compact = false,
  className,
}: {
  href?: string;
  compact?: boolean;
  className?: string;
}) {
  const { tc } = useLocale();
  return (
    <Link href={href} className={["brand-lockup", compact && "is-compact", className].filter(Boolean).join(" ")} aria-label={tc("见字会 SeeWord")}>
      <span className="brand-mark" aria-hidden="true">见</span>
      <span className="brand-lockup-copy">
        <span className="brand-name">{tc("见字会")}</span>
        <span className="brand-subtitle">SeeWord</span>
      </span>
    </Link>
  );
}
