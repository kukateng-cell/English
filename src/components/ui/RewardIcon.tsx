import type { ReactNode, SVGProps } from "react";
import type { RewardIconName } from "@/lib/reward-icons";

const glyphs: Record<RewardIconName, ReactNode> = {
  bolt: (
    <>
      <path d="M13.4 2.75 5.1 13.1h5.65l-.9 8.15 9.05-11.3h-5.65l.15-7.2Z" />
      <path d="m11.1 12.95 2.15-2.65" opacity="0.45" />
    </>
  ),
  book: (
    <>
      <path d="M3.5 5.6A2.6 2.6 0 0 1 6.1 3H9a3 3 0 0 1 3 3v14a3.2 3.2 0 0 0-3-3.2H3.5V5.6Z" />
      <path d="M20.5 5.6A2.6 2.6 0 0 0 17.9 3H15a3 3 0 0 0-3 3v14a3.2 3.2 0 0 1 3-3.2h5.5V5.6Z" />
      <path d="M7 7h2M15 7h2" opacity="0.45" />
    </>
  ),
  "calendar-check": (
    <>
      <rect x="3.25" y="4.5" width="17.5" height="16.25" rx="2.5" />
      <path d="M7.5 2.75v3.5M16.5 2.75v3.5M3.25 9h17.5" />
      <path d="m8.1 14.6 2.35 2.35 5.55-5.5" />
    </>
  ),
  flame: (
    <>
      <path d="M13.15 2.65c.45 3.15-1.05 4.8-2.55 6.4-1.25 1.35-2.45 2.7-2.45 4.75 0 2.25 1.7 4.05 3.85 4.05s3.85-1.8 3.85-4.05c0-1.15-.35-2.2-1.1-3.25-.35 1.2-1.15 2.1-2.15 2.7.15-2.75-.75-5.55-3.05-8.25C7.45 7.2 6.3 8.7 5.4 10.25 4.45 11.9 4 13.75 4 15.6a8 8 0 0 0 16 0c0-4.6-2.55-8.15-6.85-12.95Z" />
      <path d="M12 17.85c-1.05 0-1.9-.85-1.9-1.9 0-.85.45-1.55 1.05-2.2.55-.6 1-1.2 1.05-2.1 1.05 1.15 1.7 2.45 1.7 3.8 0 1.35-.85 2.4-1.9 2.4Z" opacity="0.45" />
    </>
  ),
  medal: (
    <>
      <path d="m7 3 3.15 5.35M17 3l-3.15 5.35M7 3h3.5L12 5.45 13.5 3H17" />
      <circle cx="12" cy="15.5" r="5.5" />
      <path d="m12 12.75.85 1.7 1.9.28-1.38 1.34.33 1.88-1.7-.9-1.7.9.33-1.88-1.38-1.34 1.9-.28.85-1.7Z" opacity="0.45" />
    </>
  ),
  seedling: (
    <>
      <path d="M12 21V11.25M7.75 21h8.5" />
      <path d="M11.75 12.9C7.95 12.9 5.3 10.55 5 6.65c3.9-.2 6.55 1.9 6.75 6.25Z" />
      <path d="M12.25 10.65c.25-4.25 2.95-6.35 6.75-6.15-.3 3.85-2.95 6.15-6.75 6.15Z" />
    </>
  ),
  star: (
    <>
      <path d="m12 2.8 2.8 5.65 6.25.9-4.52 4.4 1.07 6.22L12 17.05l-5.6 2.92 1.07-6.22-4.52-4.4 6.25-.9L12 2.8Z" />
      <path d="m12 7.6.95 1.95 2.15.3-1.55 1.5.35 2.15-1.9-1-1.9 1 .35-2.15-1.55-1.5 2.15-.3L12 7.6Z" opacity="0.45" />
    </>
  ),
  trophy: (
    <>
      <path d="M7.25 3.5h9.5v4.75a4.75 4.75 0 0 1-9.5 0V3.5Z" />
      <path d="M7.25 5.4H4.7a1.95 1.95 0 0 0-1.95 1.95v.4A4.25 4.25 0 0 0 7 12M16.75 5.4h2.55a1.95 1.95 0 0 1 1.95 1.95v.4A4.25 4.25 0 0 1 17 12" />
      <path d="M12 13v3.35M9.3 16.35h5.4l.7 4.15H8.6l.7-4.15ZM7.5 20.5h9" />
      <path d="M9.5 6.2h5" opacity="0.45" />
    </>
  ),
  "word-stack": (
    <>
      <rect x="5" y="5.25" width="14" height="15.75" rx="2.25" />
      <path d="M7.5 5.25V4.4A2.4 2.4 0 0 1 9.9 2h8.35A2.75 2.75 0 0 1 21 4.75v12.1a2.4 2.4 0 0 1-2 2.35" />
      <path d="M8.75 10h6.5M8.75 14h4.75M8.75 17.5h6.5" />
    </>
  ),
};

export interface RewardIconProps extends SVGProps<SVGSVGElement> {
  name: RewardIconName;
  size?: number;
}

export default function RewardIcon({ name, size = 20, className, ...props }: RewardIconProps) {
  return (
    <svg
      {...props}
      className={["reward-icon-svg", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
    >
      {glyphs[name]}
    </svg>
  );
}

export function RankMedal({ rank, size = 30, className }: { rank: 1 | 2 | 3; size?: number; className?: string }) {
  return (
    <svg
      className={["reward-rank-medal", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M9 3.5h5.25L16 7l1.75-3.5H23l-4.2 8.1h-5.6L9 3.5Z" fill="currentColor" opacity="0.16" />
      <path d="m9 3.5 4.2 8.1M23 3.5l-4.2 8.1M14.25 3.5 16 7l1.75-3.5" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="20" r="9" fill="currentColor" opacity="0.12" />
      <circle cx="16" cy="20" r="8" stroke="currentColor" strokeWidth="1.65" />
      <circle cx="16" cy="20" r="5.5" stroke="currentColor" strokeWidth="1" opacity="0.36" />
      <text
        x="16"
        y="20.5"
        fill="currentColor"
        fontFamily="system-ui, sans-serif"
        fontSize="8.5"
        fontWeight="800"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {rank}
      </text>
    </svg>
  );
}
