import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useProfile } from "../lib/profile";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { api } from "../lib/api";
import { Shell } from "../components/shell";
import { HandleSetup } from "../components/handle-setup";
export const Route = createFileRoute("/account")({
  ssr: false,
  component: Account,
});
type Session = {
  token: string;
  userAgent?: string;
  createdAt: string;
  expiresAt: string;
};
function Account() {
  const { locale, errorText } = useI18n();
  const { data: session, isPending } = authClient.useSession();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const profile = useProfile(session?.user.id);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ["devices", session?.user.id],
    enabled: !!session,
    queryFn: () => api<Session[]>("/auth/list-sessions"),
  });
  const accounts = useQuery({
    queryKey: ["accounts", session?.user.id],
    enabled: !!session,
    queryFn: () => api<{ providerId: string }[]>("/auth/list-accounts"),
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<{ providers: string[] }>("/config"),
  });
  async function revoke(token: string) {
    setBusy(true);
    try {
      await api("/auth/revoke-session", { token });
      await devices.refetch();
      setMessage(
        m.session_revoked_connections_will_close_at_their_next_identity(),
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? errorText(e.message)
          : m.something_went_wrong_please_try_again(),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell>
      <h1>{m.profile_devices()}</h1>
      {isPending ? (
        <p>{m.loading()}</p>
      ) : !session ? (
        <a className="button yellow" href="/login?next=/account">
          {m.sign_in()}
        </a>
      ) : (
        <>
          <section className="account-card">
            <div className="profile-summary">
              {session.user.image ? (
                <img
                  className="profile-avatar"
                  src={session.user.image}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="profile-avatar" aria-hidden="true">
                  {session.user.name.slice(0, 1).toUpperCase() || "@"}
                </span>
              )}
              <div>
                <h2>{session.user.name}</h2>
                <a className="profile-handle" href="#handle">
                  {profile.data?.handle
                    ? `@${profile.data.handle}`
                    : m.set_your_handle()}
                </a>
              </div>
            </div>
            <p>{session.user.email}</p>
            <form
              className="profile-name-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setBusy(true);
                setMessage("");
                try {
                  const name = (displayName ?? session.user.name).trim();
                  if (!name) throw new Error(m.name_cannot_be_empty());
                  const result = await authClient.updateUser({ name });
                  if (result.error)
                    throw new Error(errorText(result.error.message));
                  await profile.refetch();
                  setMessage(m.your_profile_is_updated());
                } catch (error) {
                  setMessage(
                    errorText(
                      error instanceof Error ? error.message : undefined,
                    ),
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                {m.display_name()}
                <input
                  value={displayName ?? session.user.name}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={80}
                  required
                  autoComplete="name"
                />
              </label>
              <button disabled={busy}>{m.save_name()}</button>
            </form>
            <details className="account-id">
              <summary>{m.account_id()}</summary>
              <code>{session.user.id}</code>
              <p className="muted">
                {m.your_permanent_account_identity_login_methods_and_handles_do()}
              </p>
            </details>
            <div className="actions">
              {(["github", "google"] as const).map((provider) => (
                <button
                  key={provider}
                  disabled={
                    busy ||
                    !config.data?.providers.includes(provider) ||
                    accounts.isPending ||
                    accounts.isError ||
                    accounts.data?.some((a) => a.providerId === provider)
                  }
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await authClient.linkSocial({
                        provider,
                        callbackURL: "/account",
                      });
                      if (r.error) throw new Error(errorText(r.error.message));
                    } catch (e) {
                      setMessage(
                        e instanceof Error
                          ? errorText(e.message)
                          : m.could_not_link_this_account(),
                      );
                      setBusy(false);
                    }
                  }}
                >
                  {accounts.data?.some((a) => a.providerId === provider)
                    ? m.linked()
                    : m.link()}{" "}
                  {provider === "github" ? "GitHub" : "Google"}
                </button>
              ))}
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const r = await authClient.signOut();
                  if (r.error) {
                    setMessage(
                      errorText(r.error.message) ?? m.could_not_sign_out(),
                    );
                    setBusy(false);
                  } else window.location.assign("/login");
                }}
              >
                {m.sign_out()}
              </button>
            </div>
            <p className="muted">
              {m.sign_in_to_your_existing_account_before_linking_another()}
            </p>
          </section>
          {profile.isPending ? (
            <section className="account-card" id="handle">
              <p>{m.loading()}</p>
            </section>
          ) : profile.error ? (
            <section className="account-card" id="handle">
              <p role="alert">{errorText(profile.error)}</p>
            </section>
          ) : profile.data?.handle ? (
            <section className="account-card" id="handle">
              <h2>{m.your_public_profile()}</h2>
              <p>
                <strong>@{profile.data.handle}</strong>
              </p>
              <p className="muted">
                {m.teammates_can_identify_and_address_you_by_this_handle()}
              </p>
            </section>
          ) : (
            <div id="handle">
              <HandleSetup />
            </div>
          )}
          <section className="account-card">
            <h2>{m.signed_in_devices_browsers()}</h2>
            {devices.isPending ? (
              <p>{m.loading()}</p>
            ) : devices.error ? (
              <p role="alert">{errorText(devices.error.message)}</p>
            ) : (
              <ul className="members">
                {devices.data?.map((device) => (
                  <li key={device.token}>
                    <div>
                      <strong>
                        {device.userAgent?.startsWith("agent-room/")
                          ? m.agent_room_plugin()
                          : device.userAgent || m.unknown_device()}
                      </strong>
                      <p className="muted">
                        {m.signed_in_on()}
                        {new Date(device.createdAt).toLocaleString(locale)}
                      </p>
                    </div>
                    <button
                      disabled={busy || device.token === session.session.token}
                      onClick={() => revoke(device.token)}
                    >
                      {device.token === session.session.token
                        ? m.current_session()
                        : m.revoke_session()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
