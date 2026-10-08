export async function mapBounded(items, limit, mapper) {
  if (!Array.isArray(items) || !Number.isSafeInteger(limit) || limit < 1 || typeof mapper !== 'function')
    throw new TypeError('A list, positive concurrency limit, and mapper are required.');
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}
