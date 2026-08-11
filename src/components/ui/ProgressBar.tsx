import type { HTMLAttributes } from "react";

export default function ProgressBar({
  value,
  max = 100,
  label,
  showValue = false,
  decorative = false,
  className,
  ...props
}: {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  decorative?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "role">) {
  const safeMax = max > 0 ? max : 100;
  const safeValue = Math.min(safeMax, Math.max(0, value));
  const percentage = Math.round((safeValue / safeMax) * 100);
  return (
    <div className={["ui-progress-wrap", className].filter(Boolean).join(" ")} {...props}>
      {label || showValue ? (
        <div className="ui-progress-label">
          {label ? <span>{label}</span> : <span />}
          {showValue ? <span>{percentage}%</span> : null}
        </div>
      ) : null}
      <div
        className="ui-progress-track"
        role={decorative ? undefined : "progressbar"}
        aria-label={decorative ? undefined : label}
        aria-valuemin={decorative ? undefined : 0}
        aria-valuemax={decorative ? undefined : safeMax}
        aria-valuenow={decorative ? undefined : safeValue}
      >
        <span className="ui-progress-value" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
