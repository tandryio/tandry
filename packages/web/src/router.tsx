import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { WebProvider, type WebOptions } from "./options";

export function webRouterOptions(options: WebOptions = {}) {
  // A new cache per SSR request; never share authenticated data across users.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, retry: false } },
  });
  return {
    scrollRestoration: true,
    // Load a page's code while the pointer is still on its link.
    defaultPreload: "intent" as const,
    Wrap: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {/* Honour the OS reduced-motion preference for every Motion animation. */}
        <MotionConfig reducedMotion="user">
          <WebProvider value={options}>{children}</WebProvider>
        </MotionConfig>
      </QueryClientProvider>
    ),
  };
}
