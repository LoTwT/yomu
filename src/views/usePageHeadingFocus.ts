import { onMounted, useTemplateRef } from 'vue'

export function usePageHeadingFocus(): void {
  const heading = useTemplateRef<HTMLElement>('pageHeading')

  onMounted(() => {
    heading.value?.focus({ preventScroll: true })
  })
}
