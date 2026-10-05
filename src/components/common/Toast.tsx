import { useEffect } from "react";
import { Icon } from "@/components/icons/Icon";
import { usePdfStore } from "@/state/pdfStore";

const NOTICE_DURATION_MS = 3500;

/** Small transient toast for non-blocking hints (e.g. placeholders). */
export function Toast() {
  const notice = usePdfStore((s) => s.notice);
  const dismissNotice = usePdfStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismissNotice, NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [notice, dismissNotice]);

  if (!notice) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{notice}</span>
      <button
        type="button"
        className="toast-close"
        onClick={dismissNotice}
        title="Dismiss notification"
        aria-label="Dismiss notification"
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
