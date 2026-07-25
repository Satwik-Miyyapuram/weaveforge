"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Track whether the current detail view was opened via router.push (vs deep link). */
export function useDetailPushFlag() {
  const pushedRef = useRef(false);
  const setPushed = useCallback(() => {
    pushedRef.current = true;
  }, []);
  const consumePushed = useCallback(() => {
    const pushed = pushedRef.current;
    pushedRef.current = false;
    return pushed;
  }, []);
  return { setPushed, consumePushed };
}

/**
 * Navigate back to a list view. Uses history.back when the user drilled in via
 * push; falls back to replace(listPath) for deep links.
 */
export function useDetailBack(listPath: string, paramKey: string, consumePushed: () => boolean) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return useCallback(() => {
    if (!searchParams.get(paramKey)) return;
    if (consumePushed()) {
      router.back();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.delete(paramKey);
    const qs = params.toString();
    router.replace(qs ? `${listPath}?${qs}` : listPath);
  }, [router, searchParams, listPath, paramKey, consumePushed]);
}
