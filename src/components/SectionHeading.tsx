import { cn } from "../lib/utils";

export function SectionHeading({ eyebrow, title, copy, className }: { eyebrow: string; title: string; copy?: string; className?: string }) {
  return (
    <div className={cn("max-w-3xl", className)}>
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-6xl">{title}</h2>
      {copy && <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{copy}</p>}
    </div>
  );
}
