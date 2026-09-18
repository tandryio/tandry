import { credentialsPath, readJson, remove, writeJson } from "./local";

/** The device token every host on this machine shares. One file, mode 0600. */
export interface Credentials {
  hub: string;
  token: string;
  account: { id: string; handle: string | null };
}

/** Credentials for another Hub are not credentials for this one. */
export function readCredentials(hub: string): Credentials | null {
  const stored = readJson<Credentials>(credentialsPath());
  return stored && stored.hub === hub && typeof stored.token === "string" ? stored : null;
}

export function writeCredentials(credentials: Credentials): void {
  writeJson(credentialsPath(), credentials, 0o600);
}

export function deleteCredentials(): void {
  remove(credentialsPath());
}
