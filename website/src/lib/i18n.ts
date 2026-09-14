import { getLocale } from "../paraglide/runtime";
import { m } from "../paraglide/messages";

// Stable API error codes, translated at the UI boundary.
const byCode: Record<string, () => string> = {
  HANDLE_REQUIRED: m.handle_required,
  HANDLE_INVALID: m.handle_invalid,
  HANDLE_UNAVAILABLE: m.handle_unavailable,
  HANDLE_FIXED: m.handle_fixed,
  RATE_LIMITED: m.too_many_attempts_please_try_again_later,
};
// Upstream messages without a code. User content is never translated.
const byMessage: Record<string, () => string> = {
  "Invalid OTP": m.otp_invalid,
  "OTP expired": m.otp_expired,
  "验证码发送失败，请稍后重试":
    m.could_not_send_the_code_please_try_again_later,
  "验证码请求过于频繁，请稍后再试":
    m.too_many_code_requests_please_try_again_later,
  请输入有效邮箱: m.enter_a_valid_email_address,
};
export function useI18n() {
  const locale = getLocale();
  const errorText = (error?: string | { message?: string; code?: string }) => {
    const { message, code } =
      typeof error === "string"
        ? { message: error, code: undefined }
        : (error ?? {});
    const known = (code && byCode[code]) || (message && byMessage[message]);
    return known
      ? known()
      : message || m.something_went_wrong_please_try_again();
  };
  return { locale, errorText };
}
