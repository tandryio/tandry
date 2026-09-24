import {
  decodeResult,
  encodeCall,
  type Input,
  type OperationName,
  type Output,
  type RoomId,
  WEBSITE_CONVERSATION,
} from "@tandryio/protocol";

/**
 * Website calls act as an account observer, or, with `asMember`, as the
 * account's website member of the room: the owner taking part in person.
 */
export async function call<K extends OperationName>(
  op: K,
  input: Input<K>,
  room?: RoomId,
  asMember = false,
): Promise<Output<K>> {
  const { path, ...request } = encodeCall(
    op,
    { room, conversation: asMember ? WEBSITE_CONVERSATION : undefined },
    input,
  );
  const response = await fetch(path, {
    ...request,
    credentials: "same-origin",
  });
  return decodeResult(
    op,
    response.status,
    await response.json().catch(() => null),
  );
}
