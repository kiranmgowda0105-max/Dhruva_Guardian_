import React from "react";

interface RedAlertProps {
  onDismiss: () => void;
  onDownloadPdf: () => void;
}

export const RedAlert: React.FC<RedAlertProps> = ({ onDismiss, onDownloadPdf }) => {
  return (
    <div className="red-alert-overlay" role="alertdialog" aria-modal="true">
      <div className="red-alert-content">
        <div className="red-alert-icon">⚠️</div>
        <h1 className="red-alert-title">Real police never do this. Hang up.</h1>
        <p className="red-alert-desc">
          High scam likelihood detected. Real law enforcement, banks, or officials will never
          demand money transfers or digital arrests over a call.
        </p>

        <div className="red-alert-actions">
          <a href="tel:1930" className="btn-call-1930" title="Directly dial Cyber Crime Helpline 1930">
            📞 Call 1930
          </a>
          <button
            type="button"
            className="btn-download-pdf"
            onClick={onDownloadPdf}
            title="Download PDF evidence pack"
          >
            📄 Download Evidence PDF
          </button>
        </div>

        <button
          type="button"
          className="red-alert-dismiss-btn"
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
};
