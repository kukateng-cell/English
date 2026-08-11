import type { ReactNode } from "react";
import Card from "./Card";
import Icon from "./Icon";
import Button from "./Button";

export function Skeleton({ className = "", label }: { className?: string; label?: string }) {
  return <span className={["ui-skeleton", className].filter(Boolean).join(" ")} aria-hidden={label ? undefined : true} role={label ? "status" : undefined}>{label}</span>;
}

export function EmptyState({
  title,
  description,
  action,
  icon = "spark",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: "spark" | "book" | "check" | "lock" | "info" | "warning";
}) {
  return (
    <Card className="ui-empty-state" padded>
      <span className="ui-empty-icon"><Icon name={icon} size={26} /></span>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ui-empty-action">{action}</div> : null}
    </Card>
  );
}

export function RetryState({ message, onRetry, retryLabel = "重試" }: { message: ReactNode; onRetry: () => void; retryLabel?: string }) {
  return <EmptyState title={message} icon="warning" action={<Button variant="secondary" size="small" onClick={onRetry}><Icon name="refresh" size={16} />{retryLabel}</Button>} />;
}
