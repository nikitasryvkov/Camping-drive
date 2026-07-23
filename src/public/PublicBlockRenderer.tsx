import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Image as ImageIcon, MapPinned, Maximize2, Newspaper, RefreshCw, Star } from "lucide-react";

import { Accordion } from "../components/ui/Accordion";
import { Container } from "../components/ui/Container";
import { Reveal } from "../components/Reveal";
import { SectionHeading } from "../components/SectionHeading";
import { ThemeToggle } from "../components/ThemeToggle";
import { VideoBackground } from "../components/VideoBackground";
import { buttonStyles } from "../components/ui/Button";
import { cn } from "../lib/utils";
import { useSiteSettings } from "../SiteSettingsContext";
import { isSafeImageUrl } from "../../shared/safe-url.js";
import type { SiteSettingsValue } from "../siteSettings";
import { useTheme } from "../theme/ThemeContext";
import GalleryLightbox, { type LightboxImage } from "../components/GalleryLightbox";
import {
  getPublicNews,
  type PublicImageSources,
  type PublicNewsItem,
  type PublicPageBlock,
  type PublicPageBlockContent,
} from "./api";

let latestNewsRequest: Promise<PublicNewsItem[]> | undefined;
let latestNewsCache: PublicNewsItem[] | undefined;

function loadLatestNews(forceRefresh: boolean): Promise<PublicNewsItem[]> {
  if (forceRefresh) {
    latestNewsCache = undefined;
  }
  if (latestNewsCache) {
    return Promise.resolve(latestNewsCache);
  }
  if (!latestNewsRequest) {
    latestNewsRequest = getPublicNews(12)
      .then((items) => {
        latestNewsCache = items;
        return items;
      })
      .finally(() => {
        latestNewsRequest = undefined;
      });
  }
  return latestNewsRequest;
}

export function PublicBlockRenderer({ block, sectionId, isPageHeading }: { block: PublicPageBlock; sectionId: string; isPageHeading: boolean }) {
  const props = {
    content: attachImageSources(block.content, block.images ?? {}),
    sectionId,
    isPageHeading,
  };
  switch (block.type) {
    case "hero": return <HeroBlock {...props} />;
    case "text": return <TextBlock {...props} />;
    case "image-text": return <ImageTextBlock {...props} />;
    case "cards": return <CardsBlock {...props} />;
    case "features": return <FeaturesBlock {...props} />;
    case "steps": return <StepsBlock {...props} />;
    case "stats": return <StatsBlock {...props} />;
    case "gallery": return <GalleryBlock {...props} />;
    case "reviews": return <ReviewsBlock {...props} />;
    case "faq": return <FaqBlock {...props} />;
    case "route-map": return <RouteBlock {...props} />;
    case "cta": return <CtaBlock {...props} />;
    case "latest-news": return <LatestNewsBlock {...props} />;
    case "marquee": return <MarqueeBlock {...props} />;
    default: return null;
  }
}

function HeroBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const { theme } = useTheme();
  const background = theme === "night" ? imageUrl(content, "backgroundImageNight") || imageUrl(content, "backgroundImage") : imageUrl(content, "backgroundImage");
  const usesMigratedVideo = imageUrl(content, "backgroundImage") === "/media/hero-day.webp" && imageUrl(content, "backgroundImageNight") === "/media/hero-night.webp";
  const Heading = isPageHeading ? "h1" : "h2";
  return (
    <section id={sectionId} className="relative isolate flex min-h-dvh items-end overflow-hidden bg-[#081c22] pt-28 text-white" style={backgroundStyle(background)}>
      {usesMigratedVideo ? <VideoBackground /> : null}
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_80%_20%,rgba(49,166,200,.2),transparent_34%),linear-gradient(90deg,rgba(3,16,17,.86)_0%,rgba(3,16,17,.48)_52%,rgba(3,16,17,.16)_100%)]" aria-hidden="true" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,rgba(3,16,17,.9)_0%,transparent_58%,rgba(3,16,17,.3)_100%)]" aria-hidden="true" />
      <Container className="relative z-10 grid min-h-[calc(100dvh-7rem)] items-end gap-10 pb-10 pt-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:pb-14">
        <div className="max-w-5xl hero-enter">
          {text(content, "eyebrow") && <p className="text-xs font-bold uppercase tracking-[.2em] text-white/70">{text(content, "eyebrow")}</p>}
          <Heading className="mt-5 max-w-[15ch] font-display text-[clamp(2.625rem,7vw,6.7rem)] leading-[.98] tracking-[-.025em]">{text(content, "title")}</Heading>
          <RichText value={text(content, "text")} className="mt-6 max-w-2xl text-base leading-7 text-white/76 sm:text-lg sm:leading-8" />
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ActionLink label={text(content, "primaryButtonLabel")} href={text(content, "primaryButtonUrl")} variant="light" />
            <ActionLink label={text(content, "secondaryButtonLabel")} href={text(content, "secondaryButtonUrl")} variant="light" />
          </div>
        </div>
        <div className="flex justify-end"><ThemeToggle /></div>
      </Container>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 translate-y-1/2 bg-gradient-to-b from-transparent to-background" aria-hidden="true" />
    </section>
  );
}

function TextBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const centered = text(content, "alignment") === "center";
  const Heading = isPageHeading ? "h1" : "h2";
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container>
        <Reveal className={cn("border-t border-border pt-10 lg:pt-16", centered ? "mx-auto max-w-4xl text-center" : "grid gap-8 lg:grid-cols-[.65fr_1.35fr] lg:gap-16")}>
          {text(content, "eyebrow") && <p className="eyebrow">{text(content, "eyebrow")}</p>}
          <div>
            <Heading className="font-display text-4xl leading-[1.1] sm:text-5xl lg:text-7xl">{text(content, "title")}</Heading>
            <RichText value={text(content, "body")} className={cn("mt-8 text-base leading-8 text-muted sm:text-lg", centered ? "mx-auto max-w-3xl" : "max-w-2xl")} />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function ImageTextBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const imageFirst = text(content, "imagePosition") === "left";
  const image = <ContentImage content={content} imageKey="image" className="min-h-[340px] rounded-4xl sm:min-h-[480px]" />;
  const copy = (
    <Reveal className="flex flex-col justify-center">
      <SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} copy={text(content, "body")} headingAs={isPageHeading ? "h1" : "h2"} />
      <ActionLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} variant="primary" className="mt-8 self-start" />
    </Reveal>
  );
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container className="grid items-center gap-9 lg:grid-cols-2 lg:gap-16">
        {imageFirst ? <>{image}{copy}</> : <>{copy}{image}</>}
      </Container>
    </section>
  );
}

function CardsBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const { theme } = useTheme();
  const list = items(content);
  return (
    <section id={sectionId} className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} copy={text(content, "intro")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className={cn("mt-12 grid gap-5", list.length === 2 ? "md:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
          {list.map((item, index) => (
            <Reveal key={index} className="h-full" style={{ transitionDelay: `${(index % 4) * 55}ms` }}>
              <article className="group flex h-full min-h-[390px] flex-col overflow-hidden rounded-4xl border border-border bg-background shadow-soft">
                <ContentImage content={item} imageKey={theme === "night" && imageUrl(item, "imageNight") ? "imageNight" : "image"} className="aspect-[4/3] min-h-52 rounded-none" />
                <div className="flex flex-1 flex-col p-6 sm:p-7">
                  <span className="text-xs font-bold text-muted">{String(index + 1).padStart(2, "0")}</span>
                  <h3 className="mt-3 font-display text-2xl leading-tight sm:text-3xl">{text(item, "title")}</h3>
                  <RichText value={text(item, "text")} className="mt-4 text-sm leading-7 text-muted" />
                  <InlineLink label={text(item, "linkLabel")} href={text(item, "linkUrl")} className="mt-auto pt-7" />
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function FeaturesBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const list = items(content);
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-4xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {list.map((item, index) => (
            <Reveal key={index} className="h-full overflow-hidden bg-background" style={{ transitionDelay: `${(index % 3) * 45}ms` }}>
              {imageUrl(item, "image") ? <img {...responsiveImageProps(item, "image", "(min-width: 1024px) 33vw, 50vw")} alt={text(item, "imageAlt")} loading="lazy" className="h-32 w-full object-cover sm:h-40" /> : null}
              <div className="p-6 sm:p-8">
                <span className="flex size-12 items-center justify-center rounded-full bg-surface text-2xl text-fire" aria-hidden="true">{text(item, "icon") || "✦"}</span>
                <h3 className="mt-7 font-display text-2xl">{text(item, "title")}</h3>
                <RichText value={text(item, "text")} className="mt-3 text-sm leading-7 text-muted" />
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function StepsBlock({ content, sectionId, isPageHeading }: BlockProps) {
  return (
    <section id={sectionId} className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid gap-px overflow-hidden rounded-4xl border border-border bg-border lg:grid-cols-3">
          {items(content).map((item, index) => (
            <Reveal key={index} className="bg-background p-7 sm:p-9">
              <span className="font-display text-4xl text-fire">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-8 font-display text-2xl">{text(item, "title")}</h3>
              <RichText value={text(item, "text")} className="mt-4 text-sm leading-7 text-muted" />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

function StatsBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const list = items(content);
  const Heading = isPageHeading ? "h1" : "h2";
  return (
    <section id={sectionId} className="border-y border-border bg-foreground py-12 text-background sm:py-16">
      <Container>
        {(text(content, "eyebrow") || text(content, "title")) && <div className="mb-10"><p className="text-xs font-bold uppercase tracking-[.2em] opacity-55">{text(content, "eyebrow")}</p><Heading className="mt-3 font-display text-3xl sm:text-4xl">{text(content, "title")}</Heading></div>}
        <div className={cn("grid grid-cols-2 gap-px", list.length > 2 && "lg:grid-cols-4")}>
          {list.map((item, index) => <Reveal key={index} className="border-background/15 p-4 odd:border-r lg:border-r lg:last:border-r-0 sm:p-7"><strong className="block font-display text-4xl sm:text-5xl lg:text-6xl">{text(item, "value")}</strong><span className="mt-2 block text-xs font-semibold uppercase tracking-[.14em] opacity-65 sm:text-sm">{text(item, "label")}</span></Reveal>)}
        </div>
      </Container>
    </section>
  );
}

function GalleryBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const galleryImages = items(content).flatMap<LightboxImage & {
    caption: string;
    previewSrc: string;
    srcSet?: string;
    sizes?: string;
  }>((item) => {
    const preview = responsiveImageProps(item, "image", "(min-width: 1024px) 25vw, 50vw");
    const src = originalImageUrl(item, "image");
    const caption = text(item, "caption");
    return src ? [{ ...preview, src, previewSrc: preview.src, caption, alt: text(item, "imageAlt") || caption || "Фотография Кемпинг Драйв" }] : [];
  });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const close = useCallback(() => setOpenIndex(null), []);
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid auto-rows-[180px] grid-cols-2 gap-3 sm:auto-rows-[240px] lg:grid-cols-4">
          {galleryImages.map((image, index) => (
            <Reveal key={`${image.src}-${index}`} className={cn("group relative overflow-hidden rounded-3xl", index === 0 && "col-span-2 row-span-2", index === 3 && "row-span-2", index === 5 && "col-span-2")}>
              <img src={image.previewSrc} srcSet={image.srcSet} sizes={image.sizes} width={image.width} height={image.height} alt={image.alt} loading="lazy" className="size-full object-cover transition duration-[1400ms] group-hover:scale-[1.06]" />
              <button type="button" onClick={() => setOpenIndex(index)} className="absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/30 to-transparent p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white" aria-label={`Открыть: ${image.alt}`}><span className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-md"><Maximize2 className="size-4" /></span></button>
              {image.caption ? <p className="pointer-events-none absolute inset-x-0 bottom-0 max-w-[calc(100%-4rem)] p-5 text-sm font-semibold leading-5 text-white drop-shadow-md">{image.caption}</p> : null}
            </Reveal>
          ))}
        </div>
      </Container>
      <GalleryLightbox index={openIndex} images={galleryImages} onChange={setOpenIndex} onClose={close} />
    </section>
  );
}

function ReviewsBlock({ content, sectionId, isPageHeading }: BlockProps) {
  return (
    <section id={sectionId} className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {items(content).map((item, index) => {
            const rating = integer(item, "rating", 5, 1, 5);
            return <Reveal key={index} className="rounded-4xl border border-border bg-background p-7 sm:p-8"><div className="flex gap-1 text-fire" aria-label={`${rating} из 5`}>{Array.from({ length: rating }, (_, star) => <Star key={star} className="size-4" fill="currentColor" />)}</div><blockquote className="mt-8 font-display text-2xl leading-relaxed sm:text-3xl">«{text(item, "text")}»</blockquote><strong className="mt-8 block text-sm">{text(item, "name")}</strong></Reveal>;
          })}
        </div>
      </Container>
    </section>
  );
}

function FaqBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const faqItems = items(content).map((item) => ({ question: text(item, "question"), answer: text(item, "answer") }));
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container className="grid gap-10 lg:grid-cols-[.72fr_1.28fr] lg:gap-16">
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <Reveal><Accordion items={faqItems} /></Reveal>
      </Container>
    </section>
  );
}

function RouteBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const settings = useSiteSettings();
  const routeImage = imageUrl(content, "image");
  const address = text(content, "address") || settings.address;
  const routeUrl = text(content, "buttonUrl") || text(content, "mapUrl") || settings.routeUrl;
  return (
    <section id={sectionId} className="section-space scroll-mt-24 bg-surface">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid min-w-0 gap-9 lg:grid-cols-[.9fr_1.1fr] lg:gap-14">
          <Reveal className="flex flex-col justify-center">
            {address && <p className="inline-flex items-center gap-2 font-semibold text-fire"><MapPinned className="size-5" />{address}</p>}
            <RichText value={text(content, "body")} className="mt-6 whitespace-pre-line text-base leading-8 text-muted" />
            <ActionLink label={text(content, "buttonLabel")} href={routeUrl} variant="primary" className="mt-8 self-start" />
          </Reveal>
          <Reveal className="overflow-hidden rounded-4xl border border-border bg-background shadow-soft">
            {routeImage ? <img {...responsiveImageProps(content, "image", "(min-width: 1024px) 55vw, 100vw")} alt={text(content, "imageAlt")} loading="lazy" className="aspect-[4/3] min-h-[360px] size-full object-cover" /> : <div className="flex aspect-[4/3] min-h-[360px] flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,hsl(var(--accent)/.2),transparent_58%)] px-8 text-center"><span className="flex size-16 items-center justify-center rounded-full bg-background shadow-soft"><MapPinned className="size-8 text-accent" /></span><p className="font-display text-2xl">{address || settings.siteName}</p><span className="max-w-sm text-sm leading-6 text-muted">Карта откроется только по вашему запросу.</span></div>}
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

function CtaBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const { theme } = useTheme();
  const background = theme === "night" ? imageUrl(content, "backgroundImageNight") || imageUrl(content, "backgroundImage") : imageUrl(content, "backgroundImage");
  const Heading = isPageHeading ? "h1" : "h2";
  return (
    <section id={sectionId} className="relative isolate overflow-hidden bg-[#07191d] py-24 text-white sm:py-32" style={backgroundStyle(background)}>
      <div className="absolute inset-0 -z-10 bg-slate-950/65" />
      <Container>
        <Reveal className="max-w-4xl">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-white/65">{text(content, "eyebrow")}</p>
          <Heading className="mt-5 font-display text-4xl leading-[1.08] sm:text-6xl lg:text-7xl">{text(content, "title")}</Heading>
          <RichText value={text(content, "text")} className="mt-6 max-w-2xl text-base leading-8 text-white/74 sm:text-lg" />
          <ActionLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} variant="light" className="mt-8" />
        </Reveal>
      </Container>
    </section>
  );
}

function LatestNewsBlock({ content, sectionId, isPageHeading }: BlockProps) {
  const count = integer(content, "count", 3, 1, 12);
  const [news, setNews] = useState<PublicNewsItem[] | null>(null);
  const [newsError, setNewsError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setNews(null);
    setNewsError(false);
    loadLatestNews(reloadKey > 0).then((items) => {
      if (active) {
        setNews(items.slice(0, count));
      }
    }).catch(() => {
      if (active) {
        setNews([]);
        setNewsError(true);
      }
    });
    return () => {
      active = false;
    };
  }, [count, reloadKey]);
  return (
    <section id={sectionId} className="section-space scroll-mt-24">
      <Container>
        <Reveal><SectionHeading eyebrow={text(content, "eyebrow")} title={text(content, "title")} headingAs={isPageHeading ? "h1" : "h2"} /></Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {news === null ? Array.from({ length: Math.min(count, 3) }, (_, index) => <div key={index} className="min-h-60 animate-pulse rounded-4xl bg-surface" aria-hidden="true" />) : null}
          {news?.map((item) => <Reveal key={item.slug} className="h-full"><a href={`/news/${item.slug}`} className="group flex h-full flex-col overflow-hidden rounded-4xl border border-border bg-surface transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><div className="aspect-[16/10] overflow-hidden bg-surface-strong">{item.coverImageUrl ? <img {...publicImageProps(item.coverImageSources, item.coverImageUrl, "(min-width: 768px) 33vw, 100vw")} alt={item.coverImageAlt || ""} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.035]" /> : <div className="flex size-full items-center justify-center"><Newspaper className="size-9 text-fire" /></div>}</div><div className="p-7"><p className="text-xs font-bold uppercase tracking-[.14em] text-muted">{formatNewsDate(item.publishedAt)}</p><h3 className="mt-3 font-display text-2xl">{item.title}</h3><p className="mt-4 text-sm leading-7 text-muted">{item.excerpt}</p><span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold">Читать<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span></div></a></Reveal>)}
          {newsError ? <Reveal className="min-h-52 rounded-4xl border border-border bg-surface p-7 md:col-span-3"><Newspaper className="size-8 text-fire" /><h3 className="mt-8 font-display text-2xl">Не удалось загрузить новости</h3><p className="mt-3 text-sm leading-7 text-muted">Проверьте подключение и попробуйте ещё раз.</p><button type="button" className={buttonStyles("secondary", "mt-6")} onClick={() => setReloadKey((value) => value + 1)}><RefreshCw className="size-4" />Повторить</button></Reveal> : null}
          {!newsError && news?.length === 0 ? <Reveal className="min-h-52 rounded-4xl border border-border bg-surface p-7"><Newspaper className="size-8 text-fire" /><h3 className="mt-10 font-display text-2xl">Публикации скоро появятся</h3></Reveal> : null}
        </div>
        <ActionLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} variant="secondary" className="mt-8" />
      </Container>
    </section>
  );
}

function formatNewsDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Новости" : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function MarqueeBlock({ content, sectionId }: BlockProps) {
  const labels = items(content).map((item) => text(item, "text")).filter(Boolean);
  if (labels.length === 0) return null;
  const repeatedLabels = [...labels, ...labels];
  return (
    <div id={sectionId} className="overflow-hidden border-y border-border bg-surface py-5" aria-label={labels.join(", ")}>
      <div className="marquee-track flex w-max gap-6 whitespace-nowrap font-display text-2xl text-foreground sm:text-3xl" aria-hidden="true">{repeatedLabels.map((label, index) => <span key={`${index}-${label}`} className="flex shrink-0 items-center gap-6"><span>{label}</span><span className="text-fire" aria-hidden="true">✦</span></span>)}</div>
    </div>
  );
}

function ContentImage({ content, imageKey, className }: { content: PublicPageBlockContent; imageKey: string; className?: string }) {
  const src = imageUrl(content, imageKey);
  return (
    <Reveal className={cn("relative overflow-hidden bg-surface", className)}>
      {src ? <img {...responsiveImageProps(content, imageKey, "(min-width: 1024px) 50vw, 100vw")} alt={text(content, `${imageKey}Alt`)} loading="lazy" className="absolute inset-0 size-full object-cover" /> : <div className="absolute inset-0 flex items-center justify-center text-muted"><ImageIcon className="size-9" aria-hidden="true" /></div>}
    </Reveal>
  );
}

function ActionLink({ label, href, variant, className }: { label: string; href: string; variant: "primary" | "secondary" | "light"; className?: string }) {
  const settings = useSiteSettings();
  if (!label) return null;
  const safe = configuredHref(href, settings);
  return <a href={safe} {...externalLinkProps(safe)} className={buttonStyles(variant, className)}>{label}<ArrowRight className="size-4" /></a>;
}

function InlineLink({ label, href, className }: { label: string; href: string; className?: string }) {
  const settings = useSiteSettings();
  if (!label) return null;
  const safe = configuredHref(href, settings);
  return <a href={safe} {...externalLinkProps(safe)} className={cn("inline-flex items-center gap-2 text-sm font-semibold", className)}>{label}<ArrowUpRight className="size-4 transition-transform group-hover:rotate-45" /></a>;
}

function RichText({ value, className }: { value: string; className?: string }) {
  return value ? <p className={cn("whitespace-pre-line", className)}>{value}</p> : null;
}

function text(content: PublicPageBlockContent, key: string): string {
  const value = content[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function integer(content: PublicPageBlockContent, key: string, fallback: number, min: number, max: number): number {
  const value = content[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function items(content: PublicPageBlockContent): PublicPageBlockContent[] {
  return Array.isArray(content.items)
    ? content.items.filter((item): item is PublicPageBlockContent => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function imageUrl(content: PublicPageBlockContent, key: string): string {
  const sources = imageSources(content, key);
  if (sources) return sources.medium?.url ?? sources.original.url;
  const value = text(content, `${key}Url`).trim();
  return isSafeImageUrl(value) ? value : "";
}

function originalImageUrl(content: PublicPageBlockContent, key: string): string {
  return imageSources(content, key)?.original.url ?? imageUrl(content, key);
}

function imageSources(content: PublicPageBlockContent, key: string): PublicImageSources | undefined {
  const value = content[`${key}Sources`];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PublicImageSources
    : undefined;
}

function responsiveImageProps(
  content: PublicPageBlockContent,
  key: string,
  sizes: string,
) {
  return publicImageProps(imageSources(content, key), imageUrl(content, key), sizes);
}

function publicImageProps(
  sources: PublicImageSources | null | undefined,
  fallback: string,
  sizes: string,
): { src: string; srcSet?: string; sizes?: string; width?: number; height?: number } {
  if (!sources) return { src: fallback };
  const selected = sources.medium ?? sources.original;
  const candidates = [sources.thumbnail, sources.medium, sources.original]
    .filter((source): source is NonNullable<typeof source> => Boolean(source?.url && source.width))
    .filter((source, index, values) => values.findIndex((item) => item.width === source.width) === index)
    .sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
  return {
    src: selected.url,
    ...(candidates.length > 1
      ? { srcSet: candidates.map((source) => `${source.url} ${source.width}w`).join(", "), sizes }
      : {}),
    ...(selected.width ? { width: selected.width } : {}),
    ...(selected.height ? { height: selected.height } : {}),
  };
}

function attachImageSources(
  value: PublicPageBlockContent,
  sourcesById: Record<string, PublicImageSources>,
): PublicPageBlockContent {
  const result: PublicPageBlockContent = {};
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      result[key] = item.map((entry) =>
        entry && typeof entry === "object" && !Array.isArray(entry)
          ? attachImageSources(entry as PublicPageBlockContent, sourcesById)
          : entry
      );
      continue;
    }
    if (item && typeof item === "object") {
      result[key] = attachImageSources(item as PublicPageBlockContent, sourcesById);
      continue;
    }
    result[key] = item;
    if (/image(?:night)?id$/i.test(key) && item !== null && item !== undefined) {
      const sources = sourcesById[String(item)];
      if (sources) result[`${key.slice(0, -2)}Sources`] = sources;
    }
  }
  return result;
}

function safeHref(value: string): string {
  const href = value.trim();
  return /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? href : "#";
}

function configuredHref(value: string, settings: SiteSettingsValue): string {
  const href = value.trim();
  void settings;
  return safeHref(href);
}

function externalLinkProps(href: string): { target?: "_blank"; rel?: string } {
  return /^https?:\/\//i.test(href) ? { target: "_blank", rel: "noreferrer" } : {};
}

function backgroundStyle(url: string): CSSProperties | undefined {
  return url ? { backgroundImage: `url("${url.replace(/["\\]/g, "\\$&")}")`, backgroundPosition: "center", backgroundSize: "cover" } : undefined;
}

type BlockProps = { content: PublicPageBlockContent; sectionId: string; isPageHeading: boolean };
