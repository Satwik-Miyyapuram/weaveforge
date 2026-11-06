import { useState, type ReactNode } from "react";
import { ChevronIcon } from "@/components/chevron-icon";
import { RowButton } from "@/components/controls";

/** One sidebar panel with a header that folds it, as Overleaf's. */
function Panel({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className={`overleaf-panel${open ? " overleaf-panel--open" : ""}`}>
      <h3 className="overleaf-panel__head">
        <RowButton aria-expanded={open} onClick={onToggle}>
          <ChevronIcon open={open} variant="expand" size={14} />
          <span>{title}</span>
        </RowButton>
      </h3>
      {open && <div className="overleaf-panel__body">{children}</div>}
    </section>
  );
}

/** Overleaf's left rail: the file tree above the file outline, each folding from its header. */
export function OverleafSidebar({ files, outline }: { files: ReactNode; outline: ReactNode }) {
  const [filesOpen, setFilesOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  return (
    <div className="overleaf-sidebar">
      <Panel title="File tree" open={filesOpen} onToggle={() => setFilesOpen((o) => !o)}>{files}</Panel>
      <Panel title="File outline" open={outlineOpen} onToggle={() => setOutlineOpen((o) => !o)}>{outline}</Panel>
    </div>
  );
}
