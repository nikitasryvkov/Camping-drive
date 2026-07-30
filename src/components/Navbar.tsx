import { useEffect, useState } from "react";
import { Menu, Phone } from "lucide-react";
import { useSiteSettings } from "../SiteSettingsContext";
import { cn } from "../lib/utils";
import { Container } from "./ui/Container";
import { buttonStyles } from "./ui/Button";
import { MobileMenu } from "./MobileMenu";

export function Navbar({ overlayAtTop = true }: { overlayAtTop?: boolean }) {
  const [compact, setCompact] = useState(!overlayAtTop);
  const [menuOpen, setMenuOpen] = useState(false);
  const settings = useSiteSettings();
  const primaryPhone = settings.phones[0];

  useEffect(() => {
    const onScroll = () => setCompact(!overlayAtTop || window.scrollY > Math.max(100, window.innerHeight * 0.72));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overlayAtTop]);

  return (
    <>
      <header className={cn("fixed inset-x-0 top-0 z-50 transition-all duration-300", compact ? "border-b border-border bg-background/85 py-2 text-foreground shadow-sm backdrop-blur-xl" : "py-4 text-white")}>
        <Container className="flex h-14 items-center justify-between gap-4">
          <a href="/#top" className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label={`${settings.siteName} — на главную`}>
            <span className="rounded-xl bg-white/92 p-1.5 shadow-sm"><img src={settings.logoUrl} alt="" className="h-9 w-auto sm:h-10" /></span>
            <span className={cn("hidden max-w-40 truncate text-sm font-semibold xl:block", compact ? "text-muted" : "text-white/75")}>{settings.locationLabel}</span>
          </a>

          <nav className="hidden lg:block" aria-label="Основная навигация">
            <ul className="flex items-center gap-1">
              {settings.menu.map((item, index) => (
                <li key={`${item.href}-${index}`}><a href={item.href} className={cn("rounded-full px-3 py-2 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:px-4", compact ? "hover:bg-surface" : "text-white/84 hover:bg-white/10 hover:text-white")}>{item.label}</a></li>
              ))}
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            {primaryPhone ? <a href={primaryPhone.href} className={cn("hidden rounded-full px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent xl:block", !compact && "text-white")}>{primaryPhone.display}</a> : null}
            {primaryPhone ? <a href={primaryPhone.href} className={cn(buttonStyles(compact ? "primary" : "light"), "hidden lg:inline-flex")}>Позвонить</a> : null}
            {primaryPhone ? <a href={primaryPhone.href} className={cn("flex size-11 items-center justify-center rounded-full border lg:hidden", compact ? "border-border bg-surface" : "border-white/25 bg-black/15 backdrop-blur-md")} aria-label={`Позвонить ${primaryPhone.display}`}><Phone className="size-5" aria-hidden="true" /></a> : null}
            <button type="button" onClick={() => setMenuOpen(true)} className={cn("flex size-11 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:hidden", compact ? "border-border bg-surface" : "border-white/25 bg-black/15 backdrop-blur-md")} aria-label="Открыть меню"><Menu className="size-5" aria-hidden="true" /></button>
          </div>
        </Container>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
