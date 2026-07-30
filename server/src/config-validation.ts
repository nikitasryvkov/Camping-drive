export function ensurePublicSiteOrigin(
  environment: string,
  publicSiteUrl: string | undefined,
  publicOrigins: readonly string[],
): void {
  if (
    environment === "production" &&
    publicSiteUrl !== undefined &&
    !publicOrigins.includes(publicSiteUrl)
  ) {
    throw new Error("PUBLIC_ORIGINS must include PUBLIC_SITE_URL in production");
  }
}

export function ensureNodeEnvironment(
  environment: string,
): asserts environment is "development" | "test" | "production" {
  if (!["development", "test", "production"].includes(environment)) {
    throw new Error("NODE_ENV must be development, test or production");
  }
}

export function ensureProductionDatabaseSecret(
  environment: string,
  name: string,
  value: string,
): void {
  if (environment !== "production") return;
  const normalized = value.toLocaleLowerCase("en-US");
  if (
    value.length < 24 ||
    normalized.includes("replace-with") ||
    normalized.includes("changeme") ||
    normalized.includes("placeholder") ||
    (normalized.includes("example") && normalized.includes("password"))
  ) {
    throw new Error(`${name} must be a non-placeholder secret of at least 24 characters in production`);
  }
}

export function validatePublicIndexTemplate(contents: string): void {
  const requiredMarkers = [
    "<title>",
    'id="meta-description"',
    'id="meta-robots"',
    'id="og-type"',
    'id="og-title"',
    'id="og-description"',
    'id="og-url"',
    'id="og-image"',
    'id="canonical-url"',
    'id="structured-data"',
    'id="root"',
    '<script type="module"',
  ];
  if (requiredMarkers.some((marker) => !contents.includes(marker))) {
    throw new Error("PUBLIC_INDEX_PATH must contain the production HTML and SSR metadata markers");
  }
}
