import type { AuthConfig } from "./auth/auth";
import type { PolicyConfig } from "./policy/policy";

export interface Env extends AuthConfig, PolicyConfig {
  AUTH_DB: D1Database;
  ROOM: DurableObjectNamespace;
  /** Objects public by capability, one scope per kind. Without it, no uploads. */
  PUBLIC_BUCKET?: R2Bucket;
  /** Where that bucket is published. Unset: this Worker serves it instead. */
  PUBLIC_BASE_URL?: string;
  /** How long after its last call a pull member still counts as online. */
  PULL_ONLINE_MINUTES?: string;
}
