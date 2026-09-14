export class ApiError extends Error {
  code?: string;
  status: number;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
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
  const result = (await response.json()) as T & {
    error?: unknown;
    message?: string;
    code?: unknown;
  };
  if (!response.ok)
    throw new ApiError(
      typeof result.error === "string"
        ? result.error
        : result.message || "Something went wrong. Please try again.",
      response.status,
      typeof result.code === "string" ? result.code : undefined,
    );
  return result;
}
