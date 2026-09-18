import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export const buttonVariants = cva(
  [
    "ui-button group/button inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap",
    "rounded-xl border font-medium leading-none",
    "transition-[background-color,border-color,box-shadow,color,transform] duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
    "disabled:pointer-events-none disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        primary: [
          "border-transparent bg-linear-to-r from-[#c4e1ff] to-[#7fb6ff] text-[#0b1a30]",
          "shadow-[0_12px_36px_-12px_rgba(143,196,255,0.7),inset_0_1px_0_rgba(255,255,255,0.5)]",
          "hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-12px_rgba(143,196,255,0.85)]",
        ],
        secondary: [
          "border-white/12 bg-white/5 text-ink backdrop-blur-md",
          "hover:border-white/20 hover:bg-white/10",
        ],
        ghost:
          "border-transparent bg-transparent text-muted hover:bg-white/6 hover:text-ink",
        danger:
          "border-rose-300/20 bg-rose-300/5 text-rose-200 hover:border-rose-300/35 hover:bg-rose-300/10",
      },
      size: {
        sm: "min-h-8 px-3 text-xs",
        md: "min-h-10 px-4 text-[13px]",
        lg: "min-h-12 rounded-full px-6 text-sm",
        icon: "size-9 rounded-lg",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the styles onto the child element (for example an anchor). */
    asChild?: boolean;
    /** Show a spinner and block interaction while an action runs. */
    busy?: boolean;
  };

export function Button({
  variant,
  size,
  asChild = false,
  busy = false,
  className,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {children}
        </>
      )}
    </Component>
  );
}
