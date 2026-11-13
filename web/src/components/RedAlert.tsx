import React, { useEffect, useRef } from "react";

interface RedAlertProps {
  onDismiss: () => void;
  onDownloadPdf: () => void;
  matched?: string[];
}

export const RedAlert: React.FC<RedAlertProps> = ({
  onDismiss,
  onDownloadPdf,
  matched = [],
}) => {
  const dismissBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Remember previously focused element to return focus on close
    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;

    // Auto-focus Dismiss button on mount
    dismissBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // Return focus to previously focused element
      if (previouslyFocusedElementRef.current && typeof previouslyFocusedElementRef.current.focus === "function") {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, [onDismiss]);

  return (
    <div
      className="red-alert-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="red-alert-title"
      aria-describedby="red-alert-subtitle"
    >
      <div className="red-alert-card">
        {/* Pulsing Warning Icon */}
        <div className="red-alert-icon-wrap" aria-hidden="true">
          <div className="red-alert-pulse" />
          <div className="red-alert-icon-core">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        </div>

        <h1 id="red-alert-title" className="red-alert-title">
          There is no &quot;digital arrest&quot; in Indian law.
        </h1>

        <p id="red-alert-subtitle" className="red-alert-subtitle">
          Real police never arrest anyone on a video call or ask for money. Hang up now.
        </p>

        {matched && matched.length > 0 && (
          <div className="red-alert-we-heard">
            <span className="red-alert-we-heard-label">We heard:</span>
            <div className="red-alert-chips">
              {matched.map((phrase, idx) => (
                <span key={idx} className="red-alert-outline-chip">
                  &ldquo;{phrase}&rdquo;
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="red-alert-actions">
          <a
            href="tel:1930"
            className="red-alert-btn red-alert-btn-call"
            title="Immediately call National Cyber Crime Helpline 1930"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Call 1930
          </a>

          <button
            type="button"
            className="red-alert-btn red-alert-btn-pdf"
            onClick={onDownloadPdf}
            title="Download Cyber Crime Evidence PDF"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Download evidence PDF
          </button>

          <button
            type="button"
            ref={dismissBtnRef}
            className="red-alert-btn red-alert-btn-dismiss"
            onClick={onDismiss}
            title="Dismiss Alert"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
