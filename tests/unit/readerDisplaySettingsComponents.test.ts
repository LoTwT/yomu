import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'

import {
  createInteractionLayerController,
  interactionLayerKey,
} from '@/app/interactionLayer'
import ReaderDisplaySettings from '@/components/reader/ReaderDisplaySettings.vue'
import ReaderSettingsOverlay, {
  type ReaderSettingsCloseReason,
} from '@/components/reader/ReaderSettingsOverlay.vue'
import type { ArticleRecord } from '@/data/entities'

const mountedApps: Array<ReturnType<typeof createApp>> = []

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.replaceChildren()
})

describe('reader display settings components', () => {
  it('describes session-backed preference updates without claiming device durability', async () => {
    const fontScales: number[] = []
    const translationDefaults: boolean[] = []
    const ipaValues: boolean[] = []
    const host = mountComponent(ReaderDisplaySettings, {
      defaultExpandTranslation: false,
      fontScale: 1,
      persistence: 'session',
      persistenceStatus: 'saved',
      showIpa: false,
      'onUpdate:defaultExpandTranslation': (value: boolean) => {
        translationDefaults.push(value)
      },
      'onUpdate:fontScale': (value: number) => {
        fontScales.push(value)
      },
      'onUpdate:showIpa': (value: boolean) => {
        ipaValues.push(value)
      },
    })

    expect(host.textContent).toContain('打开文章时展开译文')
    expect(host.textContent).not.toContain('本次阅读显示 IPA')
    expect(host.textContent).toContain('字号与译文偏好仅在本次会话中保留')
    expect(host.textContent).not.toContain('已保存到此设备')

    const largerScale = host.querySelector<HTMLInputElement>('input[type="radio"][value="1.15"]')
    expect(largerScale).not.toBeNull()
    largerScale!.checked = true
    largerScale!.dispatchEvent(new Event('change', { bubbles: true }))

    const translation = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(translation).not.toBeNull()
    translation!.checked = true
    translation!.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(fontScales).toEqual([1.15])
    expect(translationDefaults).toEqual([true])
    expect(ipaValues).toEqual([])
  })

  it('labels a successful device-backed preference update as saved on this device', () => {
    const host = mountComponent(ReaderDisplaySettings, {
      defaultExpandTranslation: false,
      fontScale: 1,
      persistence: 'device',
      persistenceStatus: 'saved',
      showIpa: false,
    })

    expect(host.textContent).toContain('字号与译文偏好已保存到此设备')
  })

  it('exposes the selected font scale through the native radio state and its option', () => {
    const host = mountComponent(ReaderDisplaySettings, {
      defaultExpandTranslation: false,
      fontScale: 1.15,
      persistence: 'session',
      showIpa: false,
    })

    const radios = Array.from(host.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    const selectedRadio = radios.find(radio => radio.checked)

    expect(radios).toHaveLength(4)
    expect(selectedRadio?.value).toBe('1.15')
    expect(selectedRadio?.closest('label')?.classList)
      .toContain('reader-display-settings__scale-option--selected')
    expect(host.querySelectorAll('.reader-display-settings__scale-option--selected'))
      .toHaveLength(1)
  })

  it('only exposes assistance supported by the derived article capabilities', () => {
    const noAssistance = mountComponent(ReaderDisplaySettings, {
      articleCapabilities: capabilities('none', 'none'),
      defaultExpandTranslation: false,
      fontScale: 1,
      persistence: 'session',
      showIpa: false,
    })
    expect(noAssistance.textContent).not.toContain('阅读辅助')

    const availableAssistance = mountComponent(ReaderDisplaySettings, {
      articleCapabilities: capabilities('partial', 'complete'),
      defaultExpandTranslation: false,
      fontScale: 1,
      persistence: 'session',
      showIpa: false,
    })
    expect(availableAssistance.textContent).toContain('打开文章时展开译文')
    expect(availableAssistance.textContent).toContain('本次阅读显示 IPA')
  })

  it('registers one native modal layer and restores explicit focus after system close', async () => {
    const interactionLayer = createInteractionLayerController()
    const focusReturn = document.createElement('button')
    focusReturn.textContent = '阅读设置'
    document.body.append(focusReturn)
    focusReturn.focus()

    const open = shallowRef(true)
    const closeReasons: ReaderSettingsCloseReason[] = []
    const Root = defineComponent({
      setup: () => () => open.value
        ? h(ReaderSettingsOverlay, {
            articleCapabilities: capabilities('partial', 'partial'),
            defaultExpandTranslation: false,
            focusReturn,
            fontScale: 1,
            persistence: 'session',
            showIpa: false,
            onClose: (reason: ReaderSettingsCloseReason) => {
              closeReasons.push(reason)
              open.value = false
            },
          })
        : null,
    })

    const app = createApp(Root)
    mountedApps.push(app)
    app.provide(interactionLayerKey, interactionLayer)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)
    await nextTick()
    await nextTick()

    const dialog = host.querySelector<HTMLDialogElement>('dialog')
    const heading = host.querySelector<HTMLHeadingElement>('#reader-settings-heading')
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.hasAttribute('data-modal-fallback')).toBe(true)
    expect(focusReturn.hasAttribute('inert')).toBe(true)
    expect(document.activeElement).toBe(heading)
    expect(interactionLayer.activeLayerId.value).toBe('reader-settings')

    expect(interactionLayer.requestCloseTop('system-back')).toBe(true)
    await nextTick()
    await nextTick()

    expect(closeReasons).toEqual(['system-back'])
    expect(host.querySelector('dialog')).toBeNull()
    expect(focusReturn.hasAttribute('inert')).toBe(false)
    expect(interactionLayer.activeLayerId.value).toBeNull()
    expect(document.activeElement).toBe(focusReturn)
  })

  it('does not steal focus when it closes before the initial-focus tick', async () => {
    const interactionLayer = createInteractionLayerController()
    const focusReturn = document.createElement('button')
    document.body.append(focusReturn)
    focusReturn.focus()

    const open = shallowRef(true)
    const Root = defineComponent({
      setup: () => () => open.value
        ? h(ReaderSettingsOverlay, {
            defaultExpandTranslation: false,
            focusReturn,
            fontScale: 1,
            persistence: 'session',
            showIpa: false,
            onClose: () => {
              open.value = false
            },
          })
        : null,
    })
    const app = createApp(Root)
    mountedApps.push(app)
    app.provide(interactionLayerKey, interactionLayer)
    const host = document.createElement('div')
    document.body.append(host)
    app.mount(host)

    expect(interactionLayer.requestCloseTop('navigation')).toBe(true)
    await nextTick()
    await nextTick()

    expect(host.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(focusReturn)
  })
})

function capabilities(
  sentenceTranslation: ArticleRecord['capabilities']['sentenceTranslation'],
  sentenceIpa: ArticleRecord['capabilities']['sentenceIpa'],
): ArticleRecord['capabilities'] {
  return {
    sentenceTranslation,
    sentenceIpa,
    tokenMeaning: 'none',
  }
}

function mountComponent(
  component: Parameters<typeof h>[0],
  props: Record<string, unknown>,
): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(component, props),
  })
  mountedApps.push(app)
  app.mount(host)
  return host
}
