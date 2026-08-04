import { expect, test } from '@playwright/test'

const responsiveViewports = [
  { name: 'compact', width: 390, height: 844 },
  { name: 'medium', width: 900, height: 900 },
] as const

for (const viewport of responsiveViewports) {
  test(`${viewport.name} shell keeps action order and touch targets aligned`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('.shell-actions')).toBeVisible()

    const metrics = await page.evaluate(() => {
      const actions = [...document.querySelectorAll<HTMLAnchorElement>('.shell-actions__link')]
      const touchTargets = [
        ...document.querySelectorAll<HTMLElement>(
          '.brand-link, .primary-nav__link, .shell-actions__link, .continue-card__button, .article-object__link, .recommendation-card__link',
        ),
      ]

      return {
        actionHrefs: actions.map(link => new URL(link.href).pathname),
        actionLeftEdges: actions.map(link => link.getBoundingClientRect().left),
        targetHeights: touchTargets.map(target => target.getBoundingClientRect().height),
      }
    })

    expect(metrics.actionHrefs).toEqual(['/import', '/settings'])
    expect(metrics.actionLeftEdges[0]).toBeLessThan(metrics.actionLeftEdges[1]!)
    expect(metrics.targetHeights.length).toBeGreaterThan(0)
    expect(Math.min(...metrics.targetHeights)).toBeGreaterThanOrEqual(44)
  })
}

test('unavailable links and unknown article ids never display the Today body', async ({ page }) => {
  await page.goto('/')
  const unavailableArticle = page.locator('.article-object__link').first()
  await expect(unavailableArticle).toHaveAttribute('aria-label', /尚未接入/)
  await unavailableArticle.click()

  await expect(page).toHaveURL(/\/unavailable\/power-of-small-habits$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('这篇文章还不能打开')
  await expect(page.getByText('Why the Brain Loves Sleep')).toHaveCount(0)

  await page.goto('/read/not-integrated')

  await expect(page).toHaveURL(/\/unavailable\/not-integrated$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('这篇文章还不能打开')
  await expect(page.getByText('Yomu 不会用其他正文代替它')).toBeVisible()
  await expect(page.getByText('Why the Brain Loves Sleep')).toHaveCount(0)
})
