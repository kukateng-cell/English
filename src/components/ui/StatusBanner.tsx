import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import Button from "./Button";

export type StatusBannerVariant = "info" | "success" | "warning" | "error";

export default function StatusBanner({
  variant = "info",
  message,
  action,
  actionLabel,
  onAction,
  live = true,
  className,
}: {
  variant?: StatusBannerVariant;
  message: ReactNode;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  live?: boolean;
  className?: string;
}) {
  const icon: Record<StatusBannerVariant, IconName> = {
    info: "info",
    success: "check",
    warning: "warning",
    error: "warning",
  };
  return (
    <div
      className={["ui-status-banner", `ui-status-${variant}`, className].filter(Boolean).join(" ")}
      role={variant === "error" ? "alert" : live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      <Icon name={icon[variant]} size={20} />
      <div className="ui-status-copy">{message}</div>
      {action ?? (actionLabel && onAction ? <Button variant="quiet" size="small" onClick={onAction}>{actionLabel}</Button> : null)}
    </div>
  );
}
