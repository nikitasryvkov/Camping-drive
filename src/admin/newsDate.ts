export function toDateTimeLocal(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function publicationDateForSave(
  localValue: string,
  originalValue: string | null,
  wasEdited: boolean,
): string | null {
  if (!wasEdited) return originalValue;
  if (!localValue) return null;
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid publication date");
  }
  return parsed.toISOString();
}
