import { STATS } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";

export function Stats() {
  return (
    <section className="border-y border-border bg-foreground py-10 text-background sm:py-14">
      <Container className="grid grid-cols-2 gap-px lg:grid-cols-4">
        {STATS.map((stat) => <Reveal key={stat.label} className="border-background/15 p-4 odd:border-r lg:border-r lg:last:border-r-0 sm:p-7"><strong className="block font-display text-4xl sm:text-5xl lg:text-6xl">{stat.value}</strong><span className="mt-2 block text-xs font-semibold uppercase tracking-[.14em] opacity-65 sm:text-sm">{stat.label}</span></Reveal>)}
      </Container>
    </section>
  );
}
