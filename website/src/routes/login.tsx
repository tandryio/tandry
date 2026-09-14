import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";
import { api } from "../lib/api";
import { Shell } from "../components/shell";
import { EmailLogin } from "../components/email-login";

export const Route = createFileRoute("/login")({
  ssr: false,
  component: Login,
});
// Sign-in and registration are the same action: the provider proves identity,
// and a first-time account picks its @handle on the next page.
function Login() {
  const { errorText } = useI18n();
  const { data: session, isPending } = authClient.useSession();
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    if (!isPending) setSessionChecked(true);
  }, [isPending]);
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api<{ providers: string[] }>("/config"),
  });
  const params = new URLSearchParams(window.location.search);
  const [error, setError] = useState(() =>
    params.get("error") ? m.sign_in_failed_please_try_again() : "",
  );
  const [busy, setBusy] = useState(false);
  const raw = params.get("next");
  const next =
    raw && /^\/(rooms|account|device)(\?|$)/.test(raw) ? raw : "/rooms";
  async function signIn(provider: "github" | "google") {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: next,
        errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
      });
      if (result.error) throw new Error(errorText(result.error.message));
    } catch (e) {
      setError(
        e instanceof Error
          ? errorText(e.message)
          : m.sign_in_failed_please_try_again(),
      );
      setBusy(false);
    }
  }
  return (
    <Shell>
      <section className="account-card narrow">
        <span className="kicker">YOUR TEAM STARTS HERE</span>
        <h1>{m.sign_in_start_collaborating()}</h1>
        <p>{m.sign_in_for_free_with_email_or_an_existing()}</p>
        {/* Keep the OTP form mounted during focus-triggered session refreshes. */}
        {isPending && !sessionChecked ? (
          <p role="status">{m.checking_your_session()}</p>
        ) : session ? (
          <>
            <p>
              {m.signed_in_as()}
              {session.user.name || session.user.email}
            </p>
            <a className="button yellow" href={next}>
              {m.continue()}
            </a>
          </>
        ) : (
          <div className="login-options">
            {config.data?.providers.includes("email") && (
              <EmailLogin
                next={next}
                busy={busy}
                setBusy={setBusy}
                onError={setError}
              />
            )}
            {(["github", "google"] as const).map((provider) => (
              <button
                className="button"
                key={provider}
                disabled={busy || !config.data?.providers.includes(provider)}
                onClick={() => signIn(provider)}
              >
                {m.sign_in_with_provider({
                  provider: provider === "github" ? "GitHub" : "Google",
                })}
              </button>
            ))}
            {config.isPending && (
              <p role="status">{m.loading_sign_in_methods()}</p>
            )}
            {config.error && (
              <p role="alert">
                {m.could_not_reach_the_sign_in_service_please_try()}
              </p>
            )}
            {config.data && !config.data.providers.length && (
              <p role="status">
                {m.sign_in_is_being_configured_please_check_back_soon()}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="muted">
          {m.new_accounts_pick_a_handle_after_signing_in()}
        </p>
        <p className="muted">
          {m.we_only_request_basic_account_information_not_access_to()}
        </p>
      </section>
    </Shell>
  );
}
