import { createRouter } from "@tanstack/react-router";
import { webRouterOptions } from "@tandryio/web/router";
import { routeTree } from "./routeTree.gen";
export function getRouter() {
  return createRouter({ routeTree, ...webRouterOptions() });
}
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
