"use client";

import type { RefObject } from "react";

/**
 * The ink host's two hidden file pickers: a PDF or image that becomes a new page,
 * and an image (or PDF) that becomes a figure on the current page. The bar's
 * buttons click them through the refs; each clears its value so the same file
 * can be picked twice.
 */
export function InkFileInputs({
  pdfInputRef,
  imageInputRef,
  onPageFile,
  onImageFile,
}: {
  pdfInputRef: RefObject<HTMLInputElement | null>;
  imageInputRef: RefObject<HTMLInputElement | null>;
  onPageFile: (file: File) => void;
  onImageFile: (file: File) => void;
}) {
  return (
    <>
      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf,.pdf,image/*"
        hidden
        data-ink-page-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onPageFile(file);
        }}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        hidden
        data-ink-image-input=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImageFile(file);
        }}
      />
    </>
  );
}
