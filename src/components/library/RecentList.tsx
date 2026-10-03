import { Icon } from "@/components/icons/Icon";
import type { RecentFile } from "@/lib/storage/recentFiles";

interface RecentListProps {
  entries: RecentFile[];
  onOpen: (entry: RecentFile) => void;
  onRemove: (id: string) => void;
  onClear: (() => void) | null;
  compact?: boolean;
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecentList({ entries, onOpen, onRemove, onClear, compact }: RecentListProps) {
  if (entries.length === 0) {
    return (
      <div className="recent-empty">
        <Icon name="recent" size={28} />
        <p>No recently opened PDFs yet.</p>
        <p className="muted">Open a PDF and it will appear here.</p>
      </div>
    );
  }

  return (
    <div className={`recent-list${compact ? " is-compact" : ""}`}>
      <div className="recent-head">
        <h2>{compact ? "Recent" : "Recently opened"}</h2>
        {onClear && entries.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={onClear} title="Clear recent files">
            <Icon name="trash" size={14} />
            <span>Clear</span>
          </button>
        )}
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className="recent-row">
            <button
              type="button"
              className="recent-main"
              onClick={() => onOpen(entry)}
              title={entry.path || entry.name}
            >
              <span className="recent-icon" aria-hidden="true">
                <Icon name="file" size={18} />
              </span>
              <span className="recent-text">
                <span className="recent-name">{entry.name}</span>
                <span className="recent-meta">
                  {formatDate(entry.lastOpenedAt)}
                  {entry.numPages ? ` · ${entry.numPages} pages` : ""}
                  {entry.size ? ` · ${formatSize(entry.size)}` : ""}
                </span>
              </span>
            </button>
            <button
              type="button"
              className="btn btn-icon btn-quiet"
              onClick={() => onRemove(entry.id)}
              title={`Remove ${entry.name} from recent`}
              aria-label={`Remove ${entry.name} from recent`}
            >
              <Icon name="close" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
