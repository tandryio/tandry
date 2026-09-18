import { createHub } from "./hub";
import { defaultPolicy } from "./policy/policy";
import { createRoomDO } from "./room-do/room-do";

export { createHub, type HubApp, type HubOptions } from "./hub";
export { createRoomDO } from "./room-do/room-do";
export { defaultPolicy, type Limits, type Policy, type PolicyFactory, type UsageEvent } from "./policy/policy";
export type { Env } from "./env";

// The self-hosted entry: the default policy, no extra routes.
export class RoomDO extends createRoomDO(defaultPolicy) {}
export default createHub({ policy: defaultPolicy });
