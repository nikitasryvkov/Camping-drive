import { MapPinned, Phone } from "lucide-react";
import { SITE } from "../../data/siteContent";
import { track } from "../../lib/analytics";
import { useTheme } from "../../theme/ThemeContext";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { Button, buttonStyles } from "../ui/Button";

export function FinalCta({ onBook }: { onBook: () => void }) {
  const { theme } = useTheme();
  return (
    <section className="relative isolate overflow-hidden py-24 text-white sm:py-32">
      <img src={theme === "day" ? "/media/final-day.webp" : "/media/final-night.webp"} alt="" loading="lazy" className="absolute inset-0 -z-20 size-full object-cover transition-opacity duration-500" />
      <div className="absolute inset-0 -z-10 bg-slate-950/62" />
      <Container>
        <Reveal className="max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-white/65">Пора выбраться из города</p>
          <h2 className="mt-5 font-display text-4xl leading-[1.08] sm:text-6xl lg:text-7xl">Один свободный вечер может стать целыми выходными на природе.</h2>
          <p className="mt-6 max-w-2xl text-base leading-8 text-white/74 sm:text-lg">Расскажите, как хотите отдохнуть, — со своей палаткой, в домике или с активным маршрутом. Мы поможем разобраться с деталями.</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Button onClick={onBook} className="bg-white text-slate-950 hover:bg-white/88" arrow>Оставить заявку</Button>
            <a href={SITE.phoneHref} className={buttonStyles("light")} onClick={() => track("phone_click", { placement: "final_cta" })}><Phone className="size-4" />Позвонить</a>
            <a href={SITE.yandexRouteUrl} target="_blank" rel="noreferrer" className={buttonStyles("light")} onClick={() => track("route_click", { placement: "final_cta" })}><MapPinned className="size-4" />Построить маршрут</a>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
