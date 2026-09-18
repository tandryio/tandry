import { createContext, useContext, useId, type ComponentProps } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "motion/react";
import { cn } from "../../lib/cn";

/*
 * Accessible tabs from Radix with a shared, sliding active indicator. The
 * indicator is a `layoutId` element that Motion animates between triggers.
 */

const TabsContext = createContext<{ value: string; group: string } | null>(
  null,
);

export function Tabs({
  value,
  className,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root> & { value: string }) {
  const group = useId();
  return (
    <TabsContext.Provider value={{ value, group }}>
      <TabsPrimitive.Root
        value={value}
        className={cn("flex flex-col", className)}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex gap-1 rounded-xl border border-white/8 bg-white/3 p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { value: string }) {
  const context = useContext(TabsContext);
  const active = context?.value === value;
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "relative flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-xs font-medium text-muted",
        "transition-colors duration-200 outline-none hover:text-ink",
        "focus-visible:ring-2 focus-visible:ring-accent/70",
        "data-[state=active]:text-accent",
        className,
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId={`${context?.group}-tab-indicator`}
          className="absolute inset-0 rounded-lg border border-accent/25 bg-accent/10"
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
          aria-hidden="true"
        />
      )}
      <span className="relative">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("outline-none", className)}
      {...props}
    />
  );
}
