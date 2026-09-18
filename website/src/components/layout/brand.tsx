import { cn } from "../../lib/cn";

/** Two interlocking paths represent independent conversations working together. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      className={cn("brand-mark block size-10 shrink-0", className)}
      src="/logo.svg"
      width="40"
      height="40"
      alt=""
      aria-hidden="true"
    />
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark className="size-9" />
      <span className="brand-wordmark text-[26px] leading-none font-semibold tracking-[-0.04em] text-ink">
        tandry
      </span>
    </span>
  );
}
