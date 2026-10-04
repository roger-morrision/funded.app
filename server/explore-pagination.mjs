import { invalidRequest } from './http-policy.mjs';

export function explorePagination(searchParams) {
  const read = (name, fallback, minimum, maximum) => {
    const values = searchParams.getAll(name);
    if (!values.length) return fallback;
    if (values.length !== 1 || !/^\d+$/.test(values[0]) || !Number.isSafeInteger(Number(values[0]))) {
      throw invalidRequest(`${name} must be supplied once as a non-negative safe integer in decimal digits.`);
    }
    return Math.min(maximum, Math.max(minimum, Number(values[0])));
  };
  return { limit: read('limit', 40, 1, 100), offset: read('offset', 0, 0, 10_000) };
}
