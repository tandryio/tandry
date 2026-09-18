import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Infinite horizontal scroller. Children are rendered twice so the CSS
 * keyframe can loop seamlessly at -50%; hovering pauses the motion.
 */
export function Marquee({
  duration = 42,
  gap = "3.5rem",
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  duration?: number;
  gap?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("mask-fade-x w-full overflow-hidden", className)}
      {...props}
    >
      <div
        className="flex w-max animate-marquee items-center hover:[animation-play-state:paused]"
        style={{ gap, paddingRight: gap, animationDuration: `${duration}s` }}
      >
        {children}
        <span aria-hidden="true" className="contents">
          {children}
        </span>
      </div>
    </div>
  );
}
