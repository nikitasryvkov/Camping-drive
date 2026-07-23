import { useEffect, useState } from "react";
import { Link, MapPinned, MessageCircle, Phone, UsersRound } from "lucide-react";
import { useSiteSettings } from "../SiteSettingsContext";
import { isExternalHref, resolveFloatingActionHref, type FloatingAction } from "../siteSettings";
import { cn } from "../lib/utils";

export function FloatingActions() {
  const [footerVisible, setFooterVisible] = useState(false);
  const settings = useSiteSettings();
  const actions = settings.floatingActions.filter((action) => action.enabled);
  useEffect(() => {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    const observer = new IntersectionObserver(([entry]) => setFooterVisible(entry.isIntersecting), { threshold: 0.03 });
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  if (actions.length === 0) return null;

  return (
    <div style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }} className={cn("fixed inset-x-3 bottom-3 z-40 grid rounded-2xl border border-white/15 bg-slate-950/88 p-1.5 pb-[calc(.375rem+env(safe-area-inset-bottom))] text-white shadow-2xl backdrop-blur-xl transition md:hidden", footerVisible && "pointer-events-none translate-y-[140%] opacity-0")}>
      {actions.map((action, index) => {
        const href = resolveFloatingActionHref(action, settings);
        const Icon = actionIcon(action);
        return <a key={`${action.label}-${index}`} href={href} {...(isExternalHref(href) ? { target: "_blank", rel: "noreferrer" } : {})} className={cn("flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white", action.highlighted && "bg-white text-slate-950")}><Icon className="size-4" /><span className="max-w-full truncate">{action.label}</span></a>;
      })}
    </div>
  );
}

function actionIcon(action: FloatingAction) {
  if (action.icon === "phone") return Phone;
  if (action.icon === "route") return MapPinned;
  if (action.icon === "contacts") return UsersRound;
  if (action.icon === "message") return MessageCircle;
  return Link;
}
