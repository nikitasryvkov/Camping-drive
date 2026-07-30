import { ArrowUpRight, MapPin, Phone } from "lucide-react";
import { useSiteSettings } from "../SiteSettingsContext";
import { isExternalHref } from "../siteSettings";
import { Container } from "./ui/Container";

export function Footer() {
  const settings = useSiteSettings();
  return (
    <footer id="site-footer" className="bg-[#07191d] pb-24 pt-16 text-white md:pb-8">
      <Container>
        <div className="grid gap-12 border-b border-white/12 pb-14 lg:grid-cols-[1.35fr_2fr]">
          <div><span className="inline-flex rounded-2xl bg-white p-2"><img src={settings.logoUrl} alt={settings.logoAlt} className="h-14 w-auto" /></span><p className="mt-6 max-w-sm text-sm leading-7 text-white/58">{settings.footer.description}</p></div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {settings.footer.columns.map((column, columnIndex) => <div key={`${column.title}-${columnIndex}`}><h2 className="text-xs font-bold uppercase tracking-[.16em] text-white/45">{column.title}</h2><ul className="mt-5 space-y-3 text-sm">{column.links.map((link, index) => <li key={`${link.label}-${index}`}><a href={link.href} {...(isExternalHref(link.href) ? { target: "_blank", rel: "noreferrer" } : {})} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white hover:text-white/65">{link.label}</a></li>)}</ul></div>)}
          </div>
        </div>
        <div id="contacts" className="grid gap-7 border-b border-white/12 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {settings.phones.map((phone, index) => <a key={`${phone.href}-${index}`} href={phone.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">{phone.label}</span><span className="mt-2 flex items-center gap-2 font-semibold"><Phone className="size-4" />{phone.display}</span></a>)}
          <div><span className="block text-xs text-white/45">Адрес</span><span className="mt-2 flex items-center gap-2 font-semibold"><MapPin className="size-4" />{settings.address}</span></div>
          <a href={settings.routeUrl} target="_blank" rel="noreferrer" className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">Маршрут</span><span className="mt-2 flex items-center gap-2 font-semibold">Открыть карту<ArrowUpRight className="size-4" /></span></a>
          {settings.contactLinks.map((link, index) => <a key={`${link.href}-${index}`} href={link.href} {...(isExternalHref(link.href) ? { target: "_blank", rel: "noreferrer" } : {})} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">Ссылка</span><span className="mt-2 flex items-center gap-2 font-semibold">{link.label}<ArrowUpRight className="size-4" /></span></a>)}
        </div>
        <div className="flex flex-col gap-4 pt-7 text-xs text-white/42 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {settings.siteName}</p>
          <p>{settings.footer.legalText}</p>
        </div>
      </Container>
    </footer>
  );
}
