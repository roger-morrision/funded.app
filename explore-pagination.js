export function paginateExploreRows(records, requestedPage, pageSize = 10) {
  const total = records.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(requestedPage) || 1)));
  const start = (page - 1) * pageSize;
  const rows = records.slice(start, start + pageSize);
  return { page, pages, start, end: start + rows.length, total, rows };
}

export function explorePageNumbers(currentPage, totalPages, visibleCount = 5) {
  const pages = Math.max(1, Math.trunc(Number(totalPages) || 1));
  const current = Math.min(pages, Math.max(1, Math.trunc(Number(currentPage) || 1)));
  const count = Math.max(1, Math.trunc(Number(visibleCount) || 1));
  const start = Math.max(1, Math.min(current - Math.floor(count / 2), pages - count + 1));
  return Array.from({ length: Math.min(count, pages) }, (_, index) => start + index);
}
