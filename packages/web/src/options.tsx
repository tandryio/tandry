import { createContext, useContext, type ReactNode } from "react";
import type { IconName } from "./components/ui/icon";

export type NavigationItem = {
  href: string;
  label: () => string;
  icon?: IconName;
};
export type WebOptions = {
  mainNavigation?: NavigationItem[];
  workspaceNavigation?: NavigationItem[];
  loginPaths?: string[];
};
const Options = createContext<WebOptions>({});
export function WebProvider({
  value,
  children,
}: {
  value: WebOptions;
  children: ReactNode;
}) {
  return <Options.Provider value={value}>{children}</Options.Provider>;
}
export const useWebOptions = () => useContext(Options);

/** Only explicitly registered same-origin pages are valid login destinations. */
export function safeNext(
  raw: string | null,
  extraPaths: string[] = [],
): string {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\")
  )
    return "/rooms";
  const pathname = raw.split("?")[0];
  return ["/rooms", "/account", "/device", "/connect", ...extraPaths].includes(
    pathname!,
  )
    ? raw
    : "/rooms";
}
