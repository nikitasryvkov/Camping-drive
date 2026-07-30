const RELATIVE_URL_BASE = new URL("https://relative.invalid/");
const ENCODED_UNSAFE_URL_CHARACTERS = /%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i;

export function isSafeLinkUrl(value) {
  const candidate = value.trim();
  if (hasUnsafeCharacters(candidate)) return false;
  if (candidate.startsWith("#")) return true;
  if (/^mailto:/i.test(candidate)) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(candidate);
  if (/^tel:/i.test(candidate)) return /^tel:\+?[0-9() .-]{3,}$/i.test(candidate);
  return isSafeHttpOrRelativeUrl(candidate);
}

export function isSafeImageUrl(value) {
  const candidate = value.trim();
  return !hasUnsafeCharacters(candidate) && isSafeHttpOrRelativeUrl(candidate);
}

function hasUnsafeCharacters(value) {
  return value.includes("\\") || Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function isSafeHttpOrRelativeUrl(value) {
  if (/^\/(?!\/)/.test(value)) {
    if (ENCODED_UNSAFE_URL_CHARACTERS.test(value)) return false;
    try {
      return new URL(value, RELATIVE_URL_BASE).origin === RELATIVE_URL_BASE.origin;
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}
