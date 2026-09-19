import type { PointerEvent, ReactNode } from "react";
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  type HTMLMotionProps,
} from "motion/react";
import { cn } from "../../lib/cn";

/**
 * Card whose border and surface glow follow the pointer. The highlight is a
 * radial gradient positioned by two motion values, so no re-render happens
 * while the pointer moves.
 */
export function SpotlightCard({
  className,
  children,
  ...props
}: HTMLMotionProps<"div"> & { children?: ReactNode }) {
  const x = useMotionValue(-400);
  const y = useMotionValue(-400);
  const surface = useMotionTemplate`radial-gradient(360px circle at ${x}px ${y}px, rgba(143,196,255,0.14), transparent 65%)`;
  const edge = useMotionTemplate`radial-gradient(240px circle at ${x}px ${y}px, rgba(143,196,255,0.7), transparent 70%)`;

  const track = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    x.set(event.clientX - rect.left);
    y.set(event.clientY - rect.top);
  };

  return (
    <motion.div
      onPointerMove={track}
      className={cn(
        "group/spot glass-soft relative overflow-hidden rounded-2xl transition-[transform,border-color] duration-300 hover:-translate-y-1 hover:border-white/20",
        className,
      )}
      {...props}
    >
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100"
        style={{ background: surface }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover/spot:opacity-100 [mask:linear-gradient(#000,#000)_content-box,linear-gradient(#000,#000)] [mask-composite:exclude] p-px"
        style={{ background: edge }}
      />
      <div className="relative">{children}</div>
    </motion.div>
  );
}
