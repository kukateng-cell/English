import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "small" | "medium" | "large";

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "medium",
  className?: string,
) {
  return [
    "ui-button",
    `ui-button-${variant}`,
    `ui-button-${size}`,
    className,
  ].filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = "primary",
  size = "medium",
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonArrow({ direction = "right" }: { direction?: "left" | "right" }) {
  return <Icon name={direction === "left" ? "arrow-left" : "arrow-right"} size={18} />;
}
