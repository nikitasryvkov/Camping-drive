import { Phone } from "lucide-react";
import { BOOKING_STEPS, SITE } from "../../data/siteContent";
import { track } from "../../lib/analytics";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";
import { Button, buttonStyles } from "../ui/Button";

export function BookingFlow({ onBook }: { onBook: () => void }) {
  return (
    <section className="section-space">
      <Container>
        <Reveal><SectionHeading eyebrow="Как все устроено" title="Три шага — и можно собирать рюкзак." /></Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-4xl border border-border bg-border lg:grid-cols-3">
          {BOOKING_STEPS.map((step) => <Reveal key={step.number} className="bg-background p-7 sm:p-9"><span className="font-display text-4xl text-fire">{step.number}</span><h3 className="mt-8 font-display text-2xl">{step.title}</h3><p className="mt-4 text-sm leading-7 text-muted">{step.text}</p></Reveal>)}
        </div>
        <Reveal className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={SITE.phoneHref} className={buttonStyles("secondary")} onClick={() => track("phone_click", { placement: "booking_flow" })}><Phone className="size-4" aria-hidden="true" />Позвонить</a>
          <Button onClick={onBook} arrow>Оставить заявку</Button>
        </Reveal>
      </Container>
    </section>
  );
}
