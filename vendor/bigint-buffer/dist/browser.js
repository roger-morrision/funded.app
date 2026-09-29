function assertWidth(width) {
  if (!Number.isSafeInteger(width) || width < 0) throw new RangeError('width must be a non-negative safe integer');
}

function assertBuffer(value) {
  if (!(value instanceof Uint8Array)) throw new TypeError('buffer must be a Buffer or Uint8Array');
}

export function toBigIntBE(buffer) {
  assertBuffer(buffer);
  if (buffer.length === 0) return 0n;
  return BigInt(`0x${Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('')}`);
}

export function toBigIntLE(buffer) {
  assertBuffer(buffer);
  if (buffer.length === 0) return 0n;
  return toBigIntBE(Uint8Array.from(buffer).reverse());
}

export function toBufferBE(value, width) {
  assertWidth(width);
  if (typeof value !== 'bigint') throw new TypeError('value must be a bigint');
  if (width === 0) return new Uint8Array(0);
  if (value < 0n) throw new RangeError('value must be non-negative');
  const mask = (1n << BigInt(width * 8)) - 1n;
  const hex = (value & mask).toString(16).padStart(width * 2, '0');
  return Uint8Array.from({ length: width }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

export function toBufferLE(value, width) {
  return Uint8Array.from(toBufferBE(value, width)).reverse();
}
