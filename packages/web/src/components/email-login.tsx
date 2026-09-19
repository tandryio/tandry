import { Button, Input, Status } from "./ui";
import { m } from "../paraglide/messages";
import { useEffect, useState } from "react";
import { authClient, unwrap } from "../lib/auth-client";
import { useAction } from "../lib/action";

const RESEND_COOLDOWN_SECONDS = 60;

export function EmailLogin({
  next,
  disabled,
  onBusy,
}: {
  next: string;
  /** Another sign-in method is in flight. */
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}) {
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

  const send = useAction(
    async () => {
      const address = email.trim().toLowerCase();
      unwrap(
        await authClient.emailOtp.sendVerificationOtp({
          email: address,
          type: "sign-in",
        }),
      );
      return address;
    },
    {
      onSuccess: (address) => {
        setSentTo(address);
        setOtp("");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      },
    },
  );
  const verify = useAction(
    async () => {
      // No display name is sent: a new account's name defaults to its handle.
      unwrap(await authClient.signIn.emailOtp({ email: sentTo, otp }));
    },
    { onSuccess: () => window.location.assign(next) },
  );
  const busy = send.busy || verify.busy;
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const error = verify.error || send.error;

  return (
    <form
      className="email-login"
      onSubmit={(event) => {
        event.preventDefault();
        if (sentTo) verify.run();
        else send.run();
      }}
    >
      <label htmlFor="login-email">{m.login_email_label()}</label>
      <Input
        id="login-email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        placeholder="you@example.com"
        value={email}
        disabled={busy || disabled || !!sentTo}
        onChange={(event) => setEmail(event.target.value)}
      />
      {sentTo && (
        <>
          <p role="status">{m.login_email_code_sent({ email: sentTo })}</p>
          <label htmlFor="login-otp">{m.login_otp_label()}</label>
          <Input
            id="login-otp"
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={otp}
            disabled={busy || disabled}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
          />
        </>
      )}
      <Button
        variant="primary"
        busy={busy}
        type="submit"
        disabled={busy || disabled || (!sentTo && cooldown > 0)}
      >
        {busy
          ? m.common_please_wait()
          : sentTo
            ? m.login_email_verify()
            : cooldown
              ? m.login_email_send_wait({ seconds: cooldown })
              : m.login_email_send()}
      </Button>
      {sentTo && (
        <>
          <Button
            variant="secondary"
            type="button"
            disabled={busy || disabled || cooldown > 0}
            onClick={() => send.run()}
          >
            {cooldown
              ? m.login_email_resend_wait({ seconds: cooldown })
              : m.login_email_resend()}
          </Button>
          <Button
            variant="secondary"
            type="button"
            disabled={busy || disabled}
            onClick={() => {
              setSentTo("");
              setOtp("");
              send.reset();
              verify.reset();
            }}
          >
            {m.login_email_change()}
          </Button>
        </>
      )}
      {error && <Status error>{error}</Status>}
    </form>
  );
}
