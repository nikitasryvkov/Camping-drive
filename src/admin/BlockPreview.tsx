import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, MapPin, Newspaper, Star } from "lucide-react";

import type { PageBlock, PageBlockContent } from "./api";
import { getBlockDefinition } from "./pageBlocks";

export function BlockPreview({ block }: { block: PageBlock }) {
  const content = block.content;
  const eyebrow = text(content, "eyebrow");
  const title = text(content, "title");

  switch (block.type) {
    case "hero": {
      const imageUrl = text(content, "backgroundImageUrl");
      return (
        <PreviewSection className="is-hero" style={backgroundStyle(imageUrl)}>
          <div className="builder-preview-hero-shade" />
          <div className="builder-preview-inner builder-preview-hero-content">
            <Heading eyebrow={eyebrow} title={title} />
            <RichText value={text(content, "text")} />
            <div className="builder-preview-actions">
              <PreviewLink label={text(content, "primaryButtonLabel")} href={text(content, "primaryButtonUrl")} primary />
              <PreviewLink label={text(content, "secondaryButtonLabel")} href={text(content, "secondaryButtonUrl")} />
            </div>
          </div>
        </PreviewSection>
      );
    }
    case "text":
      return (
        <PreviewSection className={text(content, "alignment") === "center" ? "is-centered" : ""}>
          <div className="builder-preview-inner is-narrow">
            <Heading eyebrow={eyebrow} title={title} />
            <RichText value={text(content, "body")} />
          </div>
        </PreviewSection>
      );
    case "image-text": {
      const image = <PreviewImage content={content} imageKey="image" />;
      const copy = (
        <div className="builder-preview-copy">
          <Heading eyebrow={eyebrow} title={title} />
          <RichText value={text(content, "body")} />
          <PreviewLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} primary />
        </div>
      );
      return (
        <PreviewSection>
          <div className={`builder-preview-inner builder-preview-split${text(content, "imagePosition") === "left" ? " is-image-left" : ""}`}>
            {copy}{image}
          </div>
        </PreviewSection>
      );
    }
    case "cards":
      return (
        <PreviewSection>
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <RichText value={text(content, "intro")} />
            <div className="builder-preview-grid">
              {items(content).map((item, index) => (
                <article className="builder-preview-card" key={index}>
                  <PreviewImage content={item} imageKey="image" />
                  <div><h3>{text(item, "title")}</h3><RichText value={text(item, "text")} /><PreviewLink label={text(item, "linkLabel")} href={text(item, "linkUrl")} /></div>
                </article>
              ))}
            </div>
          </div>
        </PreviewSection>
      );
    case "features":
      return (
        <PreviewSection className="is-tinted">
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-feature-grid">
              {items(content).map((item, index) => (
                <article key={index}><span>{text(item, "icon") || "★"}</span><h3>{text(item, "title")}</h3><RichText value={text(item, "text")} /></article>
              ))}
            </div>
          </div>
        </PreviewSection>
      );
    case "steps":
      return (
        <PreviewSection>
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-steps">
              {items(content).map((item, index) => (
                <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><div><h3>{text(item, "title")}</h3><RichText value={text(item, "text")} /></div></article>
              ))}
            </div>
          </div>
        </PreviewSection>
      );
    case "stats":
      return (
        <PreviewSection className="is-dark">
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-stats">
              {items(content).map((item, index) => <div key={index}><strong>{text(item, "value")}</strong><span>{text(item, "label")}</span></div>)}
            </div>
          </div>
        </PreviewSection>
      );
    case "gallery":
      return (
        <PreviewSection>
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-gallery">
              {items(content).map((item, index) => <figure key={index}><PreviewImage content={item} imageKey="image" /><figcaption>{text(item, "caption")}</figcaption></figure>)}
            </div>
          </div>
        </PreviewSection>
      );
    case "reviews":
      return (
        <PreviewSection className="is-tinted">
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-grid">
              {items(content).map((item, index) => (
                <blockquote className="builder-preview-review" key={index}>
                  <div className="builder-preview-rating" aria-label={`Оценка ${number(item, "rating", 5, 1, 5)} из 5`}>
                    {Array.from({ length: number(item, "rating", 5, 1, 5) }, (_, star) => <Star key={star} size={15} fill="currentColor" />)}
                  </div>
                  <RichText value={text(item, "text")} />
                  <cite>{text(item, "name")}</cite>
                </blockquote>
              ))}
            </div>
          </div>
        </PreviewSection>
      );
    case "faq":
      return (
        <PreviewSection>
          <div className="builder-preview-inner is-narrow">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-faq">
              {items(content).map((item, index) => <details key={index} open={index === 0}><summary>{text(item, "question")}</summary><RichText value={text(item, "answer")} /></details>)}
            </div>
          </div>
        </PreviewSection>
      );
    case "route-map":
      return (
        <PreviewSection className="is-tinted">
          <div className="builder-preview-inner builder-preview-split">
            <div className="builder-preview-copy">
              <Heading eyebrow={eyebrow} title={title} />
              <p className="builder-preview-address"><MapPin size={18} />{text(content, "address")}</p>
              <RichText value={text(content, "body")} />
              <PreviewLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl") || text(content, "mapUrl")} primary />
            </div>
            <PreviewImage content={content} imageKey="image" />
          </div>
        </PreviewSection>
      );
    case "cta": {
      const imageUrl = text(content, "backgroundImageUrl");
      return (
        <PreviewSection className="is-cta" style={backgroundStyle(imageUrl)}>
          <div className="builder-preview-hero-shade" />
          <div className="builder-preview-inner is-narrow builder-preview-hero-content">
            <Heading eyebrow={eyebrow} title={title} />
            <RichText value={text(content, "text")} />
            <PreviewLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} primary />
          </div>
        </PreviewSection>
      );
    }
    case "latest-news":
      return (
        <PreviewSection>
          <div className="builder-preview-inner">
            <Heading eyebrow={eyebrow} title={title} />
            <div className="builder-preview-grid">
              {Array.from({ length: number(content, "count", 3, 1, 12) }, (_, index) => (
                <article className="builder-preview-news" key={index}><Newspaper size={28} /><small>Последняя новость</small><h3>Здесь появится опубликованная новость</h3></article>
              ))}
            </div>
            <PreviewLink label={text(content, "buttonLabel")} href={text(content, "buttonUrl")} />
          </div>
        </PreviewSection>
      );
    default:
      return <PreviewSection><div className="builder-preview-inner"><h2>{getBlockDefinition(block.type)?.label ?? block.type}</h2><p>Предпросмотр этого блока пока недоступен.</p></div></PreviewSection>;
  }
}

function PreviewSection({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <section className={`builder-preview-section ${className}`} style={style}>{children}</section>;
}

function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <div className="builder-preview-heading">{eyebrow ? <p>{eyebrow}</p> : null}{title ? <h2>{title}</h2> : null}</div>;
}

function RichText({ value }: { value: string }) {
  return value ? <p className="builder-preview-rich-text">{value}</p> : null;
}

function PreviewLink({ label, href, primary = false }: { label: string; href: string; primary?: boolean }) {
  return label ? <a className={`builder-preview-button${primary ? " is-primary" : ""}`} href={safeHref(href)} onClick={(event) => event.preventDefault()}>{label}<ArrowRight size={16} /></a> : null;
}

function PreviewImage({ content, imageKey }: { content: PageBlockContent; imageKey: string }) {
  const url = text(content, `${imageKey}Url`);
  const alt = text(content, `${imageKey}Alt`);
  return url ? <img className="builder-preview-image" src={url} alt={alt} /> : <div className="builder-preview-image-placeholder">Изображение не выбрано</div>;
}

function text(content: PageBlockContent, key: string): string {
  const value = content[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function number(content: PageBlockContent, key: string, fallback: number, min: number, max: number): number {
  const value = content[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function items(content: PageBlockContent): PageBlockContent[] {
  const value = content.items;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PageBlockContent => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function safeHref(value: string): string {
  const href = value.trim();
  return /^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(href) ? href : "#";
}

function backgroundStyle(url: string): CSSProperties | undefined {
  return url ? { backgroundImage: `url("${url.replace(/["\\]/g, "\\$&")}")` } : undefined;
}
