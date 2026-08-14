import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "bar-chart"
  | "bolt"
  | "book"
  | "books"
  | "calendar-check"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "flame"
  | "globe"
  | "home"
  | "info"
  | "lock"
  | "logout"
  | "medal"
  | "menu"
  | "moon"
  | "refresh"
  | "seedling"
  | "spark"
  | "sun"
  | "star"
  | "trophy"
  | "volume"
  | "warning";

const paths: Record<IconName, ReactNode> = {
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "bar-chart": <><path d="M4 19V5M4 19h16" /><path d="M7 15v-3M11 15V8M15 15v-6M19 15v-9" /></>,
  bolt: <path d="m13 2-9 12h6l-1 8 9-12h-6z" />,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 18a3 3 0 0 1 3-3h11M9 8h6M9 11h4" /></>,
  books: <><path d="M5 5a2 2 0 0 1 2-2h3v15H7a2 2 0 0 0-2 2z" /><path d="M10 3h3a2 2 0 0 1 2 2v13h-5" /><path d="M5 20h10a2 2 0 0 1 2 2H7a2 2 0 0 1-2-2Z" /></>,
  "calendar-check": <><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M8 2.5v4M16 2.5v4M3.5 9h17M8 14l2.5 2.5 5-5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  flame: <path d="M12 22c4.42 0 8-3.58 8-8 0-3.31-1.6-5.98-4.5-8.5.1 2.3-1 3.8-2.2 4.7.2-3.1-1.3-6.5-4.5-8.7.4 3.4-.7 5.8-2.5 7.8C4.9 11 4 13.2 4 15c0 3.87 3.58 7 8 7Z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9S14.4 18.5 12 21c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5M9 21v-6h6v6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  medal: <><circle cx="12" cy="9" r="5" /><path d="m9 13-1 8 4-2 4 2-1-8M10 9l1.3 1 1.4-2 1.3 1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2z" />,
  refresh: <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 5v6h-6" /></>,
  seedling: <><path d="M12 21V11" /><path d="M12 13c-4 0-7-2.3-7-6 4.5-.2 7 1.8 7 6ZM12 10c0-4 2.5-6 7-6 0 3.7-3 6-7 6Z" /></>,
  spark: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></>,
  sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
  trophy: <><path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" /><path d="M8 6H5v1a4 4 0 0 0 4 4M16 6h3v1a4 4 0 0 1-4 4M12 12v5M8 20h8M9 17h6" /></>,
  volume: <><path d="M4 10v4h4l5 4V6l-5 4z" /><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7.5 7.5 0 0 1 0 10" /></>,
  warning: <><path d="M12 4 2.7 20h18.6L12 4Z" /><path d="M12 9v5M12 17h.01" /></>,
};

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export default function Icon({ name, size = 20, className, ...props }: IconProps) {
  return (
    <svg
      {...props}
      className={["ui-icon", className].filter(Boolean).join(" ")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={props["aria-label"] ? undefined : true}
    >
      {paths[name]}
    </svg>
  );
}
