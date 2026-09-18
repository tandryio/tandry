import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon } from "./icon";

export function Status({
  children,
  error = false,
  className,
}: {
  children: ReactNode;
  error?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("ui-status", error && "ui-status-error", className)}
      role={error ? "alert" : "status"}
    >
      <Icon name={error ? "info" : "check"} />
      <div>{children}</div>
    </div>
  );
}
