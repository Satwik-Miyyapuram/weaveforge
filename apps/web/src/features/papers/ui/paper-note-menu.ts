import type { MenuItem } from "../../../components/menu";

/** What the paper page's right-click menu needs: its state and its actions. */
export interface PaperNoteMenu {
  readOnly: boolean;
  busy: boolean;
  /** A PDF or a web page the reader can open. */
  hasReader: boolean;
  watching: boolean;
  /** Citation alerts need a DOI or an arXiv ID. */
  canWatch: boolean;
  status: string;
  statuses: readonly string[];
  statusLabel: (status: string) => string;
  openInEditor: () => void;
  openReader: () => void;
  copyCitation: () => void;
  /** The whole reference, ready to paste (APA). */
  copyReference: () => void;
  copyBibtex: () => void;
  copyTitle: () => void;
  setStatus: (status: string) => void;
  toggleWatch: () => void;
  editIdentifiers: () => void;
  remove: () => void;
}

const SEPARATOR = (id: string): MenuItem => ({ id, label: "", kind: "separator" });

/** The paper page's right-click menu: the record bar's actions, in one place. */
export function paperNoteMenuItems(m: PaperNoteMenu): MenuItem[] {
  const items: MenuItem[] = [];
  if (!m.readOnly) items.push({ id: "open-editor", label: "Open in editor", onSelect: m.openInEditor });
  if (m.hasReader) items.push({ id: "open-reader", label: "Open in reader", onSelect: m.openReader });
  items.push(
    { id: "cite", label: "Copy citation", onSelect: m.copyCitation },
    { id: "copy-reference", label: "Copy reference", onSelect: m.copyReference },
    { id: "copy-bibtex", label: "Copy BibTeX", onSelect: m.copyBibtex },
    { id: "copy-title", label: "Copy title", onSelect: m.copyTitle },
  );
  if (m.readOnly) return items;

  items.push(SEPARATOR("sep-status"), {
    id: "status",
    label: "Reading status",
    disabled: m.busy,
    submenu: m.statuses.map((status) => ({
      id: `status-${status}`,
      label: m.statusLabel(status),
      kind: "check" as const,
      checked: status === m.status,
      onSelect: () => m.setStatus(status),
    })),
  });
  if (m.canWatch) {
    items.push({
      id: "watch",
      label: m.watching ? "Stop citation alerts" : "Watch for new citations",
      onSelect: m.toggleWatch,
    });
  }
  items.push(
    { id: "ids", label: "Edit DOI / arXiv ID", onSelect: m.editIdentifiers },
    SEPARATOR("sep-delete"),
    { id: "delete", label: "Delete paper", danger: true, disabled: m.busy, onSelect: m.remove },
  );
  return items;
}
