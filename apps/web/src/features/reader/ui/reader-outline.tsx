"use client";

export interface ReaderOutlineItem {
  title: string;
  pageNumber: number | null;
  items?: ReaderOutlineItem[];
}

interface ReaderOutlineProps {
  items: ReaderOutlineItem[];
  onNavigate: (pageNumber: number) => void;
}

export function ReaderOutline({ items, onNavigate }: ReaderOutlineProps) {
  if (items.length === 0) {
    return <p className="muted pdf-reader-outline-empty">No outline in this PDF.</p>;
  }
  return (
    <nav className="pdf-reader-outline" aria-label="Document outline">
      <OutlineList items={items} onNavigate={onNavigate} />
    </nav>
  );
}

function OutlineList({
  items,
  onNavigate,
}: {
  items: ReaderOutlineItem[];
  onNavigate: (pageNumber: number) => void;
}) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          {item.pageNumber != null ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => onNavigate(item.pageNumber!)}
            >
              {item.title}
            </button>
          ) : (
            <span>{item.title}</span>
          )}
          {item.items && item.items.length > 0 && (
            <OutlineList items={item.items} onNavigate={onNavigate} />
          )}
        </li>
      ))}
    </ul>
  );
}
