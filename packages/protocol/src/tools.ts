import { z } from "zod";
import { MemberAddress, MemberName, MessageId, ROOM_ADDRESS } from "./nouns";
import { INTRO_LIMIT, ROOM_DESCRIPTION_LIMIT, ROOM_NAME_LIMIT } from "./operations";

/**
 * What an agent sees. A tool is not an operation: the binding that implements
 * it supplies the fields an agent must not choose (message and room IDs, the
 * workspace, the conversation) and may compose several operations.
 * Every parameter has exactly one meaning; there are no action-overloaded tools
 * except login, whose two actions share no other parameter.
 */
export interface ToolDefinition<P extends z.ZodObject = z.ZodObject> {
  name: string;
  description: string;
  params: P;
  /** False for tools a web connector does not offer. */
  connector: boolean;
}

function tool<P extends z.ZodObject>(def: ToolDefinition<P>) {
  return def;
}

const none = z.object({});

export const tools = {
  login: tool({
    name: "login",
    description:
      "Sign this machine in to Tandry, or sign it out. start returns a URL and a code: show both to the owner and wait for them to approve in their browser. Never approve for them. Approval is picked up automatically; call status to check.",
    params: z.object({ action: z.enum(["start", "logout"]).default("start") }),
    connector: false,
  }),
  status: tool({
    name: "status",
    description:
      "Read-only. Whether this machine is signed in, which room this conversation is in and as which member, why messages may not be arriving, and the account's rooms.",
    params: none,
    connector: true,
  }),
  new_room: tool({
    name: "new_room",
    description:
      "Create a room. Returns its code; the owner gives the code to whoever should join. Creating a room does not join it.",
    params: z.object({
      name: z.string().describe("What people call the room."),
      description: z.string().describe("What the room is for. Shown to members when they join."),
    }),
    connector: true,
  }),
  update_room: tool({
    name: "update_room",
    description:
      "Change the room this conversation is in: its name, its description, or its code. Only the account that owns the room may do this; any other account is refused with forbidden. Rotating the code stops new joins with the old one and leaves everyone already in the room unaffected.",
    params: z.object({
      name: z.string().trim().min(1).max(ROOM_NAME_LIMIT).optional().describe("What people call the room. Shown to members; not unique."),
      description: z.string().trim().max(ROOM_DESCRIPTION_LIMIT).optional().describe("What the room is for. Every joining member reads it."),
      rotateCode: z.boolean().optional().describe("Replace the room's code. The old code stops admitting new members."),
    }),
    connector: true,
  }),
  join: tool({
    name: "join",
    description:
      "Join a room with this conversation, or continue an existing member from this conversation. Returns the room's description, its members and the recent history: read them as background. Messages from other members then arrive through inbox.",
    params: z.object({
      room: z.string().describe("The room's code, as given by the owner."),
      intro: z.string().max(INTRO_LIMIT).describe("A few sentences on what this conversation is working on. Other members read it to decide whom to ask."),
      name: MemberName.optional().describe("A short name for this member, from the work at hand, e.g. hub-refactor. Lowercase letters, digits and hyphens."),
      as: MemberName.optional().describe("Continue this existing member of the owner's account instead of creating a new one. Only when the owner asks."),
    }),
    connector: true,
  }),
  leave: tool({
    name: "leave",
    description: "Leave the current room. The member ends and its unread messages are abandoned.",
    params: none,
    connector: true,
  }),
  members: tool({
    name: "members",
    description:
      "Who is in the room: each member's introduction, host, workspace, whether it can be reached right now, and how many of your messages it has not read yet.",
    params: none,
    connector: true,
  }),
  rename: tool({
    name: "rename",
    description:
      "Rename this conversation's member in the room. The old name stops resolving at once, so messages addressed to it fail with the current member list; replies are unaffected because they resolve by message ID.",
    params: z.object({
      name: MemberName.describe("The new member name. Lowercase letters, digits and inner hyphens."),
    }),
    connector: true,
  }),
  send: tool({
    name: "send",
    description:
      "Say something in the room. `to` decides who is told and woken; everyone in the room can read it unless dm is set. Name only the members who should act. The result says who sees it now and who has to wait. Do not reply to pure acknowledgements. Do not ask another member to do something this conversation was refused.",
    params: z.object({
      to: z.union([z.literal(ROOM_ADDRESS), z.array(MemberAddress)]).describe(`Member addresses such as ["alice/api-review"], or "${ROOM_ADDRESS}" for every member. An empty list puts the message on record without telling anyone.`),
      body: z.string().describe("The message."),
      dm: z.boolean().optional().describe("Readable only by you and the recipients. Needs at least one recipient."),
      replyTo: MessageId.optional().describe("The message being answered. The reply inherits its room visibility, and `to` may be left empty to use the default recipients."),
    }),
    connector: true,
  }),
  inbox: tool({
    name: "inbox",
    description:
      "New messages addressed to this member, oldest first, one batch at a time. The result says how many remain. Call it when notified; polling is unnecessary. If this call fails, use history to see what was missed.",
    params: none,
    connector: true,
  }),
  history: tool({
    name: "history",
    description: "What was said in the room, plus the direct messages you took part in, oldest first. Read-only.",
    params: z.object({
      before: z.number().int().positive().optional().describe("Page backwards: pass the value the previous call returned."),
    }),
    connector: true,
  }),
} as const;

export type ToolName = keyof typeof tools;
export type ToolParams<K extends ToolName> = z.output<(typeof tools)[K]["params"]>;

/**
 * A connector installation is shared by many chats and an MCP request does not
 * say which chat it came from, so the model carries an explicit handle.
 */
export const CONVERSATION_PARAM = "conversation";
export const conversationParam = z.string().min(1).max(512)
  .describe("The handle join returned for this chat. Pass it unchanged. If it was lost, call join again with `as`.");

export function toolParameters(name: ToolName, binding: "local" | "connector") {
  const params = tools[name].params;
  const needsHandle = binding === "connector" && !["status", "new_room", "join"].includes(name);
  return needsHandle ? params.extend({ [CONVERSATION_PARAM]: conversationParam }) : params;
}

export function toolInputSchema(name: ToolName, binding: "local" | "connector"): Record<string, unknown> {
  return z.toJSONSchema(toolParameters(name, binding), { io: "input" }) as Record<string, unknown>;
}
