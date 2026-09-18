import { useState } from "react";
import { m } from "../paraglide/messages";
import { Button } from "./ui";

/** Keep a destructive action's consequence beside its explicit confirmation. */
export function ConfirmAction({
  label,
  description,
  busy,
  onConfirm,
}: {
  label: string;
  description: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <div className="action-confirmation">
      <p>{description}</p>
      <div className="actions">
        <Button variant="danger" busy={busy} onClick={onConfirm}>
          {label}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirming(false)}
        >
          {m.common_cancel()}
        </Button>
      </div>
    </div>
  ) : (
    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
      {label}
    </Button>
  );
}
