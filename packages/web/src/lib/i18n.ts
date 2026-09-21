import { getLocale } from "../paraglide/runtime";
import { m } from "../paraglide/messages";
import { TandryError } from "@tandryio/protocol";
import { ApiError } from "./api";

// Stable API error codes, translated at the UI boundary.
const byCode: Record<string, () => string> = {
  not_logged_in: m.error_not_logged_in,
  handle_required: m.error_handle_required,
  forbidden: m.error_forbidden,
  invalid_input: m.error_invalid_input,
  no_such_room: m.error_no_such_room,
  not_in_room: m.error_not_in_room,
  no_such_member: m.error_no_such_member,
  no_such_message: m.error_no_such_message,
  name_taken: m.error_name_taken,
  limit_reached: m.error_limit_reached,
  rate_limited: m.error_rate_limited,
  unavailable: m.error_policy_unavailable,
  upgrade_required: m.error_upgrade_required,
  already_in_room: m.error_already_in_room,
  OTP_SEND_FAILED: m.error_email_send_failed,
  INVALID_EMAIL: m.error_email_invalid,
  HANDLE_REQUIRED: m.error_handle_required,
  HANDLE_INVALID: m.error_handle_invalid,
  HANDLE_UNAVAILABLE: m.error_handle_unavailable,
  HANDLE_FIXED: m.error_handle_fixed,
  RATE_LIMITED: m.error_rate_limited,
  ROOM_LIMIT: m.error_room_limit,
  RESOURCE_CONFLICT: m.error_resource_conflict,
  ROOM_DISABLED: m.error_room_disabled,
  POLICY_UNAVAILABLE: m.error_policy_unavailable,
  CONVERSATION_LIMIT: m.error_conversation_limit,
  AUTH_CHECK_UNAVAILABLE: m.error_auth_unavailable,
  AVATAR_INVALID: m.account_avatar_invalid,
  AVATAR_TOO_LARGE: m.error_avatar_too_large,
  AVATAR_STORAGE_UNCONFIGURED: m.error_avatar_storage,
};
// Upstream messages without a code. User content is never translated.
const byMessage: Record<string, () => string> = {
  "Invalid OTP": m.error_otp_invalid,
  "OTP expired": m.error_otp_expired,
};

type ErrorLike = { message?: string; code?: string };

function describe(error: unknown): ErrorLike {
  if (typeof error === "string") return { message: error };
  if (error instanceof ApiError || error instanceof TandryError)
    return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message };
  if (error && typeof error === "object") return error as ErrorLike;
  return {};
}

/** Translate any thrown value, API error, or upstream error object for display. */
export function errorText(error: unknown): string {
  const { message, code } = describe(error);
  const known = (code && byCode[code]) || (message && byMessage[message]);
  return known ? known() : message || m.error_generic();
}

export function useI18n() {
  return { locale: getLocale(), errorText };
}

/** HTML lang attribute for the active locale. */
export function htmlLang(): string {
  return getLocale() === "zh" ? "zh-CN" : "en";
}
