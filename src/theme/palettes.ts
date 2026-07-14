export type Theme = "day" | "night";

export const palettes: Record<Theme, Record<string, string>> = {
  day: {
    "--background": "42 38% 96%",
    "--foreground": "150 30% 12%",
    "--muted-foreground": "145 11% 39%",
    "--border": "42 20% 82%",
    "--surface": "42 32% 92%",
    "--surface-strong": "44 28% 87%",
    "--accent": "198 66% 45%",
    "--accent-foreground": "0 0% 100%",
    "--forest": "126 57% 35%",
    "--fire": "28 92% 58%",
  },
  night: {
    "--background": "198 62% 8%",
    "--foreground": "43 45% 94%",
    "--muted-foreground": "191 13% 68%",
    "--border": "194 22% 21%",
    "--surface": "198 48% 11%",
    "--surface-strong": "198 43% 15%",
    "--accent": "196 70% 56%",
    "--accent-foreground": "198 62% 8%",
    "--forest": "126 45% 46%",
    "--fire": "30 96% 61%",
  },
};
