import { Button, Icon, Badge, Status } from "../components/ui";
import { m } from "../paraglide/messages";
import { errorText, useI18n } from "../lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type MouseEvent } from "react";
import { authClient, unwrap } from "../lib/auth-client";
import { call } from "../lib/hub";
import { ConfirmAction } from "../components/confirm-action";
import { api, upload } from "../lib/api";
import { useAction } from "../lib/action";
import { PROVIDER_LABELS, SOCIAL_PROVIDERS, useConfig } from "../lib/config";
import type { Profile } from "../lib/profile";
import { Shell } from "../components/shell";
import { RequireAccount } from "../components/require-account";

type User = { id: string; name: string; email: string; image?: string | null };

export function Account() {
  return (
    <Shell>
      <div className="profile-page">
        <h1 className="sr-only">{m.account_title()}</h1>
        {/* The handle is claimed on this page, so do not gate on it here. */}
        <RequireAccount next="/account" requireHandle={false}>
          {({ session, profile }) => (
            <>
              <ProfileCard user={session.user} profile={profile} />
              <DevicesCard key={session.user.id} userId={session.user.id} />
              <SignOut />
            </>
          )}
        </RequireAccount>
      </div>
    </Shell>
  );
}

/**
 * Square-crop and shrink a picture before it leaves the browser. Re-encoding
 * is also what strips whatever else the original file carried: the Hub stores
 * these bytes and serves them back, so it never stores the file as chosen.
 */
async function avatarBlob(file: File, size = 128): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // Browsers that cannot encode WebP fall back to PNG; JPEG is smaller.
  const webp = await encode("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  if (!blob) throw new Error(m.account_avatar_invalid());
  return blob;
}

function ProfileCard({ user, profile }: { user: User; profile: Profile }) {
  const client = useQueryClient();
  const config = useConfig();
  const accounts = useQuery({
    queryKey: ["accounts", user.id],
    queryFn: () => api<{ providerId: string }[]>("/auth/list-accounts"),
  });
  // null while not editing; otherwise the draft being typed.
  const [name, setName] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const saveName = useAction(
    async () => {
      const value = (name ?? "").trim();
      if (!value) throw new Error(m.account_name_required());
      if (value !== user.name)
        unwrap(await authClient.updateUser({ name: value }));
    },
    {
      onSuccess: async () => {
        setName(null);
        await client.invalidateQueries({ queryKey: ["profile"] });
      },
    },
  );
  const claimHandle = useAction(
    () => api("/profile/handle", { handle: handle ?? "" }),
    {
      onSuccess: async () => {
        setHandle(null);
        await client.invalidateQueries({ queryKey: ["profile"] });
      },
    },
  );
  const saveAvatar = useAction(
    async (file: File) => {
      if (!file.type.startsWith("image/"))
        throw new Error(m.account_avatar_invalid());
      const blob = await avatarBlob(file).catch(() => {
        throw new Error(m.account_avatar_invalid());
      });
      await upload<{ image: string }>("/avatars", blob);
      // The Hub wrote the account row itself; re-read the session to see it.
      authClient.$store.notify("$sessionSignal");
    },
    { onSuccess: () => setNotice(m.account_profile_updated()) },
  );
  const link = useAction(async (provider: "github" | "google") => {
    unwrap(await authClient.linkSocial({ provider, callbackURL: "/account" }));
  });
  const busy =
    saveName.busy || claimHandle.busy || saveAvatar.busy || link.busy;
  const error =
    saveName.error || claimHandle.error || saveAvatar.error || link.error;
  const isLinked = (provider: string) =>
    accounts.data?.some((a) => a.providerId === provider) ?? false;
  const visibleProviders = SOCIAL_PROVIDERS.filter(
    (provider) =>
      config.data?.providers.includes(provider) || isLinked(provider),
  );
  // The confirm button keeps focus in the field so blur only means "cancel".
  const keepFocus = (event: MouseEvent) => event.preventDefault();

  return (
    <section className="account-card">
      <div className="profile-summary">
        <button
          type="button"
          className="profile-avatar"
          aria-label={m.account_change_avatar()}
          title={m.account_change_avatar()}
          disabled={saveAvatar.busy}
          onClick={() => fileInput.current?.click()}
        >
          {user.image ? (
            <img src={user.image} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span aria-hidden="true">
              {user.name.slice(0, 1).toUpperCase() || "@"}
            </span>
          )}
          <Icon name="camera" />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setNotice("");
            saveAvatar.run(file);
          }}
        />
        <div className="profile-identity">
          {name === null ? (
            <h2>
              <button
                type="button"
                className="profile-editable"
                aria-label={m.account_display_name()}
                onClick={() => {
                  setNotice("");
                  saveName.reset();
                  setName(user.name);
                }}
              >
                {user.name}
                <Icon name="edit" />
              </button>
            </h2>
          ) : (
            <form
              className="profile-inline-form profile-name-field"
              onSubmit={(event) => {
                event.preventDefault();
                saveName.run();
              }}
            >
              <input
                className="profile-inline-input"
                aria-label={m.account_display_name()}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (!saveName.busy) setName(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setName(null);
                }}
                maxLength={80}
                required
                autoFocus
                autoComplete="name"
                disabled={saveName.busy}
              />
              <button
                className="profile-inline-confirm"
                aria-label={m.account_save_name()}
                title={m.account_save_name()}
                disabled={saveName.busy}
                onMouseDown={keepFocus}
              >
                <Icon name="check" />
              </button>
            </form>
          )}
          <div className="profile-meta">
            {profile.handle ? (
              <span className="profile-handle">@{profile.handle}</span>
            ) : handle === null ? (
              <button
                type="button"
                className="profile-editable profile-handle"
                onClick={() => {
                  claimHandle.reset();
                  setHandle("");
                }}
              >
                {m.handle_title()}
                <Icon name="edit" />
              </button>
            ) : (
              <form
                className="profile-inline-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  claimHandle.run();
                }}
              >
                <input
                  className="profile-inline-input"
                  aria-label={m.handle_label()}
                  title={m.handle_rules()}
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  onBlur={() => {
                    if (!claimHandle.busy) setHandle(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setHandle(null);
                  }}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  minLength={3}
                  maxLength={24}
                  pattern="@?[A-Za-z][A-Za-z0-9_]{2,23}"
                  placeholder={m.handle_placeholder()}
                  required
                  autoFocus
                  disabled={claimHandle.busy}
                />
                <button
                  className="profile-inline-confirm"
                  aria-label={m.handle_save()}
                  title={m.handle_save()}
                  disabled={claimHandle.busy}
                  onMouseDown={keepFocus}
                >
                  <Icon name="check" />
                </button>
              </form>
            )}
            <span>{user.email}</span>
          </div>
        </div>
      </div>
      {visibleProviders.length > 0 && (
        <div className="profile-providers">
          <div className="actions">
            {visibleProviders.map((provider) => (
              <Button
                key={provider}
                size="sm"
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
          </div>
          <p className="muted">{m.account_link_hint()}</p>
        </div>
      )}
      {error && <Status error>{error}</Status>}
      {notice && !error && <Status>{notice}</Status>}
    </section>
  );
}

function SignOut() {
  const signOut = useAction(
    async () => {
      unwrap(await authClient.signOut());
    },
    { onSuccess: () => window.location.assign("/login") },
  );
  return (
    <div className="profile-sign-out">
      <Button
        variant="ghost"
        size="sm"
        className="text-rose-300/85 hover:bg-rose-300/10 hover:text-rose-200"
        busy={signOut.busy}
        onClick={() => signOut.run()}
      >
        <Icon name="logout" />
        {m.account_sign_out()}
      </Button>
      {signOut.error && <Status error>{signOut.error}</Status>}
    </div>
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
