import { type LucideIcon } from "lucide-react";

export function IconBadge({ icon: Icon, label }: { icon: LucideIcon; label?: string }) {
  return (
    <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-surface text-forest" aria-label={label}>
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}
