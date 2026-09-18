import {
  decodeResult,
  encodeCall,
  type Input,
  type OperationName,
  type Output,
  type RoomId,
} from "@tandryio/protocol";

/** Website calls act as an account observer and never carry a conversation. */
export async function call<K extends OperationName>(
  op: K,
  input: Input<K>,
  room?: RoomId,
): Promise<Output<K>> {
  const { path, ...request } = encodeCall(op, { room }, input);
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
