import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Infinite horizontal scroller. Children are rendered twice so the CSS
 * keyframe can loop seamlessly at -50%; hovering pauses the motion. Children may
 * be a function of `copy`: the second rendering is hidden from assistive
 * technology, and its links should stay clickable but leave the tab order.
 */
export function Marquee({
  duration = 42,
  gap = "3.5rem",
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  duration?: number;
  gap?: string;
  children: ReactNode | ((copy: boolean) => ReactNode);
}) {
  const render = (copy: boolean) =>
    typeof children === "function" ? children(copy) : children;
  return (
    <div
      className={cn("mask-fade-x w-full overflow-hidden", className)}
      {...props}
    >
      <div
        className="flex w-max animate-marquee items-center hover:[animation-play-state:paused]"
        style={{ gap, paddingRight: gap, animationDuration: `${duration}s` }}
      >
        {render(false)}
        <span aria-hidden="true" className="contents">
          {render(true)}
        </span>
      </div>
    </div>
  );
}
