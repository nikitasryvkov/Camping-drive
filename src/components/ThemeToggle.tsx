import { Moon, Sun } from "lucide-react";
import { motion } from "framer-motion";
import { useTheme } from "../theme/ThemeContext";
import { track } from "../lib/analytics";
import { cn } from "../lib/utils";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggleTheme, phase, reducedMotion } = useTheme();
  const night = theme === "night";

  const handleToggle = () => {
    track("theme_toggle", { from: theme, to: night ? "day" : "night" });
    toggleTheme();
  };

  return (
    <div className={cn("flex flex-col items-center gap-2", compact && "gap-0")}>
      <button
        type="button"
        role="switch"
        aria-checked={night}
        aria-label={night ? "Вернуться в дневную тему" : "Переключить на ночную тему"}
        disabled={phase !== "idle"}
        onClick={handleToggle}
        className={cn(
          "relative flex h-[68px] w-[148px] items-center rounded-full border border-white/25 bg-black/20 p-[6px] text-white shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-wait",
          compact && "h-11 w-[92px] p-1",
        )}
      >
        <Sun className={cn("absolute left-[22px] size-5", compact && "left-[14px] size-4")} aria-hidden="true" />
        <Moon className={cn("absolute right-[22px] size-5", compact && "right-[14px] size-4")} aria-hidden="true" />
        <motion.span
          className={cn("relative z-10 flex size-14 items-center justify-center rounded-full bg-white text-slate-900 shadow-md", compact && "size-9")}
          animate={{ x: night ? (compact ? 47 : 80) : 0 }}
          transition={reducedMotion ? { duration: 0.01 } : { type: "spring", stiffness: 420, damping: 26 }}
        >
          {night ? <Moon className="size-5" aria-hidden="true" /> : <Sun className="size-5" aria-hidden="true" />}
        </motion.span>
      </button>
      {!compact && <span className="text-xs font-semibold text-white/82">{night ? "Вернуться в день" : "Переключить на вечер"}</span>}
    </div>
  );
}
