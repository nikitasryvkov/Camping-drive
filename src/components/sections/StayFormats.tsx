import { ArrowUpRight, Check } from "lucide-react";
import { STAY_FORMATS, SITE } from "../../data/siteContent";
import { useTheme } from "../../theme/ThemeContext";
import { track } from "../../lib/analytics";
import { Container } from "../ui/Container";
import { SectionHeading } from "../SectionHeading";
import { Reveal } from "../Reveal";

export function StayFormats({ onBook }: { onBook: (format: string) => void }) {
  const { theme } = useTheme();
  return (
    <section id="stay" className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow="Как хотите отдохнуть?" title="Выберите свой уровень свободы и комфорта." copy="Можно приехать налегке, поставить свою палатку или остановиться в домике — территория позволяет не мешать друг другу." /></Reveal>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:mt-16">
          {STAY_FORMATS.map((item, index) => (
            <Reveal key={item.title} className="h-full" style={{ transitionDelay: `${index * 70}ms` }}>
              <article className="group relative isolate min-h-[560px] overflow-hidden rounded-4xl border border-white/15 bg-slate-900 text-white shadow-soft md:aspect-[4/5] md:min-h-0 lg:aspect-[5/4] xl:aspect-[4/3]">
                <img src={item.dayImage} alt="" loading="lazy" className={`absolute inset-0 size-full object-cover transition duration-[1400ms] group-hover:scale-[1.06] ${theme === "day" ? "opacity-100" : "opacity-0"}`} />
                <img src={item.nightImage} alt="" loading="lazy" className={`absolute inset-0 size-full object-cover transition duration-[1400ms] group-hover:scale-[1.06] ${theme === "night" ? "opacity-100" : "opacity-0"}`} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/48 to-black/5" aria-hidden="true" />
                <div className="relative z-10 flex h-full flex-col justify-end p-6 sm:p-8">
                  <p className="text-xs font-bold uppercase tracking-[.18em] text-white/65">{item.label}</p>
                  <h3 className="mt-3 max-w-xl font-display text-3xl leading-tight sm:text-4xl">{item.title}</h3>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-white/76 sm:text-base">{item.description}</p>
                  <ul className="mt-5 grid gap-2 text-sm text-white/82 sm:grid-cols-2">
                    {item.bullets.map((bullet) => <li key={bullet} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-300" aria-hidden="true" />{bullet}</li>)}
                  </ul>
                  <span className="mt-6 inline-flex items-center gap-2 font-semibold">{item.cta}<ArrowUpRight className="size-4 transition-transform group-hover:rotate-45" aria-hidden="true" /></span>
                </div>
                {item.external ? (
                  <a href={SITE.glampingUrl} target="_blank" rel="noreferrer" className="absolute inset-0 z-20 rounded-4xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white" aria-label={`${item.cta}: ${item.title}`} onClick={() => track("glamping_click")} />
                ) : (
                  <button type="button" className="absolute inset-0 z-20 rounded-4xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white" aria-label={`${item.cta}: ${item.title}`} onClick={() => onBook(item.format)} />
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
