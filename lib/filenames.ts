/**
 * Make a string safe to use as a base file name across platforms: strip
 * filesystem-invalid characters, control characters, collapse whitespace, and
 * trim leading/trailing dots and spaces. Falls back when nothing usable remains.
 */
export function safeFileBase(name: string, fallback = "Roster"): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .trim() || fallback
  );
}
