import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

/** Frosted surface used for every card, panel and chip on the marketing pages. */
export const glassVariants = cva("rounded-2xl", {
  variants: {
    tone: { strong: "glass", soft: "glass-soft" },
    padding: { none: "", sm: "p-4", md: "p-6", lg: "p-8" },
  },
  defaultVariants: { tone: "soft", padding: "md" },
});

export function Glass({
  tone,
  padding,
  className,
  ...props
}: ComponentProps<"div"> & VariantProps<typeof glassVariants>) {
  return (
    <div
      className={cn(glassVariants({ tone, padding }), className)}
      {...props}
    />
  );
}
