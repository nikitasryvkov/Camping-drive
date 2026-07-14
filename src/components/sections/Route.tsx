import { useEffect, useRef, useState } from "react";
import { MapPinned, Phone } from "lucide-react";
import { ROUTE_OPTIONS, SITE } from "../../data/siteContent";
import { track } from "../../lib/analytics";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";
import { buttonStyles } from "../ui/Button";

export function Route() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loadMap, setLoadMap] = useState(false);

  useEffect(() => {
    const target = mapRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setLoadMap(true), { rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="route" className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow="Как добраться" title="Последний поворот — и город остается позади." /></Reveal>
        <div className="mt-12 grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[.9fr_1.1fr] lg:gap-12">
          <div className="min-w-0 divide-y divide-border border-y border-border">
            {ROUTE_OPTIONS.map((option) => <Reveal key={option.title} className="py-6"><h3 className="font-display text-2xl">{option.title}</h3><p className="mt-3 text-sm leading-7 text-muted">{option.text}</p></Reveal>)}
          </div>
          <Reveal>
            <div ref={mapRef} className="min-w-0 overflow-hidden rounded-4xl border border-border bg-surface shadow-soft">
              <div className="relative aspect-[4/3] min-h-[360px]">
                {loadMap ? (
                  <iframe title="Кемпинг Драйв на Яндекс Картах" loading="lazy" src="https://yandex.ru/map-widget/v1/?ll=38.980568%2C55.988505&z=13&pt=38.980568,55.988505,pm2rdm" className="absolute inset-0 size-full border-0" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_center,hsl(var(--accent)/.18),transparent_58%)] text-center"><MapPinned className="size-9 text-accent" aria-hidden="true" /><p className="font-semibold">55.988505, 38.980568</p><span className="text-sm text-muted">Карта загрузится при прокрутке</span></div>
                )}
              </div>
              <div className="grid gap-3 p-5 sm:grid-cols-2">
                <a href={SITE.yandexRouteUrl} target="_blank" rel="noreferrer" onClick={() => track("route_click", { placement: "route" })} className={buttonStyles("primary", "min-w-0 whitespace-normal px-3 text-center")}>Открыть маршрут</a>
                <a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "route" })} className={buttonStyles("secondary", "min-w-0 whitespace-normal px-3 text-center")}><Phone className="size-4 shrink-0" aria-hidden="true" />Позвонить перед выездом</a>
              </div>
            </div>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
