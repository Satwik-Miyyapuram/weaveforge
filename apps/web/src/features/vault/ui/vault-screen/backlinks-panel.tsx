"use client";

/** "Linked mentions": notes that [[wikilink]] to the open note. */
export function BacklinksPanel({ items, onOpen }: { items: { id: string; title: string }[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="card vault-backlinks">
      <h4 className="vault-backlinks__head">Linked mentions <span className="muted">{items.length}</span></h4>
      <ul className="vault-backlinks__list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className="link-btn" onClick={() => onOpen(it.id)}>{it.title}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
