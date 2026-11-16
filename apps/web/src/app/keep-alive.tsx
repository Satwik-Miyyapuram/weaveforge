"use client";

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ScreenActiveContext, useScreenActive } from "@/lib/hooks/use-screen-active";
import { RouteError } from "./route-error";

/**
 * Screens kept mounted behind the others, like the workspace (`WorkspaceHost`).
 *
 * A route page is thrown away when the person goes to another screen, and
 * coming back builds it again. For Papers that is its whole card grid: leaving
 * it and coming back cost ~110 ms of unmount and mount, with the data already
 * in the screen cache. So a kept route's page does not render its screen
 * itself: `KeepAliveRoute` hands the screen to the provider, which renders it
 * in a host beside the routes. Another screen only hides it (`display: none`,
 * `inert`, `useScreenActive() === false`), and coming back shows it as it was.
 *
 * The screen still loads with its own route's chunk: the page passes it in, so
 * the shell imports none of it.
 *
 * Only what is opened is kept, one per path, and only for the current
 * project: a project switch drops them. Off on the phone layout, where a
 * kept screen buys little and memory is tightest.
 */
type Registry = {
  projectId: string;
  register: (path: string, scope: string, node: ReactNode) => void;
};

const KeepAliveContext = createContext<Registry | null>(null);

type Entry = { scope: string; node: ReactNode };
type Kept = { projectId: string; entries: ReadonlyMap<string, Entry> };

export function KeepAliveProvider({
  pathname,
  projectId,
  enabled,
  children,
}: {
  pathname: string;
  projectId: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [kept, setKept] = useState<Kept>({ projectId, entries: new Map() });
  // A switch of project (or to the phone layout) drops what was kept. Done
  // while rendering, so the last project's screen never renders against the
  // new one.
  if (kept.projectId !== projectId || (!enabled && kept.entries.size > 0)) {
    setKept({ projectId, entries: new Map() });
  }

  const register = useCallback((path: string, scope: string, node: ReactNode) => {
    setKept((prev) => {
      if (prev.projectId !== projectId) return prev;
      const entries = new Map(prev.entries);
      entries.set(path, { scope, node });
      return { projectId, entries };
    });
  }, [projectId]);

  const registry = useMemo(() => (enabled ? { projectId, register } : null), [enabled, projectId, register]);

  return (
    <KeepAliveContext.Provider value={registry}>
      {children}
      {[...kept.entries].map(([path, { scope, node }]) => {
        // `trailingSlash` export: either spelling is the same route.
        const shown = pathname === path || pathname === `${path}/`;
        return (
          <div
            key={`${kept.projectId}:${path}`}
            className="keep-alive-host"
            data-shown={shown ? "" : undefined}
            inert={!shown}
          >
            <ScreenActiveContext.Provider value={shown}>
              <KeptBoundary scope={scope}>{node}</KeptBoundary>
            </ScreenActiveContext.Provider>
          </div>
        );
      })}
    </KeepAliveContext.Provider>
  );
}

/**
 * A kept route's page. Hands its screen to the provider and renders nothing in
 * the route's place; without a provider (or on the phone layout) it renders
 * the screen right here, like any other page.
 */
export function KeepAliveRoute({ path, scope, children }: { path: string; scope: string; children: ReactNode }) {
  const registry = useContext(KeepAliveContext);
  useLayoutEffect(() => {
    registry?.register(path, scope, children);
  }, [registry, path, scope, children]);
  return registry ? null : children;
}

/**
 * `value` as of the last render on show. A kept screen still re-renders while
 * hidden, and URL state such as `useSearchParams()` then belongs to whatever
 * screen is up, which must not close the paper this one has open.
 */
export function useWhileShown<T>(value: T): T {
  const active = useScreenActive();
  const [kept, setKept] = useState(value);
  if (active && kept !== value) setKept(value);
  return active ? value : kept;
}

/**
 * The kept screen renders outside its route, so its route's `error.tsx` cannot
 * catch it. This stands in, so a broken screen stays one broken screen rather
 * than the app-level error.
 */
class KeptBoundary extends Component<{ scope: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <RouteError scope={this.props.scope} error={error} reset={() => this.setState({ error: null })} />;
  }
}
