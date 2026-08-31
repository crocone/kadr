import { CAPTURE_COMMANDS, type CaptureMode } from '@/core/messaging'

const PARENT_ID = 'kadr-root'

const ITEMS: { id: string; mode: CaptureMode; title: Record<'en' | 'ru', string> }[] = [
  { id: 'capture-fullpage', mode: 'fullPage', title: { en: 'Full page', ru: 'Вся страница' } },
  { id: 'capture-visible', mode: 'visible', title: { en: 'Visible area', ru: 'Видимая область' } },
  { id: 'capture-area', mode: 'area', title: { en: 'Select area', ru: 'Выделить область' } },
  { id: 'capture-element', mode: 'element', title: { en: 'Pick element', ru: 'Выбрать элемент' } },
  {
    id: 'capture-scroll',
    mode: 'scroll',
    title: { en: 'Scrolling capture', ru: 'Снять со скроллом' },
  },
]

/**
 * Menu items are created with a callback so that `chrome.runtime.lastError` gets read.
 *
 * Without the callback Chrome logs it itself — "Unchecked runtime.lastError" in the
 * extension's error list. The error is real, but the fix is the queue below, not
 * silence; what matters here is that it never goes unread.
 */
function createItem(props: chrome.contextMenus.CreateProperties): Promise<void> {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      const failure = chrome.runtime.lastError
      if (failure) console.warn('[kadr] context menu item', props.id, failure.message)
      resolve()
    })
  })
}

async function build(): Promise<void> {
  const lang = chrome.i18n.getUILanguage().toLowerCase().startsWith('ru') ? 'ru' : 'en'

  await chrome.contextMenus.removeAll()
  await createItem({
    id: PARENT_ID,
    title: 'Kadr',
    contexts: ['page', 'selection', 'image', 'link'],
  })
  for (const item of ITEMS) {
    await createItem({
      id: item.id,
      parentId: PARENT_ID,
      title: item.title[lang],
      contexts: ['page', 'selection', 'image', 'link'],
    })
  }
}

/**
 * Menu items are one of the entry points granting `activeTab`, which is how the base
 * build gets by without host permissions (PLAN.md §8).
 *
 * Builds are queued, not run in parallel. On a browser update `onInstalled` and
 * `onStartup` arrive almost simultaneously, and two calls used to interleave: both
 * removed the menu, both started creating — and the second ran into items the first had
 * just created. Hence "Cannot create item with duplicate id" for every single id.
 */
let pending: Promise<void> = Promise.resolve()

export function createContextMenus(): Promise<void> {
  pending = pending.then(build, build)
  return pending
}

export function captureModeForMenuItem(menuItemId: string | number): CaptureMode | undefined {
  return CAPTURE_COMMANDS[String(menuItemId)]
}
