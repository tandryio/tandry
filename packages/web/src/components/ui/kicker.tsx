import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

/** Small monospace section label, optionally with a leading glyph or pulse dot. */
export function Kicker({
  icon,
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"p"> & { icon?: ReactNode; dot?: boolean }) {
  return (
    <p
      className={cn(
        "m-0 flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-accent uppercase",
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className="size-1.5 animate-pulse-soft rounded-full bg-accent shadow-[0_0_10px_2px_rgba(143,196,255,0.45)]"
          aria-hidden="true"
        />
      )}
      {icon}
      {children}
    </p>
  );
}

/** Pill variant used for the hero eyebrow. */
export function Eyebrow({
  className,
  ...props
}: ComponentProps<typeof Kicker>) {
  return (
    <Kicker
      dot
      className={cn(
        "inline-flex rounded-full border border-accent/20 bg-accent/5 px-3.5 py-1.5 text-[10px] tracking-[0.2em] backdrop-blur-md",
        className,
      )}
      {...props}
    />
  );
}
