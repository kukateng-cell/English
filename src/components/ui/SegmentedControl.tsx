import type { ReactNode } from "react";

export interface SegmentItem<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export default function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={["ui-segmented", className].filter(Boolean).join(" ")} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={item.value === value ? "is-active" : undefined}
          aria-pressed={item.value === value}
          disabled={item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
