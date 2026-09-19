import { createAuthClient } from "better-auth/react";
import {
  deviceAuthorizationClient,
  emailOTPClient,
} from "better-auth/client/plugins";
import { ApiError } from "./api";

export const authClient = createAuthClient({
  plugins: [deviceAuthorizationClient(), emailOTPClient()],
});

type AuthResult<T> = {
  data: T;
  error: { message?: string; code?: string; status: number } | null;
};

/** Turn a Better Auth `{ data, error }` result into a value or a thrown ApiError. */
export function unwrap<T>(result: AuthResult<T>): T {
  if (result.error)
    throw new ApiError(
      result.error.message ?? "",
      result.error.status,
      result.error.code,
    );
  return result.data;
}
