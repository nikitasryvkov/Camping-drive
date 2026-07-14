import { Reveal } from "../Reveal";
import { Container } from "../ui/Container";

export function IntroStatement() {
  return (
    <section id="intro" className="section-space scroll-mt-24">
      <Container>
        <Reveal className="grid gap-8 border-t border-border pt-10 lg:grid-cols-[.65fr_1.35fr] lg:gap-16 lg:pt-16">
          <p className="eyebrow">Не база отдыха по расписанию</p>
          <div>
            <h2 className="max-w-4xl font-display text-4xl leading-[1.1] sm:text-5xl lg:text-7xl">Можно приехать за тишиной. <span className="text-muted">А можно — за приключением.</span></h2>
            <p className="mt-8 max-w-2xl text-base leading-8 text-muted sm:text-lg">Поставьте свою палатку в уединенной части территории, выберите домик, отправьтесь на сплав или проведите вечер у костра. Мы поможем с маршрутом, снаряжением и бытовыми мелочами.</p>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
