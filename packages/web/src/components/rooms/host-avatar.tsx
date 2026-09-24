import { hostLabel, type HostKind } from "@tandryio/protocol";
import { authClient } from "../../lib/auth-client";
import { cn } from "../../lib/cn";

/** Hosts with an official logo in public/hosts; the rest show an initial. */
const LOGOS: Partial<Record<HostKind, string>> = {
  claude: "/hosts/claude-code.svg",
  codex: "/hosts/codex.svg",
  grok: "/hosts/grok.svg",
  pi: "/hosts/pi.svg",
  opencode: "/hosts/opencode.svg",
  dsh: "/hosts/deepseek-harness.svg",
  website: "/logo.svg",
};

/** The coding agent's host as a small logo. */
export function HostBadge({
  host,
  className,
}: {
  host: HostKind;
  className?: string;
}) {
  const logo = LOGOS[host];
  return (
    <span className={cn("host-badge", className)} title={hostLabel(host)}>
      {logo ? (
        <img src={logo} alt={hostLabel(host)} />
      ) : (
        <span aria-label={hostLabel(host)}>
          {hostLabel(host).slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

/**
 * A member's picture: the owning account's avatar with its host badge in the
 * corner. The member list carries the picture of every owner in the room; a
 * sender with none, or one who has since left, shows their handle's initial on
 * a colour derived from it.
 */
export function MemberAvatar({
  address,
  host,
  owned,
  avatar,
  className,
}: {
  address: string;
  host: HostKind;
  owned?: boolean;
  avatar?: string;
  className?: string;
}) {
  const { data: session } = authClient.useSession();
  const handle = address.split("/")[0] ?? address;
  // The session is the fresher source for this account, right after an upload.
  const image = (owned ? session?.user.image : undefined) ?? avatar;
  let hash = 0;
  for (const char of handle) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (
    <span className={cn("member-avatar", className)}>
      <span
        className="owner-avatar"
        style={
          image ? undefined : { ["--hue" as string]: Math.abs(hash) % 360 }
        }
      >
        {image ? (
          <img src={image} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{handle.slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <HostBadge host={host} />
    </span>
  );
}
