import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface AccordionItem {
  question: string;
  answer: string;
}

export function Accordion({ items }: { items: readonly AccordionItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item, index) => {
        const isOpen = open === index;
        const panelId = `faq-panel-${index}`;
        return (
          <div key={item.question}>
            <button
              type="button"
              className="flex min-h-16 w-full items-center justify-between gap-5 py-5 text-left text-base font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpen(isOpen ? null : index)}
            >
              <span>{item.question}</span>
              <ChevronDown className={cn("size-5 shrink-0 transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
            </button>
            <div id={panelId} hidden={!isOpen} className="pb-6 pr-10 text-sm leading-7 text-muted sm:text-base">
              {item.answer}
            </div>
          </div>
        );
      })}
    </div>
  );
}
