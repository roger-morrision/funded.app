// Read a bounded JSON object without destroying the socket before an error response.
export function readJsonBody(req, { maxBytes = 1_000_000, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    const failure = (message, statusCode) => Object.assign(new Error(message), { statusCode });
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('aborted', aborted);
      req.removeListener('error', error);
    };
    const fail = err => { cleanup(); req.pause(); reject(err); };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) return fail(failure('Request body too large.', 413));
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      try {
        const value = bytes ? JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) : {};
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        resolve(value);
      } catch { reject(failure('Request body must contain a valid JSON object.', 400)); }
    };
    const aborted = () => fail(failure('Request was interrupted.', 400));
    const error = () => fail(failure('Request body could not be read.', 400));
    const timer = setTimeout(() => fail(failure('Request body timed out.', 408)), timeoutMs);
    timer.unref?.();
    req.on('data', data);
    req.once('end', end);
    req.once('aborted', aborted);
    req.once('error', error);
    if (Number(req.headers?.['content-length']) > maxBytes) fail(failure('Request body too large.', 413));
    else if (req.headers?.['content-encoding'] && req.headers['content-encoding'] !== 'identity') fail(failure('Compressed request bodies are not supported.', 415));
  });
}
