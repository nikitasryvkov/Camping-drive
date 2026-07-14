import { useEffect, useState } from "react";
import { Menu, Phone } from "lucide-react";
import { NAV_ITEMS, SITE } from "../data/siteContent";
import { cn } from "../lib/utils";
import { track } from "../lib/analytics";
import { Container } from "./ui/Container";
import { Button } from "./ui/Button";
import { MobileMenu } from "./MobileMenu";

export function Navbar({ onBook }: { onBook: () => void }) {
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > Math.max(100, window.innerHeight * 0.72));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-50 transition-all duration-300", compact ? "border-b border-border bg-background/85 py-2 text-foreground shadow-sm backdrop-blur-xl" : "py-4 text-white")}>
        <Container className="flex h-14 items-center justify-between gap-4">
          <a href="#top" className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Кемпинг Драйв — на главную">
            <span className="rounded-xl bg-white/92 p-1.5 shadow-sm"><img src="/logo-kemping-drive.png" alt="" className="h-9 w-auto sm:h-10" /></span>
            <span className={cn("hidden text-sm font-semibold xl:block", compact ? "text-muted" : "text-white/75")}>Киржач</span>
          </a>

          <nav className="hidden lg:block" aria-label="Основная навигация">
            <ul className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}><a href={item.href} className={cn("rounded-full px-3 py-2 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:px-4", compact ? "hover:bg-surface" : "text-white/84 hover:bg-white/10 hover:text-white")}>{item.label}</a></li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "navbar" })} className={cn("hidden rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:block", !compact && "text-white")}>{SITE.phoneDisplay}</a>
            <Button onClick={onBook} variant={compact ? "primary" : "light"} className="hidden lg:inline-flex">Выбрать отдых</Button>
            <a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "navbar_mobile" })} className={cn("flex size-11 items-center justify-center rounded-full border lg:hidden", compact ? "border-border bg-surface" : "border-white/25 bg-black/15 backdrop-blur-md")} aria-label={`Позвонить ${SITE.phoneDisplay}`}><Phone className="size-5" aria-hidden="true" /></a>
            <button type="button" onClick={() => setMenuOpen(true)} className={cn("flex size-11 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden", compact ? "border-border bg-surface" : "border-white/25 bg-black/15 backdrop-blur-md")} aria-label="Открыть меню"><Menu className="size-5" aria-hidden="true" /></button>
          </div>
        </Container>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} onBook={onBook} />
    </>
  );
}
