import type { HTMLAttributes, ReactNode } from "react";

function stackClass(base: string, className?: string) {
  return [base, className].filter(Boolean).join(" ");
}

export function StudentPageStack({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={stackClass("student-page-stack", className)} {...props}>
      {children}
    </div>
  );
}

export function StudentSectionStack({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={stackClass("student-section-stack", className)} {...props}>
      {children}
    </div>
  );
}
