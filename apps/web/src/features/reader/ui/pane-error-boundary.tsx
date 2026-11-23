import { Component, createElement, type ErrorInfo, type ReactNode } from "react";
import { logToApp } from "../../../lib/error-report/app-log";
import { paneErrorReport } from "./pane-error-report";

/**
 * Keeps one reader pane from taking the whole shell down: a render error in the
 * pane is logged to the app log and a short message with a "Try again" button
 * shows in its place; the rest of the app keeps running.
 */
export class PaneErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logToApp(paneErrorReport(this.props.label, error, info.componentStack ?? ""));
  }

  retry = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return createElement(
        "div",
        { className: "card empty-state", role: "alert" },
        createElement("h2", null, `${this.props.label} could not be shown`),
        createElement("p", null, this.state.error.message),
        createElement("button", { type: "button", onClick: this.retry }, "Try again"),
      );
    }
    return this.props.children;
  }
}
