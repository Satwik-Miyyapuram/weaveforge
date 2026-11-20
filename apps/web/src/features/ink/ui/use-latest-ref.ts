import { useEffect, useRef } from "react";

/** A ref that always holds the latest committed `value`, for callbacks that outlive a render. */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
