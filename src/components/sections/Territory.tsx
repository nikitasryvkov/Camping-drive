import { Check, Footprints, MapPin, Trees } from "lucide-react";
import { TERRITORY_BENEFITS } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";

export function Territory() {
  return (
    <section id="territory" className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow="30 гектаров пространства" title="Ближе к общему огню или дальше от всех." copy="Территория вытянута примерно на километр. Можно расположиться ближе к общей инфраструктуре или выбрать более удаленное место, где почти не слышно других гостей." /></Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-12 lg:grid-rows-[auto_auto]">
          <Reveal className="relative min-h-[520px] overflow-hidden rounded-4xl lg:col-span-7 lg:row-span-2">
            <img src="/media/territory-main.webp" alt="Просторное поле и леса рядом с Кемпинг Драйв" loading="lazy" className="absolute inset-0 size-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/62 via-transparent to-transparent" />
            <div className="absolute bottom-7 left-7 text-white"><strong className="font-display text-7xl sm:text-8xl">30</strong><span className="ml-2 text-2xl">га</span><p className="mt-1 text-sm text-white/72">примерно 300 × 1 000 метров</p></div>
          </Reveal>
          <Reveal className="relative overflow-hidden rounded-4xl border border-border bg-surface p-7 lg:col-span-5">
            <p className="eyebrow">Схема без масштаба</p>
            <div className="territory-map relative mt-6 h-64 rounded-3xl border border-border bg-background">
              <span className="absolute left-[12%] top-[18%] flex items-center gap-2 text-xs font-semibold"><MapPin className="size-4 text-fire" />Въезд</span>
              <span className="absolute left-[38%] top-[42%] flex items-center gap-2 text-xs font-semibold"><Trees className="size-4 text-forest" />Палаточные зоны</span>
              <span className="absolute bottom-[14%] right-[9%] flex items-center gap-2 text-xs font-semibold"><Footprints className="size-4 text-accent" />К реке</span>
              <span className="absolute bottom-[22%] left-[12%] rounded-full border border-border bg-surface px-3 py-2 text-[11px] font-semibold">Дальняя зона</span>
            </div>
          </Reveal>
          <Reveal className="rounded-4xl border border-border bg-surface-strong p-7 lg:col-span-5">
            <ul className="grid gap-3 text-sm leading-6">
              {TERRITORY_BENEFITS.map((item) => <li key={item} className="flex gap-3"><Check className="mt-1 size-4 shrink-0 text-forest" aria-hidden="true" /><span>{item}</span></li>)}
            </ul>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
