import type { AuthConfig } from "./auth/auth";
import type { PolicyConfig } from "./policy/policy";

export interface Env extends AuthConfig, PolicyConfig {
  AUTH_DB: D1Database;
  ROOM: DurableObjectNamespace;
  /** How long after its last call a pull member still counts as online. */
  PULL_ONLINE_MINUTES?: string;
}
