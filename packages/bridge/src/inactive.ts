import type { LinkEnd } from "./link";

export interface InactiveView {
  loggedIn: boolean;
  bound: boolean;
  joined: boolean;
  ended: { reason: LinkEnd; message?: string } | null;
  connected: boolean;
}

const ENDED: Record<LinkEnd, string> = {
  superseded: "This conversation is now open elsewhere, and that process receives the notices. To work in both, fork the conversation in the host and join from the fork.",
  rebound: "This member was continued from another conversation. Call join to take part again.",
  not_in_room: "This conversation's member left the room or was removed. Call join to take part again.",
  upgrade_required: "The Tandry plugin is too old for the Hub. Ask the owner to update it.",
  not_logged_in: "The Hub no longer accepts this machine's sign-in. Call login.",
};

/** The first reason that holds, in a fixed order; null when messages are arriving normally. */
export function inactive(view: InactiveView): string | null {
  if (!view.loggedIn) return "Not signed in. Call login.";
  if (!view.bound) return "The host has not given this conversation's ID yet.";
  if (!view.joined) return "This conversation has not joined a room.";
  if (view.ended) return view.ended.message && view.ended.reason === "upgrade_required" ? view.ended.message : ENDED[view.ended.reason];
  if (!view.connected) return "The connection to the Hub dropped; reconnecting. Operations still work.";
  return null;
}
