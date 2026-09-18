import { Button, Input, Icon, Badge, Status } from "../components/ui";
import { m } from "../paraglide/messages";
import { errorText, useI18n } from "../lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { authClient, unwrap } from "../lib/auth-client";
import { call } from "../lib/hub";
import { ConfirmAction } from "../components/confirm-action";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { PROVIDER_LABELS, SOCIAL_PROVIDERS, useConfig } from "../lib/config";
import type { Profile } from "../lib/profile";
import { Shell } from "../components/shell";
import { HandleSetup } from "../components/handle-setup";
import { RequireAccount } from "../components/require-account";

export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({
    meta: [{ title: m.meta_page_title({ page: m.account_title() }) }],
  }),
  component: Account,
});

type User = { id: string; name: string; email: string; image?: string | null };

function Account() {
  return (
    <Shell>
      <div className="page-heading">
        <div>
          <span className="kicker">{m.account_kicker()}</span>
          <h1>{m.account_title()}</h1>
          <p className="page-description">{m.account_lead()}</p>
        </div>
      </div>
      {/* The handle form lives on this page, so do not gate on it here. */}
      <RequireAccount next="/account" requireHandle={false}>
        {({ session, profile }) => (
          <>
            <ProfileCard user={session.user} profile={profile} />
            <HandleCard profile={profile} />
            <DevicesCard key={session.user.id} userId={session.user.id} />
          </>
        )}
      </RequireAccount>
    </Shell>
  );
}

function ProfileCard({ user, profile }: { user: User; profile: Profile }) {
  const client = useQueryClient();
  const config = useConfig();
  const accounts = useQuery({
    queryKey: ["accounts", user.id],
    queryFn: () => api<{ providerId: string }[]>("/auth/list-accounts"),
  });
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const saveName = useAction(
    async () => {
      const name = (displayName ?? user.name).trim();
      if (!name) throw new Error(m.account_name_required());
      unwrap(await authClient.updateUser({ name }));
    },
    {
      onSuccess: async () => {
        setNotice(m.account_profile_updated());
        await client.invalidateQueries({ queryKey: ["profile"] });
      },
    },
  );
  const link = useAction(async (provider: "github" | "google") => {
    unwrap(await authClient.linkSocial({ provider, callbackURL: "/account" }));
  });
  const signOut = useAction(
    async () => {
      unwrap(await authClient.signOut());
    },
    { onSuccess: () => window.location.assign("/login") },
  );
  const busy = saveName.busy || link.busy || signOut.busy;
  const error = saveName.error || link.error || signOut.error;
  const isLinked = (provider: string) =>
    accounts.data?.some((a) => a.providerId === provider) ?? false;
  const visibleProviders = SOCIAL_PROVIDERS.filter(
    (provider) =>
      config.data?.providers.includes(provider) || isLinked(provider),
  );

  return (
    <section className="account-card">
      <div className="profile-summary">
        {user.image ? (
          <img
            className="profile-avatar"
            src={user.image}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="profile-avatar" aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase() || "@"}
          </span>
        )}
        <div>
          <h2>{user.name}</h2>
          <a className="profile-handle" href="#handle">
            {profile.handle ? `@${profile.handle}` : m.handle_title()}
          </a>
        </div>
      </div>
      <p>{user.email}</p>
      <form
        className="profile-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          saveName.run();
        }}
      >
        <label>
          {m.account_display_name()}
          <Input
            value={displayName ?? user.name}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            required
            autoComplete="name"
          />
        </label>
        <Button variant="primary" busy={saveName.busy} disabled={busy}>
          {m.account_save_name()}
        </Button>
      </form>
      <details className="account-id">
        <summary>
          {m.account_id_label()}
          <Icon name="chevron" />
        </summary>
        <code>{user.id}</code>
        <p className="muted">{m.account_id_hint()}</p>
      </details>
      <div className="actions">
        {visibleProviders.map((provider) => (
          <Button
            key={provider}
            disabled={
              busy ||
              !config.data?.providers.includes(provider) ||
              !accounts.data ||
              isLinked(provider)
            }
            onClick={() => link.run(provider)}
          >
            {isLinked(provider) ? m.account_linked() : m.account_link()}{" "}
            {PROVIDER_LABELS[provider]}
          </Button>
        ))}
        <Button
          variant="ghost"
          busy={signOut.busy}
          disabled={busy}
          onClick={() => signOut.run()}
        >
          <Icon name="logout" />
          {m.account_sign_out()}
        </Button>
      </div>
      {visibleProviders.length > 0 && (
        <p className="muted">{m.account_link_hint()}</p>
      )}
      {error && <Status error>{error}</Status>}
      {notice && !error && <Status>{notice}</Status>}
    </section>
  );
}

function HandleCard({ profile }: { profile: Profile }) {
  if (!profile.handle)
    return (
      <div id="handle">
        <HandleSetup />
      </div>
    );
  return (
    <section className="account-card" id="handle">
      <h2>{m.account_public_profile()}</h2>
      <p>
        <strong>@{profile.handle}</strong>
      </p>
      <p className="muted">{m.account_handle_hint()}</p>
    </section>
  );
}

function browserLabel(userAgent = "") {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /(?:Chrome|CriOS)\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : m.account_device_browser();
  const platform = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh|Mac OS/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return platform ? `${browser} · ${platform}` : browser;
}

function DevicesCard({ userId }: { userId: string }) {
  const { locale } = useI18n();
  const devices = useQuery({
    queryKey: ["devices", userId],
    queryFn: () => call("devices", {}),
    refetchInterval: 10_000,
  });
  const [notice, setNotice] = useState("");
  const revoke = useAction((id: string) => call("revoke_device", { id }), {
    onSuccess: async () => {
      setNotice(m.account_session_revoked());
      await devices.refetch();
    },
  });
  return (
    <section className="account-card">
      <div className="card-section-heading">
        <Icon name="monitor" />
        <div>
          <h2>{m.account_devices_title()}</h2>
          <p className="muted">{m.account_devices_hint()}</p>
        </div>
      </div>
      {devices.isPending ? (
        <p>{m.common_loading()}</p>
      ) : devices.error ? (
        <p role="alert">{errorText(devices.error)}</p>
      ) : (
        <ul className="members">
          {devices.data.devices.map((device) => {
            const current = device.current;
            return (
              <li key={device.id}>
                <div>
                  <strong>
                    {device.label.startsWith("Tandry on ")
                      ? device.label.slice(10)
                      : /^(Tandry|tandry\/)/.test(device.label)
                        ? m.account_device_plugin()
                        : browserLabel(device.label)}
                  </strong>
                  <p className="muted">
                    {m.account_signed_in_on({
                      date: new Date(device.createdAt).toLocaleString(locale),
                    })}
                  </p>
                </div>
                {current ? (
                  <Badge tone="success">{m.account_current_session()}</Badge>
                ) : (
                  <ConfirmAction
                    label={m.account_revoke_session()}
                    description={m.account_revoke_confirm()}
                    busy={revoke.busy}
                    onConfirm={() => revoke.run(device.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {revoke.error && <Status error>{revoke.error}</Status>}
      {notice && !revoke.error && <Status>{notice}</Status>}
    </section>
  );
}
