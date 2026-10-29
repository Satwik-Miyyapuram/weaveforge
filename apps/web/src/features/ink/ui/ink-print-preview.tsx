"use client";

import { useRef } from "react";

import { Modal, ModalActions } from "@/components/modal";
import { Button } from "@/components/button";

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
        <ModalActions>
          <Button onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              const frame = frameRef.current?.contentWindow;
              if (!frame) return;
              frame.focus();
              frame.print();
            }}
          >
            Print…
          </Button>
        </ModalActions>
      </div>
    </Modal>
  );
}
