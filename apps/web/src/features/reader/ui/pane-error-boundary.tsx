import { Component, type ReactNode } from "react";

/**
 * Keeps one reader pane from taking the whole shell down: a render error in the
 * pane shows a short message in its place and the rest of the app keeps running.
 */
export class PaneErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card empty-state" role="alert">
          <h2>{this.props.label} could not be shown</h2>
          <p>{this.state.error.message}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
