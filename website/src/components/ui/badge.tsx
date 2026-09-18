import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning";
  className?: string;
}) {
  return (
    <span className={cn("ui-badge", `ui-badge-${tone}`, className)}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}
