import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Kicker } from "../ui/kicker";
import { Reveal } from "../motion/reveal";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-5 md:px-8", className)}
      {...props}
    />
  );
}

export function Section({
  className,
  children,
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn("relative scroll-mt-24 py-20 md:py-28", className)}
      {...props}
    >
      <Container>{children}</Container>
    </section>
  );
}

/** Kicker, display title and an optional lead paragraph aligned to the right. */
export function SectionHeading({
  kicker,
  icon,
  title,
  lead,
  align = "split",
  className,
}: {
  kicker: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  align?: "split" | "center" | "start";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "mb-12 flex flex-wrap gap-6 md:mb-14",
        align === "split" && "items-end justify-between",
        align === "center" && "flex-col items-center text-center",
        align === "start" && "flex-col",
        className,
      )}
    >
      <div className={cn(align === "center" && "flex flex-col items-center")}>
        <Kicker icon={icon} className="mb-4">
          {kicker}
        </Kicker>
        <h2 className="m-0 max-w-2xl font-display text-[2.5rem] leading-[1.04] font-normal tracking-[-0.01em] text-ink md:text-[3.4rem]">
          {title}
        </h2>
      </div>
      {lead && (
        <p className="m-0 max-w-sm text-[15px] leading-relaxed text-muted">
          {lead}
        </p>
      )}
    </Reveal>
  );
}
