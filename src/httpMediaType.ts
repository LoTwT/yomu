const mediaTypeEssencePattern = /^[^\s/;]+\/[^\s/;]+$/

export function getHttpMediaTypeEssence(value: string | null | undefined): string {
  const essence = value?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return mediaTypeEssencePattern.test(essence) ? essence : ''
}

export function isHttpMediaType(
  value: string | null | undefined,
  allowedEssences: ReadonlySet<string>,
): boolean {
  return allowedEssences.has(getHttpMediaTypeEssence(value))
}
