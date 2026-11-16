/** Public surface of the web `canvas` feature. */
import dynamic from "next/dynamic";
import { ScreenLoader } from "@/components/weaveforge-loader";

export type { CanvasEditorProps } from "./ui/canvas-editor";

/** Loaded on first use: React Flow stays out of the bundle until a canvas opens. */
export const LazyCanvasEditor = dynamic(() => import("./ui/canvas-editor"), {
  ssr: false,
  loading: () => <ScreenLoader status="Loading canvas…" showTips={false} compact />,
});
