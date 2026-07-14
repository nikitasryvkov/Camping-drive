import { Bath, Bike, Car, Droplets, Flame, GlassWater, Map, ShowerHead, Soup, TentTree, Trees, UsersRound, Utensils, Wifi, Wrench, Armchair } from "lucide-react";
import { AMENITIES } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";

const icons = [Wifi, UsersRound, ShowerHead, Bath, Droplets, GlassWater, Armchair, Flame, Utensils, Car, TentTree, Soup, Bath, Flame, Wrench, Map, Bike, Trees];

const amenityImages = [
  "/media/stay-glamping-day.webp",
  "/media/gallery-06-640.webp",
  "/media/activity-sup.webp",
  "/media/activity-bath.webp",
  "/media/gallery-03-640.webp",
  "/media/activity-kayak.webp",
  "/media/gallery-08-640.webp",
  "/media/activity-campfire.webp",
  "/media/stay-own-tent-day.webp",
  "/media/gallery-07-640.webp",
  "/media/territory-main.webp",
  "/media/gallery-08-640.webp",
  "/media/activity-bath.webp",
  "/media/activity-bath.webp",
  "/media/activity-quad.webp",
  "/media/final-day.webp",
] as const;

export function Amenities() {
  return (
    <section className="section-space bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow="Что есть на месте" title="Бытовые вещи продуманы. Природа остается дикой." /></Reveal>
        <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {AMENITIES.map((item, index) => {
            const Icon = icons[index % icons.length];
            const image = amenityImages[index % amenityImages.length];
            return (
              <Reveal key={item} className="h-full" style={{ transitionDelay: `${(index % 4) * 40}ms` }}>
                <div className="group flex h-full min-h-48 flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-soft">
                  <div className="relative h-24 shrink-0 overflow-hidden sm:h-28">
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 motion-reduce:transition-none group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/25 to-transparent" aria-hidden="true" />
                  </div>
                  <div className="relative flex flex-1 items-end p-4 pt-8 sm:p-5 sm:pt-9">
                    <span className="absolute -top-5 left-4 flex size-10 items-center justify-center rounded-full border border-border bg-surface text-forest shadow-soft sm:left-5">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <p className="text-xs font-semibold leading-5 sm:text-sm">{item}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="mt-6 rounded-3xl border border-fire/25 bg-fire/10 p-5 text-sm leading-6 sm:text-base">Перед поездкой возьмите теплую одежду на вечер, зарядку для телефона и эффективное средство от насекомых.</Reveal>
      </Container>
    </section>
  );
}
