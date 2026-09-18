import type { Output, Unread } from "@tandryio/protocol";

/**
 * The bridge's whole knowledge of mail: two numbers, never written to disk.
 * `consumed` is how far messages have been handed to the conversation;
 * `pending` is the newest unread position seen, from a notify frame or from
 * an inbox result's `remaining`. There is no "clear on read": unread is
 * `pending.upTo > consumed`, so a half-read batch or a notice arriving
 * mid-read is never lost. After a restart both are empty and the Hub's notice
 * on reconnect fills `pending` again.
 */
export class UnreadState {
  private consumed = 0;
  private pending: Unread | null = null;
  private listeners: (() => void)[] = [];

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  notified(unread: Unread): void {
    if (!this.pending || unread.upTo >= this.pending.upTo) this.pending = unread;
    this.changed();
  }

  /** A batch was handed over. `remaining` is fresher than an older notice for the same position. */
  handedOver(batch: Pick<Output<"inbox">, "upTo" | "remaining">): void {
    this.consumed = Math.max(this.consumed, batch.upTo);
    if (batch.remaining && (!this.pending || batch.remaining.upTo >= this.pending.upTo)) this.pending = batch.remaining;
    if (this.pending && this.pending.upTo <= this.consumed) this.pending = null;
    this.changed();
  }

  current(): Unread | null {
    return this.pending && this.pending.upTo > this.consumed ? this.pending : null;
  }

  /** Names one unread state. It changes when new mail arrives or when the agent reads some. */
  key(): string | null {
    const unread = this.current();
    return unread ? `${unread.upTo}:${this.consumed}` : null;
  }

  reset(): void {
    this.consumed = 0;
    this.pending = null;
    this.changed();
  }
}
