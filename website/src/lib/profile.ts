import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Profile = { userId: string; name: string; handle: string | null };

export function useProfile(userId?: string) {
  return useQuery({
    queryKey: ["profile", userId],
    enabled: !!userId,
    queryFn: () => api<Profile>("/profile"),
  });
}
