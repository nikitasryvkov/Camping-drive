import { cn } from "../lib/utils";

export function SectionHeading({ eyebrow, title, copy, className, headingAs = "h2" }: { eyebrow: string; title: string; copy?: string; className?: string; headingAs?: "h1" | "h2" }) {
  const Heading = headingAs;
  return (
    <div className={cn("max-w-3xl", className)}>
      <p className="eyebrow">{eyebrow}</p>
      <Heading className="mt-4 font-display text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-6xl">{title}</Heading>
      {copy && <p className="mt-6 max-w-2xl text-base leading-8 text-muted sm:text-lg">{copy}</p>}
    </div>
  );
}
