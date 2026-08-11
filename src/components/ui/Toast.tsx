import type { ReactNode } from "react";
import Icon from "./Icon";

export type ToastVariant = "info" | "success" | "error";

export default function Toast({
  variant = "info",
  message,
  action,
  onDismiss,
  dismissLabel = "关闭提示",
}: {
  variant?: ToastVariant;
  message: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const icon = variant === "success" ? "check" : variant === "error" ? "warning" : "info";
  return (
    <div className={["ui-toast", `ui-toast-${variant}`].join(" ")} role={variant === "error" ? "alert" : "status"} aria-live="polite">
      <Icon name={icon} size={18} />
      <div className="ui-toast-message">{message}</div>
      {action}
      {onDismiss ? <button type="button" className="ui-toast-dismiss" aria-label={dismissLabel} onClick={onDismiss}><Icon name="close" size={16} /></button> : null}
    </div>
  );
}
