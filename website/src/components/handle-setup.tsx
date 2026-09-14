import { m } from "../paraglide/messages";
import { useI18n } from "../lib/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";

/** One-time @handle claim shown wherever a signed-in account still lacks one. */
export function HandleSetup() {
  const { errorText } = useI18n();
  const client = useQueryClient();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="account-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api("/profile/handle", { handle });
          await client.invalidateQueries({ queryKey: ["profile"] });
        } catch (e) {
          setError(errorText(e instanceof Error ? e : undefined));
          setBusy(false);
        }
      }}
    >
      <h2>{m.set_your_handle()}</h2>
      <p>{m.choose_a_handle_so_teammates_can_find_and_address()}</p>
      <label>
        {m.handle()}
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
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
          disabled={busy}
          aria-describedby="handle-rules"
        />
        <span id="handle-rules" className="muted">
          {m.start_with_a_letter_use_3_24_letters_numbers()}
        </span>
      </label>
      <button className="button yellow" disabled={busy}>
        {busy ? m.please_wait() : m.save_handle()}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
