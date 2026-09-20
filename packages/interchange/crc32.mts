const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** Incremental ZIP/GZIP CRC state; initialise and finalise with 0xffffffff. */
export function updateCrc32(state: number, bytes: Uint8Array): number {
  let next = state >>> 0;
  for (const byte of bytes) next = TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8);
  return next >>> 0;
}
