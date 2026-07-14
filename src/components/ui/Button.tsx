import { forwardRef, type ButtonHTMLAttributes } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "light";

export function buttonStyles(variant: Variant = "primary", className?: string) {
  return cn(
    "group inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
    variant === "primary" && "bg-foreground text-background hover:bg-foreground/88",
    variant === "secondary" && "border border-border bg-surface text-foreground hover:bg-surface-strong",
    variant === "ghost" && "text-foreground hover:bg-surface",
    variant === "light" && "border border-white/25 bg-white/12 text-white backdrop-blur-md hover:bg-white/20",
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  arrow?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", arrow = false, children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonStyles(variant, className)} {...props}>
      {children}
      {arrow && <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:rotate-45" aria-hidden="true" />}
    </button>
  );
});
