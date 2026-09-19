import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Provider = "email" | "github" | "google";

/** Sign-in methods the Hub has configured. */
export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () =>
      api<{
        providers: Provider[];
      }>("/config"),
  });
}

export const SOCIAL_PROVIDERS = ["github", "google"] as const;
export const PROVIDER_LABELS: Record<
  (typeof SOCIAL_PROVIDERS)[number],
  string
> = { github: "GitHub", google: "Google" };
