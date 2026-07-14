import { useEffect, useState } from "react";
import { CalendarDays, MapPinned, Phone } from "lucide-react";
import { SITE } from "../data/siteContent";
import { track } from "../lib/analytics";
import { cn } from "../lib/utils";

export function FloatingActions({ onBook }: { onBook: () => void }) {
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setFooterVisible(entry.isIntersecting), { threshold: 0.03 });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={cn("fixed inset-x-3 bottom-3 z-40 grid grid-cols-3 rounded-2xl border border-white/15 bg-slate-950/88 p-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] text-white shadow-2xl backdrop-blur-xl transition md:hidden", footerVisible && "pointer-events-none translate-y-[140%] opacity-0")}>
      <a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "floating" })} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><Phone className="size-4" />Позвонить</a>
      <a href={SITE.yandexRouteUrl} target="_blank" rel="noreferrer" onClick={() => track("route_click", { placement: "floating" })} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><MapPinned className="size-4" />Маршрут</a>
      <button type="button" onClick={onBook} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl bg-white text-[11px] font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><CalendarDays className="size-4" />Заявка</button>
    </div>
  );
}
