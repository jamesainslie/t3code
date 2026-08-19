import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delayMs`. With a zero
 * delay the value passes through immediately; with a positive delay the hook
 * starts unsettled (returns null) so a streaming consumer never observes a
 * settled value until the first quiet period.
 */
export function useSettledValue<T>(value: T, delayMs: number): T | null {
  const [settled, setSettled] = useState<T | null>(() => (delayMs > 0 ? null : value));

  useEffect(() => {
    if (delayMs <= 0) {
      setSettled(value);
      return;
    }
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
