import type { ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Variants,
} from "motion/react";

/*
 * Scroll-triggered entrances. `Reveal` animates one block when it enters the
 * viewport; `Stagger` + `StaggerItem` cascade a group of children.
 * Users who prefer reduced motion get the content immediately.
 */

export const EASE_OUT_EXPO = [0.22, 1, 0.36, 1] as const;

const VIEWPORT = { once: true, amount: 0.2, margin: "0px 0px -48px 0px" };

export function Reveal({
  delay = 0,
  y = 26,
  duration = 0.85,
  children,
  ...props
}: HTMLMotionProps<"div"> & {
  delay?: number;
  y?: number;
  duration?: number;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={VIEWPORT}
      transition={{ duration, ease: EASE_OUT_EXPO, delay }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

const group: Variants = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: { staggerChildren: stagger, delayChildren: 0.05 },
  }),
};

const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: EASE_OUT_EXPO },
  },
};

export function Stagger({
  stagger = 0.1,
  children,
  ...props
}: HTMLMotionProps<"div"> & { stagger?: number; children?: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={group}
      custom={stagger}
      initial={reduce ? "visible" : "hidden"}
      whileInView="visible"
      viewport={VIEWPORT}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  ...props
}: HTMLMotionProps<"div"> & { children?: ReactNode }) {
  return (
    <motion.div variants={item} {...props}>
      {children}
    </motion.div>
  );
}
