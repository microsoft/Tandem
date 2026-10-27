import type { ReactNode } from "react";
import { History, X } from "lucide-react";
import { IconButton } from "./ui/index.js";

export function FeedbackHistoryButton({ id, target, open, error = false, errorLabel, onToggle }: {
  id: string; target: string; open: boolean; error?: boolean; errorLabel?: string; onToggle(): void;
}) {
  return <IconButton id={id} className="feedback-history-toggle"
    data-status={error ? "error" : "idle"}
    aria-label={error ? errorLabel || "Open request history and errors" : "Open request history"}
    title={error ? "Request failed. Open request history." : "Request history"}
    aria-expanded={open} aria-controls={target} onClick={onToggle} onKeyDown={event => {
      if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onToggle(); }
    }}>
    <History size={17} aria-hidden="true" />
  </IconButton>;
}

export function FeedbackHistory({ id, triggerId, label, open, onClose, children, inline = false }: {
  id: string; triggerId: string; label: string; open: boolean; onClose(): void; children: ReactNode; inline?: boolean;
}) {
  const close = () => {
    onClose();
    document.getElementById(triggerId)?.focus({ preventScroll: true });
  };
  return <section id={id} className={`feedback-history-pane${inline ? " feedback-history-inline" : ""}`}
    role="region" aria-label={label} hidden={!open} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    <div className="feedback-history-heading">
      <h3>Request history</h3>
      <IconButton aria-label="Close request history" onClick={close}><X size={14} aria-hidden="true" /></IconButton>
    </div>
    {children}
  </section>;
}
