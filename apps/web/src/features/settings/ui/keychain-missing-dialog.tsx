import { KEYCHAIN_HELP } from "@/backend/providers/local/parts";
import { Button } from "@/components/button";
import { Modal, ModalActions } from "@/components/modal";

/**
 * Shown when a save has no OS keychain to hold the credentials. Nothing was
 * written anywhere else, so "Try again" is safe once the reader has installed
 * the keyring and unlocked it.
 */
export function KeychainMissingDialog({ onClose, onRetry }: { onClose: () => void; onRetry: () => void }) {
  return (
    <Modal title="Keychain needed" onClose={onClose}>
      <p>{KEYCHAIN_HELP}</p>
      <ModalActions>
        <Button variant="cancel" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={onRetry}>Try again</Button>
      </ModalActions>
    </Modal>
  );
}
