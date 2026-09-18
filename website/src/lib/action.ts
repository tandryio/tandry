import { useMutation } from "@tanstack/react-query";
import { errorText } from "./i18n";

/**
 * A user-triggered async action with busy state and a translated error string.
 * Wraps react-query's useMutation so pages stop hand-rolling try/catch/finally.
 */
export function useAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: { onSuccess?: (result: TResult) => unknown } = {},
) {
  const mutation = useMutation({
    mutationFn: (args: TArgs) => fn(...args),
    onSuccess: options.onSuccess,
  });
  return {
    run: (...args: TArgs) => mutation.mutate(args),
    busy: mutation.isPending,
    error: mutation.error ? errorText(mutation.error) : "",
    reset: mutation.reset,
  };
}
