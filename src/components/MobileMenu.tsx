import { useEffect, useRef } from "react";
import { ArrowUpRight, X } from "lucide-react";
import { NAV_ITEMS, SITE } from "../data/siteContent";
import { track } from "../lib/analytics";
import { buttonStyles } from "./ui/Button";

export function MobileMenu({ open, onClose, onBook }: { open: boolean; onClose: () => void; onBook: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
    focusable?.[0]?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-sm md:hidden" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Меню" className="ml-auto flex min-h-dvh w-[min(92vw,420px)] flex-col bg-background p-6 text-foreground shadow-2xl">
        <div className="flex items-center justify-between">
          <img src="/logo-kemping-drive.png" alt="Кемпинг Драйв" className="h-12 w-auto rounded-xl bg-white/90 p-1" />
          <button type="button" onClick={onClose} className="flex size-11 items-center justify-center rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Закрыть меню">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <nav className="my-auto py-12" aria-label="Мобильная навигация">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item, index) => (
              <li key={item.href}>
                <a href={item.href} onClick={onClose} className="group flex min-h-14 items-center justify-between border-b border-border py-3 font-display text-2xl focus-visible:outline-none focus-visible:text-accent">
                  <span><span className="mr-3 font-body text-xs text-muted">0{index + 1}</span>{item.label}</span>
                  <ArrowUpRight className="size-5 transition-transform group-hover:rotate-45" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-3">
          <button type="button" className={buttonStyles("primary", "w-full")} onClick={() => { onBook(); onClose(); }}>Выбрать отдых</button>
          <a href={SITE.phoneHref} className={buttonStyles("secondary", "w-full")} onClick={() => track("phone_click", { placement: "mobile_menu" })}>{SITE.phoneDisplay}</a>
        </div>
      </div>
    </div>
  );
}
