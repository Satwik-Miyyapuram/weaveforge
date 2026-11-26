"use client";

import { Modal, ModalActions } from "@/components/modal";
import { Button } from "@/components/button";

/** What the share dialog says on a files workspace in 0.9.7: sharing comes back in 0.9.8 as live collaboration. */
export function SharingLaterBody({ onClose }: { onClose: () => void }) {
  return (
    <>
      <p>Sharing returns in 0.9.8, as live collaboration on your files. Your notes stay in your workspace folder.</p>
      <ModalActions>
        <Button onClick={onClose}>Close</Button>
      </ModalActions>
    </>
  );
}

export function SharingLaterNotice({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <SharingLaterBody onClose={onClose} />
    </Modal>
  );
}
