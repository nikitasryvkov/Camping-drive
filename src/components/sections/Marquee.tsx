import { MARQUEE_ITEMS } from "../../data/siteContent";

function MarqueeRow() {
  return (
    <>
      {MARQUEE_ITEMS.map((item) => <span key={item} className="flex shrink-0 items-center gap-6"><span>{item}</span><span className="text-fire" aria-hidden="true">✦</span></span>)}
    </>
  );
}

export function Marquee() {
  return (
    <div className="overflow-hidden border-y border-border bg-surface py-5" aria-label={MARQUEE_ITEMS.join(", ")}>
      <div className="marquee-track flex w-max gap-6 whitespace-nowrap font-display text-2xl text-foreground sm:text-3xl" aria-hidden="true">
        <MarqueeRow /><MarqueeRow />
      </div>
    </div>
  );
}
