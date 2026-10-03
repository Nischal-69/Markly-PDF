import { Icon } from "@/components/icons/Icon";
import { usePdfStore } from "@/state/pdfStore";

export function ErrorBanner() {
  const error = usePdfStore((s) => s.error);
  const errorDetails = usePdfStore((s) => s.errorDetails);
  const dismissError = usePdfStore((s) => s.dismissError);

  if (!error) return null;

  return (
    <div className="error-banner" role="alert">
      <Icon name="alert" size={16} />
      <div className="error-text">
        <span>{error}</span>
        {errorDetails && (
          <details className="error-details">
            <summary>Technical details</summary>
            <code>{errorDetails}</code>
          </details>
        )}
      </div>
      <button
        type="button"
        className="btn btn-icon btn-quiet"
        onClick={dismissError}
        title="Dismiss"
        aria-label="Dismiss error"
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
