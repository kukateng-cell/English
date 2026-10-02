import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  padded?: boolean;
  as?: "article" | "aside" | "div" | "section";
}

export default function Card({
  children,
  padded = false,
  as = "section",
  className,
  ...props
}: CardProps) {
  const Component = as;
  return (
    <Component {...props} className={["ui-card", padded && "ui-card-padding", className].filter(Boolean).join(" ")}>
      {children}
    </Component>
  );
}

export function StatCard({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={["ui-stat-card", className].filter(Boolean).join(" ")}>
      <span className="ui-stat-label">{label}</span>
      <strong className="ui-stat-value">{value}</strong>
      {note ? <span className="ui-stat-note">{note}</span> : null}
    </Card>
  );
}
