import { useId, useState } from "react";
import { m } from "../paraglide/messages";
import { Button } from "./ui";

const DANGER_TEXT = "text-rose-300/85 hover:bg-rose-300/10 hover:text-rose-200";

/**
 * A destructive action confirmed in place: the trigger turns into the
 * confirm and cancel buttons, and the consequence stays attached to them for
 * tooltips and assistive technology.
 */
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
  const descriptionId = useId();
  return confirming ? (
    <span
      className="action-confirmation"
      role="group"
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) setConfirming(false);
      }}
    >
      <span id={descriptionId} className="sr-only">
        {description}
      </span>
      <Button
        variant="danger"
        size="sm"
        className="border-rose-400/45 bg-rose-400/15 text-rose-200 hover:border-rose-400/60 hover:bg-rose-400/25"
        busy={busy}
        title={description}
        onClick={onConfirm}
      >
        {label}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setConfirming(false)}
      >
        {m.common_cancel()}
      </Button>
    </span>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      className={DANGER_TEXT}
      title={description}
      disabled={busy}
      onClick={() => setConfirming(true)}
    >
      {label}
    </Button>
  );
}
