"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { PdfReader as PdfReaderType } from "./pdf-reader";

type Props = ComponentProps<typeof PdfReaderType>;

/**
 * Lazy boundary for the pdf.js reader. pdf.js + its worker are heavy and only
 * needed on the reader route, so they are code-split out of every other
 * screen's first-load graph and fetched on first use (Phase D chunk budget).
 */
const LazyPdfReader = dynamic(() => import("./pdf-reader").then((m) => m.PdfReader), {
  ssr: false,
  loading: () => <div className="pdf-reader-loading">Loading reader…</div>,
});

export function PdfReader(props: Props) {
  return <LazyPdfReader {...props} />;
}
