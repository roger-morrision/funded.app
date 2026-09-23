export function isAppPagePath(pathname) {
  return pathname === '/' || /^\/explore\/?$/.test(pathname) || /^\/creator\/x\/\d{1,24}\/?$/.test(pathname)
    || /^\/(?:token|launch\/coin|wallet)\/[1-9A-HJ-NP-Za-km-z]{32,44}\/?$/.test(pathname);
}
