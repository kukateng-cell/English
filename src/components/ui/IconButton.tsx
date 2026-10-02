import type { ButtonHTMLAttributes } from "react";
import Icon, { type IconName } from "./Icon";

export default function IconButton({
  icon,
  label,
  size = 20,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: number }) {
  return (
    <button {...props} type={props.type ?? "button"} className={["ui-icon-button", className].filter(Boolean).join(" ")} aria-label={label}>
      <Icon name={icon} size={size} />
    </button>
  );
}
