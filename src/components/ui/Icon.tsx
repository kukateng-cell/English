import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "bar-chart"
  | "book"
  | "clipboard"
  | "clock"
  | "check"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "globe"
  | "home"
  | "info"
  | "lock"
  | "logout"
  | "menu"
  | "moon"
  | "edit"
  | "plus"
  | "refresh"
  | "search"
  | "shield"
  | "spark"
  | "sun"
  | "trash"
  | "trending-up"
  | "user"
  | "users"
  | "volume"
  | "warning";

const paths: Record<IconName, ReactNode> = {
  "arrow-left": <path d="M19 12H5M11 6l-6 6 6 6" />,
  "arrow-right": <path d="M5 12h14M13 6l6 6-6 6" />,
  "bar-chart": <><path d="M4 19V5M4 19h16" /><path d="M7 15v-3M11 15V8M15 15v-6M19 15v-9" /></>,
  book: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 18a3 3 0 0 1 3-3h11M9 8h6M9 11h4" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.5 5.5 3.5 9S14.4 18.5 12 21c-2.4-2.5-3.5-5.5-3.5-9S9.6 5.5 12 3Z" /></>,
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5M9 21v-6h6v6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2z" />,
  edit: <><path d="M12 20H4a2 2 0 0 1-2-2v-8" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L10 16l-4 1 1-4 9.5-9.5Z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: <><path d="M20 11a8 8 0 1 0 1 4" /><path d="M20 5v6h-6" /></>,
  search: <><circle cx="11" cy="11" r="7.5" /><path d="m16.5 16.5 4.5 4.5" /></>,
  shield: <><path d="M12 3 20 6v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
  spark: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" /><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z" /></>,
  sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  trash: <><path d="M3 6h18M9 6V4h6v2M19 6l-1 15H6L5 6" /><path d="M10 11v6M14 11v6" /></>,
  "trending-up": <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  user: <><circle cx="12" cy="7.5" r="3.5" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  users: <><path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" /><circle cx="9" cy="7" r="3.5" /><path d="M17 11a3.5 3.5 0 1 0-1.5-6.65M22 20v-1.5a4 4 0 0 0-3-3.87" /></>,
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
