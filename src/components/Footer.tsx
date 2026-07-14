import { ArrowUpRight, MapPin, Phone } from "lucide-react";
import { SITE } from "../data/siteContent";
import { track } from "../lib/analytics";
import { Container } from "./ui/Container";

const columns = [
  { title: "Отдых", links: [{ label: "Своя палатка", href: "#stay" }, { label: "Домики", href: "#stay" }, { label: "С детьми", href: "#stay" }, { label: "С питомцами", href: "#stay" }] },
  { title: "Активности", links: [{ label: "Байдарки", href: "#activities" }, { label: "SUP", href: "#activities" }, { label: "Квадроциклы", href: "#activities" }, { label: "Баня и чан", href: "#activities" }] },
  { title: "Информация", links: [{ label: "Как добраться", href: "#route" }, { label: "Правила", href: "#rules" }, { label: "Отзывы", href: "#reviews" }, { label: "Контакты", href: "#contacts" }] },
] as const;

export function Footer() {
  return (
    <footer id="site-footer" className="bg-[#07191d] pb-24 pt-16 text-white md:pb-8">
      <Container>
        <div className="grid gap-12 border-b border-white/12 pb-14 lg:grid-cols-[1.35fr_2fr]">
          <div><span className="inline-flex rounded-2xl bg-white p-2"><img src="/logo-kemping-drive.png" alt="Кемпинг Драйв" className="h-14 w-auto" /></span><p className="mt-6 max-w-sm text-sm leading-7 text-white/58">Живой кемпинг в Киржаче: палатки, домики, костры, река и 30 гектаров пространства.</p></div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => <div key={column.title}><h2 className="text-xs font-bold uppercase tracking-[.16em] text-white/45">{column.title}</h2><ul className="mt-5 space-y-3 text-sm">{column.links.map((link) => <li key={link.label}><a href={link.href} className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white hover:text-white/65">{link.label}</a></li>)}</ul></div>)}
          </div>
        </div>
        <div id="contacts" className="grid gap-7 border-b border-white/12 py-10 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "footer", phone: "main" })} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">Основной телефон</span><span className="mt-2 flex items-center gap-2 font-semibold"><Phone className="size-4" />{SITE.phoneDisplay}</span></a>
          <a href={SITE.emergencyPhoneHref} onClick={() => track("phone_click", { placement: "footer", phone: "emergency" })} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">Экстренная связь</span><span className="mt-2 flex items-center gap-2 font-semibold"><Phone className="size-4" />{SITE.emergencyPhoneDisplay}</span></a>
          <div><span className="block text-xs text-white/45">Место</span><span className="mt-2 flex items-center gap-2 font-semibold"><MapPin className="size-4" />Киржач, Владимирская область</span></div>
          <a href={SITE.yandexRouteUrl} target="_blank" rel="noreferrer" onClick={() => track("route_click", { placement: "footer" })} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="block text-xs text-white/45">Координаты</span><span className="mt-2 flex items-center gap-2 font-semibold">55.988505, 38.980568<ArrowUpRight className="size-4" /></span></a>
        </div>
        <div className="flex flex-col gap-4 pt-7 text-xs text-white/42 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {SITE.name}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2"><a id="privacy" href="#privacy" className="hover:text-white">Политика конфиденциальности</a><a href="#privacy" className="hover:text-white">Согласие на обработку персональных данных</a></div>
        </div>
      </Container>
    </footer>
  );
}
