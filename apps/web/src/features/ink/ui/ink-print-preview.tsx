"use client";

import { useRef } from "react";

import { Modal } from "@/components/modal";

/**
 * The page before it is printed: the print document in a frame of its own,
 * with the two buttons the dialog would otherwise hide. Electron has no
 * print preview (its `print()` goes straight to the system dialog) and a
 * browser's shows a page the user cannot look over first; this is the same
 * on both. The frame prints itself, so what is on paper is what is shown.
 */
export function InkPrintPreview({
  html,
  title,
  onClose,
}: {
  html: string;
  title: string;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="ink-print-preview">
        <iframe
          ref={frameRef}
          className="ink-print-preview-frame"
          title={title}
          srcDoc={html}
        />
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              const frame = frameRef.current?.contentWindow;
              if (!frame) return;
              frame.focus();
              frame.print();
            }}
          >
            Print…
          </button>
        </div>
      </div>
    </Modal>
  );
}
