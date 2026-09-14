import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { useEffect, useState } from "react";
import { authClient } from "../lib/auth-client";

export function EmailLogin({
  next,
  busy,
  setBusy,
  onError,
}: {
  next: string;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onError: (value: string) => void;
}) {
  const { errorText } = useI18n();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(
      () => setCooldown((value) => value - 1),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function send() {
    setBusy(true);
    onError("");
    try {
      const address = email.trim().toLowerCase();
      const result = await authClient.emailOtp.sendVerificationOtp({
        email: address,
        type: "sign-in",
      });
      if (result.error)
        throw new Error(
          errorText(result.error.message) || m.could_not_send_the_code(),
        );
      setSentTo(address);
      setOtp("");
      setCooldown(60);
    } catch (error) {
      onError(
        error instanceof Error
          ? errorText(error.message)
          : m.could_not_send_the_code_please_try_again(),
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    onError("");
    try {
      // No display name is sent: a new account's name defaults to its handle.
      const result = await authClient.signIn.emailOtp({ email: sentTo, otp });
      if (result.error) {
        throw new Error(
          errorText(result.error.message) ||
            m.this_code_is_invalid_or_has_expired_please_check(),
        );
      }
      window.location.assign(next);
    } catch (error) {
      onError(
        error instanceof Error
          ? errorText(error.message)
          : m.sign_in_failed_please_try_again(),
      );
      setBusy(false);
    }
  }
  return (
    <form
      className="email-login"
      onSubmit={(event) => {
        event.preventDefault();
        void (sentTo ? verify() : send());
      }}
    >
      <label htmlFor="login-email">{m.sign_in_with_email()}</label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        placeholder="you@example.com"
        value={email}
        disabled={busy || !!sentTo}
        onChange={(event) => setEmail(event.target.value)}
      />
      {sentTo && (
        <>
          <p role="status">{m.email_code_sent({ email: sentTo })}</p>
          <label htmlFor="login-otp">{m.msg_6_digit_code()}</label>
          <input
            id="login-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={otp}
            disabled={busy}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
          />
        </>
      )}
      <button
        className="button yellow"
        type="submit"
        disabled={busy || (!sentTo && cooldown > 0)}
      >
        {busy
          ? m.please_wait()
          : sentTo
            ? m.verify_and_sign_in()
            : cooldown
              ? m.send_again_in_seconds_s({ seconds: cooldown })
              : m.send_code()}
      </button>
      {sentTo && (
        <>
          <button
            className="button"
            type="button"
            disabled={busy || cooldown > 0}
            onClick={() => void send()}
          >
            {cooldown
              ? m.resend_in_seconds_s({ seconds: cooldown })
              : m.resend_code()}
          </button>
          <button
            className="button"
            type="button"
            disabled={busy}
            onClick={() => {
              setSentTo("");
              setOtp("");
              onError("");
            }}
          >
            {m.use_another_email()}
          </button>
        </>
      )}
    </form>
  );
}
