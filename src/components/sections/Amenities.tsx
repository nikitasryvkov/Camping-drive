import { Bath, Bike, Car, Droplets, Flame, GlassWater, Map, ShowerHead, Soup, TentTree, Trees, UsersRound, Utensils, Wifi, Wrench, Armchair } from "lucide-react";
import { AMENITIES } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";

const icons = [Wifi, UsersRound, ShowerHead, Bath, Droplets, GlassWater, Armchair, Flame, Utensils, Car, TentTree, Soup, Bath, Flame, Wrench, Map, Bike, Trees];

export function Amenities() {
  return (
    <section className="section-space bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow="Что есть на месте" title="Бытовые вещи продуманы. Природа остается дикой." /></Reveal>
        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {AMENITIES.map((item, index) => {
            const Icon = icons[index % icons.length];
            return <Reveal key={item} className="h-full" style={{ transitionDelay: `${(index % 4) * 40}ms` }}><div className="flex h-full min-h-32 flex-col justify-between rounded-3xl border border-border bg-background p-5"><Icon className="size-5 text-forest" aria-hidden="true" /><p className="mt-6 text-sm font-semibold leading-5">{item}</p></div></Reveal>;
          })}
        </div>
        <Reveal className="mt-6 rounded-3xl border border-fire/25 bg-fire/10 p-5 text-sm leading-6 sm:text-base">Перед поездкой возьмите теплую одежду на вечер, зарядку для телефона и эффективное средство от насекомых.</Reveal>
      </Container>
    </section>
  );
}
