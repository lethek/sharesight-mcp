/** A page of results with a pagination block, as the list tools return them */
interface Page {
  pagination: { next_cursor: string | null };
}

/**
 * Follows next_cursor from a first page to the last, returning every page in order. The guard stops a walk that never ends, so a bug
 * in a cursor fails the test instead of hanging it.
 */
export async function walkPages<P extends Page>(first: P, next: (cursor: string) => Promise<P>, guard = 50): Promise<P[]> {
  const pages = [first];

  for (let i = 0; pages[pages.length - 1].pagination.next_cursor && i < guard; i++) {
    pages.push(await next(pages[pages.length - 1].pagination.next_cursor!));
  }

  return pages;
}
