import { ArrowUpRight } from "lucide-react";
import { ACTIVITIES } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { SectionHeading } from "../SectionHeading";
import { Reveal } from "../Reveal";
import { Button } from "../ui/Button";

export function Activities({ onBook }: { onBook: (format: string) => void }) {
  return (
    <section id="activities" className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow="Чем заняться" title="Выберите темп: от спокойного вечера до маршрута по реке." /></Reveal>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ACTIVITIES.map((item, index) => (
            <Reveal key={item.title} className="h-full" style={{ transitionDelay: `${index * 55}ms` }}>
              <article className="group flex h-full min-h-[420px] flex-col overflow-hidden rounded-4xl border border-border bg-background">
                <div className="aspect-[4/3] overflow-hidden"><img src={item.image} alt={item.imageAlt} loading="lazy" className="size-full object-cover transition duration-[1400ms] group-hover:scale-[1.06]" /></div>
                <div className="flex flex-1 flex-col p-6">
                  <span className="text-xs font-bold text-muted">0{index + 1}</span>
                  <h3 className="mt-3 font-display text-2xl leading-tight">{item.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted">{item.description}</p>
                  <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold">По предварительному согласованию<ArrowUpRight className="size-4" aria-hidden="true" /></span>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-10"><Button onClick={() => onBook("Активности")} arrow>Уточнить доступность активностей</Button></Reveal>
      </Container>
    </section>
  );
}
