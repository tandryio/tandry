export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** A Hub API response. Errors throw ApiError; a body that is not JSON still does. */
async function unwrap<T>(response: Response): Promise<T> {
  const result = (await response.json().catch(() => null)) as
    | (T & {
        error?: unknown;
        error_description?: unknown;
        message?: string;
        code?: unknown;
      })
    | null;
  if (!response.ok)
    throw new ApiError(
      typeof result?.error_description === "string"
        ? result.error_description
        : typeof result?.error === "string"
          ? result.error
          : (result?.message ?? response.statusText),
      response.status,
      typeof result?.code === "string" ? result.code : undefined,
    );
  return result as T;
}

/** Fetch a Hub API route; a body makes it a JSON POST. Errors throw ApiError. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return unwrap<T>(response);
}

/** POST raw bytes to a Hub API route. A picture is not JSON and is not encoded as one. */
export async function upload<T>(path: string, body: Blob): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": body.type || "application/octet-stream" },
    body,
  });
  return unwrap<T>(response);
}
