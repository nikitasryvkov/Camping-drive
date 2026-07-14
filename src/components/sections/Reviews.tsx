import { ArrowUpRight, Star } from "lucide-react";
import { REVIEWS } from "../../data/reviews";
import { SITE } from "../../data/siteContent";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";
import { buttonStyles } from "../ui/Button";

export function Reviews() {
  return (
    <section id="reviews" className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow="Отзывы гостей" title="Что гости запоминают после поездки" /></Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {REVIEWS.map((review) => <Reveal key={review.name} className="rounded-4xl border border-border bg-background p-7 sm:p-8"><div className="flex gap-1 text-fire" aria-label="5 из 5">{Array.from({ length: 5 }).map((_, index) => <Star key={index} className="size-4" fill="currentColor" aria-hidden="true" />)}</div><blockquote className="mt-8 font-display text-2xl leading-relaxed sm:text-3xl">«{review.text}»</blockquote><div className="mt-8 flex items-center justify-between text-sm"><strong>{review.name}</strong><span className="text-muted">Яндекс Карты</span></div></Reveal>)}
        </div>
        <Reveal className="mt-8 flex flex-col items-start justify-between gap-4 rounded-3xl border border-border bg-background p-6 sm:flex-row sm:items-center">
          <p><strong>{SITE.rating.value}</strong> · {SITE.rating.countLabel} на {SITE.rating.sourceLabel}</p>
          <a href={SITE.reviewsUrl} target="_blank" rel="noreferrer" className={buttonStyles("secondary")}>Читать отзывы<ArrowUpRight className="size-4" aria-hidden="true" /></a>
        </Reveal>
      </Container>
    </section>
  );
}
