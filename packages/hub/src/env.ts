import type { AuthConfig } from "./auth/auth";
import type { PolicyConfig } from "./policy/policy";

export interface Env extends AuthConfig, PolicyConfig {
  AUTH_DB: D1Database;
  ROOM: DurableObjectNamespace;
  /** Account pictures. Without it the Hub runs, but avatars cannot be uploaded. */
  AVATARS?: R2Bucket;
  /** Public prefix pictures are served under. Unset: this Worker's own path. */
  AVATAR_BASE_URL?: string;
  /** How long after its last call a pull member still counts as online. */
  PULL_ONLINE_MINUTES?: string;
}
