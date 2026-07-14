import { PhoneCall, ShieldAlert } from "lucide-react";
import { FAQ_ITEMS, SITE } from "../../data/siteContent";
import { track } from "../../lib/analytics";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";
import { Accordion } from "../ui/Accordion";

export function RulesFaq() {
  return (
    <section id="rules" className="section-space scroll-mt-24 bg-surface">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr] lg:gap-16">
          <Reveal><SectionHeading eyebrow="Правила и ответы" title="Чтобы отдых оставался спокойным для всех." copy="Перед дальней поездкой лучше позвонить и проверить актуальный режим работы, доступность домиков и активностей." /></Reveal>
          <Reveal><Accordion items={FAQ_ITEMS} /></Reveal>
        </div>
        <Reveal className="mt-10 flex flex-col gap-5 rounded-4xl border border-fire/35 bg-fire/10 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex gap-4"><ShieldAlert className="mt-1 size-6 shrink-0 text-fire" aria-hidden="true" /><div><h3 className="font-semibold">Экстренная связь с администрацией</h3><p className="mt-2 text-sm text-muted">Если вы потерялись, застряли или столкнулись с происшествием на воде — звоните сразу.</p></div></div>
          <div className="flex shrink-0 flex-col gap-2 text-sm font-semibold"><a href={SITE.emergencyPhoneHref} onClick={() => track("phone_click", { placement: "safety", phone: "emergency" })} className="inline-flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><PhoneCall className="size-4" />{SITE.emergencyPhoneDisplay}</a><a href={SITE.phoneHref} onClick={() => track("phone_click", { placement: "safety", phone: "main" })} className="inline-flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><PhoneCall className="size-4" />{SITE.phoneDisplay}</a></div>
        </Reveal>
      </Container>
    </section>
  );
}
