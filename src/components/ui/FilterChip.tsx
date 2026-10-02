import type { ButtonHTMLAttributes, ReactNode } from "react";

export default function FilterChip({
  selected,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; children: ReactNode }) {
  return <button {...props} type={props.type ?? "button"} className={["ui-chip", selected && "is-selected", props.className].filter(Boolean).join(" ")} aria-pressed={selected}>
    {children}
  </button>;
}
