import { Button, Input, Icon, Status } from "../components/ui";
import { m } from "../paraglide/messages";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { RequireAccount } from "../components/require-account";
import { SiteHeader } from "../components/layout/site-header";
import { AsciiField } from "../components/motion/ascii-field";
import { Reveal } from "../components/motion/reveal";

/** Codes are shown in upper case by every plugin; typing is forgiving. */
const normalize = (value: string) => value.replace(/\s+/g, "").toUpperCase();

type Verification = { status: "pending" | "approved" | "denied" };
type Outcome = "approved" | "denied";

// The device flow: the plugin shows a code and this page, usually with the code
// in the URL. Verifying claims the code for the signed-in account; approving or
// denying settles it. The code is shown once, as the thing being confirmed.
export function Device() {
  const [initial] = useState(
    () => new URLSearchParams(window.location.search).get("user_code") ?? "",
  );
  const [code, setCode] = useState(() => normalize(initial));
  const next = `/device?user_code=${encodeURIComponent(code)}`;
  return (
    <div className="editorial-site kernal-site auth-page">
      <SiteHeader />
      <main id="main" className="auth-main">
        <AsciiField />
        <Reveal className="auth-card device-card" y={18}>
          <h1>{m.device_title()}</h1>
          <RequireAccount
            next={next}
            signInPrompt={m.device_sign_in_prompt()}
            signInLabel={m.device_sign_in_button()}
          >
            {({ session, profile }) => (
              <DeviceApproval
                name={profile.handle ? `@${profile.handle}` : session.user.name}
                code={code}
                setCode={setCode}
                fromLink={!!initial}
              />
            )}
          </RequireAccount>
        </Reveal>
      </main>
    </div>
  );
}

function DeviceApproval({
  name,
  code,
  setCode,
  fromLink,
}: {
  name: string;
  code: string;
  setCode: (value: string) => void;
  fromLink: boolean;
}) {
  const [step, setStep] = useState<"enter" | "confirm">(
    fromLink ? "confirm" : "enter",
  );
  const [verified, setVerified] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const verify = useAction(
    () =>
      api<Verification>(`/auth/device?user_code=${encodeURIComponent(code)}`),
    {
      onSuccess: ({ status }) => {
        if (status === "pending") setVerified(true);
        else setOutcome(status);
      },
    },
  );
  const decide = useAction(
    async (approve: boolean) => {
      await api(`/auth/device/${approve ? "approve" : "deny"}`, {
        userCode: code,
      });
      return approve ? "approved" : "denied";
    },
    { onSuccess: setOutcome },
  );
  const check = () => {
    setStep("confirm");
    verify.run();
  };
  // A code that arrived in the link is checked at once; the page opens on the confirmation.
  useEffect(() => {
    if (fromLink) verify.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const retype = () => {
    setStep("enter");
    setVerified(false);
    verify.reset();
    decide.reset();
  };

  if (outcome)
    return (
      <div className="device-result" role="status">
        <span
          className={`device-result-icon${outcome === "denied" ? " declined" : ""}`}
          aria-hidden="true"
        >
          <Icon name={outcome === "approved" ? "check" : "close"} />
        </span>
        <h2>
          {outcome === "approved" ? m.device_authorized() : m.device_declined()}
        </h2>
        <p>
          {outcome === "approved"
            ? m.device_authorized_note()
            : m.device_declined_note()}
        </p>
      </div>
    );

  if (step === "enter")
    return (
      <form
        className="device-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (code) check();
        }}
      >
        <p>{m.device_lead()}</p>
        <label>
          {m.device_code_label()}
          <Input
            className="device-input"
            value={code}
            maxLength={32}
            autoFocus
            autoComplete="one-time-code"
            spellCheck={false}
            onChange={(event) => setCode(normalize(event.target.value))}
            placeholder={m.device_code_placeholder()}
          />
        </label>
        <Button type="submit" variant="primary" disabled={!code}>
          {m.device_check_code()}
        </Button>
      </form>
    );

  const busy = verify.busy || decide.busy;
  const error = decide.error || verify.error;
  return (
    <>
      <p>{m.device_authorize_as({ name })}</p>
      <output className="device-code" aria-busy={verify.busy}>
        {code}
      </output>
      {verify.busy && (
        <p className="device-progress" role="status">
          {m.device_checking()}
        </p>
      )}
      {error && <Status error>{error}</Status>}
      {verified && !error && (
        <p className="device-note">
          <Icon name="info" />
          <span>{m.device_code_hint()}</span>
        </p>
      )}
      <div className="device-actions">
        {verified && !error && (
          <>
            <Button
              variant="primary"
              busy={decide.busy}
              disabled={busy}
              onClick={() => decide.run(true)}
            >
              {m.device_approve()}
            </Button>
            <Button disabled={busy} onClick={() => decide.run(false)}>
              {m.device_decline()}
            </Button>
          </>
        )}
        {!verify.busy && (
          <Button variant="ghost" disabled={decide.busy} onClick={retype}>
            {m.device_change_code()}
          </Button>
        )}
      </div>
    </>
  );
}
