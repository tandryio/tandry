import { useEffect, useState, type PointerEvent, type ReactNode } from "react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { cn } from "../../lib/cn";

/**
 * Perspective tilt that follows the pointer and springs back on leave.
 * Only active for fine pointers; touch devices and reduced-motion users see
 * a static card.
 */
export function TiltCard({
  max = 7,
  className,
  children,
}: {
  max?: number;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    setEnabled(!reduce && window.matchMedia("(hover: hover)").matches);
  }, [reduce]);

  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 140, damping: 18, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [max, -max]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-max, max]), spring);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
  };
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <div className={cn("[perspective:1400px]", className)}>
      <motion.div
        onPointerMove={move}
        onPointerLeave={reset}
        style={
          enabled
            ? { rotateX, rotateY, transformStyle: "preserve-3d" }
            : undefined
        }
      >
        {children}
      </motion.div>
    </div>
  );
}
