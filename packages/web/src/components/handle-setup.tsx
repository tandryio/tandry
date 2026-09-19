import { Button, Input, Status } from "./ui";
import { m } from "../paraglide/messages";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useAction } from "../lib/action";

/** One-time @handle claim shown wherever a signed-in account still lacks one. */
export function HandleSetup() {
  const client = useQueryClient();
  const [handle, setHandle] = useState("");
  const save = useAction(
    (value: string) => api("/profile/handle", { handle: value }),
    { onSuccess: () => client.invalidateQueries({ queryKey: ["profile"] }) },
  );
  return (
    <form
      className="account-card"
      onSubmit={(event) => {
        event.preventDefault();
        save.run(handle);
      }}
    >
      <h2>{m.handle_title()}</h2>
      <p>{m.handle_intro()}</p>
      <label>
        {m.handle_label()}
        <Input
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
          disabled={save.busy}
          aria-describedby="handle-rules"
        />
        <span id="handle-rules" className="muted">
          {m.handle_rules()}
        </span>
      </label>
      <Button variant="primary" busy={save.busy}>
        {save.busy ? m.common_please_wait() : m.handle_save()}
      </Button>
      {save.error && <Status error>{save.error}</Status>}
    </form>
  );
}
