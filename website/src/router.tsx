import { createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  // A new cache per SSR request; never share authenticated data across users.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, retry: false } },
  });
  return createRouter({
    routeTree,
    scrollRestoration: true,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        {/* Honour the OS reduced-motion preference for every Motion animation. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    ),
  });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
