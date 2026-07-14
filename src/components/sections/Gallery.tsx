import { Maximize2 } from "lucide-react";
import { GALLERY } from "../../data/gallery";
import { track } from "../../lib/analytics";
import { Container } from "../ui/Container";
import { Reveal } from "../Reveal";
import { SectionHeading } from "../SectionHeading";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils";

export function Gallery({ onOpen }: { onOpen: (index: number) => void }) {
  const open = (index: number) => {
    track("gallery_open", { index });
    onOpen(index);
  };
  return (
    <section id="gallery" className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow="Фото" title="Как выглядит день, который никуда не торопится." /></Reveal>
        <div className="mt-12 grid auto-rows-[180px] grid-cols-2 gap-3 sm:auto-rows-[240px] lg:grid-cols-4">
          {GALLERY.map((image, index) => (
            <Reveal key={image.src} className={cn("group relative overflow-hidden rounded-3xl", index === 0 && "col-span-2 row-span-2", index === 3 && "row-span-2", index === 5 && "col-span-2")}>
              <img
                src={image.src}
                srcSet={image.width > 960
                  ? `${image.src.replace(".webp", "-640.webp")} 640w, ${image.src.replace(".webp", "-960.webp")} 960w, ${image.src} ${image.width}w`
                  : `${image.src.replace(".webp", "-640.webp")} 640w, ${image.src} ${image.width}w`}
                sizes={index === 0 || index === 5 ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
                alt={image.alt}
                width={image.width}
                height={image.height}
                loading="lazy"
                className="size-full object-cover transition duration-[1400ms] group-hover:scale-[1.06]"
              />
              <button type="button" onClick={() => open(index)} className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/30 to-transparent p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white" aria-label={`Открыть: ${image.alt}`}>
                <span className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md"><Maximize2 className="size-4" aria-hidden="true" /></span>
              </button>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-8"><Button variant="secondary" onClick={() => open(0)}>Смотреть все фото</Button></Reveal>
      </Container>
    </section>
  );
}
