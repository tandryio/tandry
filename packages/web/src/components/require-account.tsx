import type { ReactNode } from "react";
import { m } from "../paraglide/messages";
import { Button } from "./ui";
import { authClient } from "../lib/auth-client";
import { errorText } from "../lib/i18n";
import { useProfile, type Profile } from "../lib/profile";
import { HandleSetup } from "./handle-setup";

type Session = NonNullable<ReturnType<typeof authClient.useSession>["data"]>;

type Props = {
  /** Where to return after signing in. */
  next: string;
  /** Copy shown above the sign-in button when signed out. */
  signInPrompt?: string;
  signInLabel?: string;
  /** Show the @handle claim form until the account has one (default: true). */
  requireHandle?: boolean;
  loadingFallback?: ReactNode;
  children: (account: { session: Session; profile: Profile }) => ReactNode;
};

/**
 * Gate page content on a signed-in account with a loaded profile.
 * Renders the loading, signed-out, profile error and handle-claim states so
 * pages only describe what a complete account sees.
 */
export function RequireAccount({
  next,
  signInPrompt,
  signInLabel,
  requireHandle = true,
  loadingFallback,
  children,
}: Props) {
  const { data: session, isPending } = authClient.useSession();
  const profile = useProfile(session?.user.id);
  if (isPending)
    return (
      loadingFallback ?? <p role="status">{m.common_checking_session()}</p>
    );
  if (!session)
    return (
      <section className="account-card">
        {signInPrompt && <p>{signInPrompt}</p>}
        <Button asChild variant="primary">
          <a href={`/login?next=${encodeURIComponent(next)}`}>
            {signInLabel ?? m.common_sign_in()}
          </a>
        </Button>
      </section>
    );
  if (profile.isPending)
    return loadingFallback ?? <p role="status">{m.common_loading()}</p>;
  if (profile.error) return <p role="alert">{errorText(profile.error)}</p>;
  if (requireHandle && !profile.data.handle) return <HandleSetup />;
  return <>{children({ session, profile: profile.data })}</>;
}
