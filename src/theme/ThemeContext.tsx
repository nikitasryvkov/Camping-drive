import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { palettes, type Theme } from "./palettes";

type TransitionPhase = "idle" | "out" | "in";

interface ThemeContextValue {
  theme: Theme;
  phase: TransitionPhase;
  reducedMotion: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "kemping-drive-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion();
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "night" ? "night" : "day";
  });
  const [phase, setPhase] = useState<TransitionPhase>("idle");

  const applyTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    Object.entries(palettes[next]).forEach(([key, value]) => root.style.setProperty(key, value));
    root.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "day" ? "#f8f5ed" : "#081c22");
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [applyTheme, theme]);

  const toggleTheme = useCallback(() => {
    if (phase !== "idle") return;
    const next = theme === "day" ? "night" : "day";
    if (prefersReduced) {
      setTheme(next);
      return;
    }
    setPhase("out");
    window.setTimeout(() => {
      setTheme(next);
      setPhase("in");
      window.setTimeout(() => setPhase("idle"), 650);
    }, 250);
  }, [phase, prefersReduced, theme]);

  const value = useMemo(
    () => ({ theme, phase, reducedMotion: Boolean(prefersReduced), toggleTheme }),
    [theme, phase, prefersReduced, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
