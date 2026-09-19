import { safeNext, useWebOptions } from "../options";
import { Button, Icon, Status } from "../components/ui";
import { m } from "../paraglide/messages";
import { useEffect, useState } from "react";
import { authClient, unwrap } from "../lib/auth-client";
import { useAction } from "../lib/action";
import { PROVIDER_LABELS, SOCIAL_PROVIDERS, useConfig } from "../lib/config";
import { SiteHeader } from "../components/layout/site-header";
import { BrandMark } from "../components/layout/brand";
import { AsciiField } from "../components/motion/ascii-field";
import { Reveal } from "../components/motion/reveal";
import { EmailLogin } from "../components/email-login";

// Sign-in and registration are the same action: the provider proves identity,
// and a first-time account picks its @handle on the next page.
export function Login() {
  const { data: session, isPending } = authClient.useSession();
  // Keep the OTP form mounted during focus-triggered session refreshes.
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    if (!isPending) setSessionChecked(true);
  }, [isPending]);
  const config = useConfig();
  const params = new URLSearchParams(window.location.search);
  const next = safeNext(params.get("next"), useWebOptions().loginPaths);
  const callbackError = params.get("error") ? m.login_failed() : "";

  const [emailBusy, setEmailBusy] = useState(false);
  const social = useAction(async (provider: "github" | "google") => {
    unwrap(
      await authClient.signIn.social({
        provider,
        callbackURL: next,
        errorCallbackURL: `/login?next=${encodeURIComponent(next)}`,
      }),
    );
  });
  const busy = social.busy || emailBusy;
  const error = social.error || callbackError;
  const providers = config.data?.providers ?? [];

  return (
    <div className="editorial-site kernal-site auth-page">
      <SiteHeader />
      <main id="main" className="auth-main">
        <AsciiField />
        <Reveal className="auth-card" y={18}>
          <BrandMark className="auth-mark" />
          <span className="hero-eyebrow">
            <span />
            {m.login_kicker()}
          </span>
          <h1>{m.login_title()}</h1>
          <p>{m.login_lead()}</p>
          {isPending && !sessionChecked ? (
            <p role="status">{m.common_checking_session()}</p>
          ) : session ? (
            <>
              <p>
                {m.login_signed_in_as({
                  name: session.user.name || session.user.email,
                })}
              </p>
              <Button asChild variant="primary">
                <a href={next}>{m.common_continue()}</a>
              </Button>
            </>
          ) : (
            <div className="login-options">
              {providers.includes("email") && (
                <EmailLogin
                  next={next}
                  disabled={social.busy}
                  onBusy={setEmailBusy}
                />
              )}
              {SOCIAL_PROVIDERS.filter((provider) =>
                providers.includes(provider),
              ).map((provider) => (
                <Button
                  variant="secondary"
                  className="provider-button"
                  key={provider}
                  disabled={busy || !providers.includes(provider)}
                  onClick={() => social.run(provider)}
                >
                  <span className="provider-symbol" aria-hidden="true">
                    {provider === "github" ? <Icon name="code" /> : "G"}
                  </span>
                  {m.login_with_provider({
                    provider: PROVIDER_LABELS[provider],
                  })}
                  <Icon name="arrow" />
                </Button>
              ))}
              {config.isPending && (
                <p role="status">{m.login_loading_methods()}</p>
              )}
              {config.error && <p role="alert">{m.login_config_error()}</p>}
              {config.data && !providers.length && (
                <p role="status">{m.login_no_providers()}</p>
              )}
            </div>
          )}
          {error && <Status error>{error}</Status>}
          <footer className="auth-notes">
            <p>{m.login_handle_note()}</p>
            <p>{m.login_scope_note()}</p>
          </footer>
        </Reveal>
      </main>
    </div>
  );
}
