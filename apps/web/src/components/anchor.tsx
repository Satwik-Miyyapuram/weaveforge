import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";

/** Outside URLs (`https:`, `mailto:` …) carry a scheme; app routes do not. */
export const isOutside = (href: string) => /^[a-z][a-z\d+.-]*:/i.test(href);

/**
 * A link for the button primitives: next/link for an app route, a plain anchor
 * for an outside URL, which Next can neither route nor prefetch.
 */
export function Anchor({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return isOutside(href) ? <a href={href} {...rest} /> : <Link href={href} {...rest} />;
}
