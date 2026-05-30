export function createStableTextHash(text: string): string {
  const normalized = text.normalize('NFKC')
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.codePointAt(index) ?? 0)
    hash = (hash * prime) & mask

    const codePoint = normalized.codePointAt(index)
    if (codePoint && codePoint > 0xffff) {
      index += 1
    }
  }

  return hash.toString(16).padStart(16, '0')
}
