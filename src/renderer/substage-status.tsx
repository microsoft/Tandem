import { Check, CircleAlert, CircleDashed, CircleDot, CircleEllipsis, CircleX, Clock, Eye, LoaderCircle, LockKeyhole, SkipForward } from "lucide-react";

const statusIcons = {
  active: CircleDot,
  ready: Check,
  running: LoaderCircle,
  attention: CircleAlert,
  failed: CircleX,
  optional: CircleDashed,
  waiting: Clock,
  skipped: SkipForward,
  inspect: Eye,
  partial: CircleEllipsis,
  locked: LockKeyhole,
};

export type SubstageStatus = keyof typeof statusIcons;

export function SubstageStatusIcon({ status, label }: { status: SubstageStatus; label: string }) {
  const Icon = statusIcons[status];
  return <span className="substage-status" data-status={status} role="img" aria-label={label} title={label}>
    <Icon size={14} aria-hidden="true" className={status === "running" ? "spin" : undefined} />
  </span>;
}
