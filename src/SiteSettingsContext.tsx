import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { getPublicSiteSettings } from "./public/api";
import { DEFAULT_PUBLIC_SITE_SETTINGS, type PublicSiteSettings } from "./siteSettings";

const SiteSettingsContext = createContext<PublicSiteSettings>(DEFAULT_PUBLIC_SITE_SETTINGS);

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_PUBLIC_SITE_SETTINGS);

  useEffect(() => {
    const controller = new AbortController();
    void getPublicSiteSettings(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSettings(value);
      })
      .catch(() => {
        // Static defaults keep navigation and contact actions usable during an API outage.
      });
    return () => controller.abort();
  }, []);

  return <SiteSettingsContext.Provider value={settings}>{children}</SiteSettingsContext.Provider>;
}

export function useSiteSettings(): PublicSiteSettings {
  return useContext(SiteSettingsContext);
}
