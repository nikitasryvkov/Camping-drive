import { ArrowDown, MapPinned, Star, Trees } from "lucide-react";
import { SITE } from "../data/siteContent";
import { track } from "../lib/analytics";
import { buttonStyles, Button } from "./ui/Button";
import { Container } from "./ui/Container";
import { ThemeToggle } from "./ThemeToggle";
import { VideoBackground } from "./VideoBackground";

export function Hero({ onBook }: { onBook: () => void }) {
  return (
    <section id="top" className="relative isolate flex min-h-dvh items-end overflow-hidden bg-[#081c22] pt-28 text-white">
      <VideoBackground />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,16,17,.76)_0%,rgba(3,16,17,.42)_46%,rgba(3,16,17,.08)_100%)]" aria-hidden="true" />
      <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(3,16,17,.82)_0%,transparent_56%,rgba(3,16,17,.28)_100%)]" aria-hidden="true" />
      <Container className="relative z-10 grid min-h-[calc(100dvh-7rem)] items-end gap-10 pb-10 pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:pb-14">
        <div className="max-w-4xl hero-enter">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/72">{SITE.locationLabel}</p>
          <h1 className="mt-5 max-w-[13ch] font-display text-[clamp(2.625rem,7vw,6.7rem)] leading-[0.98] tracking-[-0.025em]">
            <span className="text-white/58">Здесь заканчивается суета</span> и начинается отдых.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg sm:leading-8">
            30 гектаров леса и полей, река в десяти минутах пешком, палатки, домики, костры и активный отдых — недалеко от Москвы.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button onClick={onBook} className="bg-white text-slate-950 hover:bg-white/88" arrow>Выбрать формат отдыха</Button>
            <a href={SITE.yandexRouteUrl} target="_blank" rel="noreferrer" onClick={() => track("route_click", { placement: "hero" })} className={buttonStyles("light")}>Построить маршрут <MapPinned className="size-4" aria-hidden="true" /></a>
          </div>
          <div className="mt-7 flex max-w-2xl flex-wrap gap-x-5 gap-y-3 text-xs font-semibold text-white/74 sm:text-sm">
            <span className="inline-flex items-center gap-2"><Star className="size-4 text-amber-300" fill="currentColor" aria-hidden="true" />5.0 на Яндекс Картах</span>
            <span className="inline-flex items-center gap-2"><Trees className="size-4 text-emerald-300" aria-hidden="true" />30 гектаров территории</span>
            <span className="inline-flex items-center gap-2"><MapPinned className="size-4 text-sky-300" aria-hidden="true" />Река в 10 минутах</span>
          </div>
        </div>
        <div className="flex items-end justify-between gap-6 lg:flex-col lg:justify-end">
          <ThemeToggle />
          <a href="#intro" className="flex size-12 items-center justify-center rounded-full border border-white/25 bg-black/15 backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Прокрутить к содержанию"><ArrowDown className="size-5" aria-hidden="true" /></a>
        </div>
      </Container>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 translate-y-1/2 bg-gradient-to-b from-transparent to-background" aria-hidden="true" />
    </section>
  );
}
