import { useState } from "react";
import { AlertCircle, Info, TriangleAlert, X } from "lucide-react";
import { SITE } from "../data/siteContent";
import { Container } from "./ui/Container";
import { cn } from "../lib/utils";

export function OperationalAlert() {
  const [dismissed, setDismissed] = useState(false);
  const alert = SITE.alert;
  if (!alert.active || dismissed) return null;

  const Icon = alert.level === "info" ? Info : alert.level === "warning" ? TriangleAlert : AlertCircle;
  return (
    <section aria-label="Оперативная информация" className="py-5">
      <Container>
        <div
          className={cn(
            "flex items-start gap-4 rounded-3xl border p-5",
            alert.level === "info" && "border-sky-400/30 bg-sky-400/10",
            alert.level === "warning" && "border-amber-400/35 bg-amber-400/10",
            alert.level === "critical" && "border-red-500/35 bg-red-500/10",
          )}
        >
          <Icon className="mt-1 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">{alert.title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{alert.text}</p>
            {(alert.validFrom || alert.validUntil) && (
              <p className="mt-2 text-xs text-muted">Действует: {alert.validFrom ?? "—"} — {alert.validUntil ?? "до отмены"}</p>
            )}
          </div>
          {alert.level !== "critical" && (
            <button type="button" className="rounded-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" onClick={() => setDismissed(true)} aria-label="Закрыть уведомление">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </Container>
    </section>
  );
}
