export function createLogger(scope = 'app') {
  return {
    info(message, meta = {}) {
      console.info(JSON.stringify({ level: 'info', scope, message, meta, timestamp: new Date().toISOString() }));
    },
    warn(message, meta = {}) {
      console.warn(JSON.stringify({ level: 'warn', scope, message, meta, timestamp: new Date().toISOString() }));
    },
    error(message, meta = {}) {
      console.error(JSON.stringify({ level: 'error', scope, message, meta, timestamp: new Date().toISOString() }));
    },
  };
}

export function captureMetric(name, value, tags = {}) {
  if (typeof window !== 'undefined') {
    window.__FUNDED_METRICS__ = window.__FUNDED_METRICS__ || {};
    window.__FUNDED_METRICS__[name] = { value, tags, timestamp: new Date().toISOString() };
  }
  return { name, value, tags, timestamp: new Date().toISOString() };
}
