import { Button, Input, Icon, Status } from "../components/ui";
import { m } from "../paraglide/messages";
import { useState } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/action";
import { Shell } from "../components/shell";
import { RequireAccount } from "../components/require-account";

export function Device() {
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get("user_code") ?? "",
  );
  const next = `/device?user_code=${encodeURIComponent(code)}`;
  return (
    <Shell>
      <section className="account-card narrow">
        <div className="auth-icon">
          <Icon name="monitor" />
        </div>
        <span className="kicker">{m.device_kicker()}</span>
        <h1>{m.device_title()}</h1>
        <RequireAccount
          next={next}
          signInPrompt={m.device_sign_in_prompt()}
          signInLabel={m.device_sign_in_button()}
        >
          {({ session }) => (
            <DeviceApproval
              name={session.user.name}
              code={code}
              setCode={setCode}
            />
          )}
        </RequireAccount>
      </section>
    </Shell>
  );
}

function DeviceApproval({
  name,
  code,
  setCode,
}: {
  name: string;
  code: string;
  setCode: (value: string) => void;
}) {
  const [verified, setVerified] = useState(false);
  const [outcome, setOutcome] = useState("");
  const verify = useAction(
    () => api(`/auth/device?user_code=${encodeURIComponent(code)}`),
    { onSuccess: () => setVerified(true) },
  );
  const decide = useAction(
    async (approve: boolean) => {
      await api(`/auth/device/${approve ? "approve" : "deny"}`, {
        userCode: code,
      });
      return approve;
    },
    {
      onSuccess: (approve) =>
        setOutcome(approve ? m.device_authorized() : m.device_declined()),
    },
  );
  if (outcome) return <p role="status">{outcome}</p>;
  const busy = verify.busy || decide.busy;
  const error = decide.error || verify.error;
  return (
    <>
      <p>{m.device_authorize_as({ name })}</p>
      <label>
        {m.device_code_label()}
        <Input
          value={code}
          maxLength={32}
          autoComplete="one-time-code"
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setVerified(false);
            verify.reset();
          }}
          placeholder={m.device_code_placeholder()}
        />
      </label>
      <p>{m.device_code_hint()}</p>
      {!verified ? (
        <Button
          variant="primary"
          busy={verify.busy}
          disabled={busy || !code.trim()}
          onClick={() => verify.run()}
        >
          {m.device_check_code()}
        </Button>
      ) : (
        <>
          <output className="device-code">{code}</output>
          <div className="actions">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => decide.run(true)}
            >
              {m.device_approve()}
            </Button>
            <Button disabled={busy} onClick={() => decide.run(false)}>
              {m.device_decline()}
            </Button>
          </div>
        </>
      )}
      {error && <Status error>{error}</Status>}
    </>
  );
}
