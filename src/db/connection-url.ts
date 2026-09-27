/**
 * Keep PostgreSQL instants unambiguous across node-postgres and PrismaPg.
 * The value is appended to the libpq startup options; existing query
 * parameters and unrelated startup options are preserved. Appending the UTC
 * setting also overrides a role/database default or an earlier timezone flag.
 */
export function withUtcTimezone(raw: string): string {
  const url = new URL(raw);
  const options = url.searchParams.get('options')?.trim() ?? '';
  if (options === '') {
    url.searchParams.set('options', '-c timezone=UTC');
  } else if (!/(^|\s)(?:-c\s+)?timezone=UTC(?:\s|$)/i.test(options)) {
    url.searchParams.set('options', `${options} -c timezone=UTC`);
  }
  return url.toString();
}
