import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { api } from "../lib/api";
import { useProfile } from "../lib/profile";
import { Shell } from "../components/shell";
import { HandleSetup } from "../components/handle-setup";
export const Route = createFileRoute("/device")({
  ssr: false,
  component: Device,
});
function Device() {
  const { errorText } = useI18n();
  const { data: session, isPending } = authClient.useSession();
  const profile = useProfile(session?.user.id);
  const [code, setCode] = useState(
    () => new URLSearchParams(window.location.search).get("user_code") ?? "",
  );
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  async function verify() {
    setBusy(true);
    setMessage("");
    try {
      await api(`/auth/device?user_code=${encodeURIComponent(code)}`);
      setVerified(true);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? errorText(e.message)
          : m.this_code_is_invalid_or_has_expired(),
      );
    } finally {
      setBusy(false);
    }
  }
  async function decide(approve: boolean) {
    setBusy(true);
    try {
      await api(`/auth/device/${approve ? "approve" : "deny"}`, {
        userCode: code,
      });
      setDone(true);
      setMessage(
        approve
          ? m.device_authorized_return_to_your_agent_session_to_continue()
          : m.device_authorization_declined(),
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? errorText(e.message)
          : m.something_went_wrong_please_try_again(),
      );
    } finally {
      setBusy(false);
    }
  }
  const next = `/device?user_code=${encodeURIComponent(code)}`;
  return (
    <Shell>
      <section className="account-card narrow">
        <span className="kicker">CONNECT YOUR DEVICE</span>
        <h1>{m.authorize_agent_room()}</h1>
        {isPending ? (
          <p>{m.checking_your_session()}</p>
        ) : !session ? (
          <>
            <p>{m.sign_in_to_authorize_the_device_you_are_using()}</p>
            <a
              className="button yellow"
              href={`/login?next=${encodeURIComponent(next)}`}
            >
              {m.sign_in_to_continue()}
            </a>
          </>
        ) : done ? (
          <p role="status">{message}</p>
        ) : profile.isPending ? (
          <p>{m.loading()}</p>
        ) : profile.error ? (
          <p role="alert">{errorText(profile.error)}</p>
        ) : !profile.data?.handle ? (
          // A plugin login is useless without a handle; claim it before approving.
          <HandleSetup />
        ) : (
          <>
            <p>
              {m.authorize_as()}
              <strong>{session.user.name}</strong>{" "}
              {m.the_agent_room_plugin_on_this_device_can_manage()}
            </p>
            <label>
              {m.device_code()}
              <input
                value={code}
                maxLength={32}
                autoComplete="one-time-code"
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
                  setVerified(false);
                }}
                placeholder={m.enter_the_code_shown_by_your_plugin()}
              />
            </label>
            <p>{m.check_that_the_code_below_matches_your_plugin_only()}</p>
            {!verified ? (
              <button disabled={busy || !code.trim()} onClick={verify}>
                {m.check_code()}
              </button>
            ) : (
              <>
                <output className="device-code">{code}</output>
                <div className="actions">
                  <button
                    className="button yellow"
                    disabled={busy}
                    onClick={() => decide(true)}
                  >
                    {m.codes_match_authorize_device()}
                  </button>
                  <button disabled={busy} onClick={() => decide(false)}>
                    {m.decline()}
                  </button>
                </div>
              </>
            )}
            {message && (
              <p role="alert" className="error">
                {message}
              </p>
            )}
          </>
        )}
      </section>
    </Shell>
  );
}
