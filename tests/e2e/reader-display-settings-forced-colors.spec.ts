import { expect, test } from '@playwright/test'

test.describe('Reader display settings in forced colors', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium forced-colors coverage')

  test('keeps the selected font scale visible and distinguishable', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await page.goto('/settings')

    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)

    const fontScaleGroup = page.getByRole('group', { name: '正文字号' })
    const radios = fontScaleGroup.getByRole('radio')
    const standardRadio = fontScaleGroup.getByRole('radio', { name: /标准/ })
    const smallerRadio = fontScaleGroup.getByRole('radio', { name: /较小/ })

    await expect(radios).toHaveCount(4)
    await expect(standardRadio).toBeVisible()
    await expect(standardRadio).toBeChecked()
    await expect(smallerRadio).toBeVisible()
    await expect(smallerRadio).not.toBeChecked()

    const radioPresentation = await standardRadio.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      const styles = getComputedStyle(element)
      return {
        clipPath: styles.clipPath,
        height: bounds.height,
        position: styles.position,
        width: bounds.width,
      }
    })
    expect(radioPresentation.height).toBeGreaterThanOrEqual(16)
    expect(radioPresentation.width).toBeGreaterThanOrEqual(16)
    expect(radioPresentation.clipPath).toBe('none')
    expect(radioPresentation.position).toBe('static')
    const selectedStyles = await standardRadio.evaluate((element) => {
      const styles = getComputedStyle(element.closest('label')!)
      return {
        outlineStyle: styles.outlineStyle,
        outlineWidth: styles.outlineWidth,
      }
    })
    expect(selectedStyles).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' })
    expect(await smallerRadio.evaluate((element) =>
      getComputedStyle(element.closest('label')!).outlineStyle)).toBe('none')

    const extraLargeRadio = fontScaleGroup.getByRole('radio', { name: /特大/ })
    await extraLargeRadio.check()
    await expect(extraLargeRadio).toBeVisible()
    await expect(extraLargeRadio).toBeChecked()
    await expect(standardRadio).not.toBeChecked()
  })
})
