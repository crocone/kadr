import { defineManifest } from '@crxjs/vite-plugin'

import pkg from './package.json' with { type: 'json' }

/**
 * The base permission set is deliberately narrow: `activeTab` is granted on icon
 * click, context-menu item, and hotkey — which covers every capture entry point.
 * The one heavy thing left is host access: it is optional, and it is asked for one
 * site at a time, at the moment a button actually needs it.
 */
export default defineManifest({
  manifest_version: 3,
  name: '__MSG_extName__',
  description: '__MSG_extDescription__',
  version: pkg.version,
  default_locale: 'en',
  minimum_chrome_version: '124',

  icons: {
    16: 'assets/icons/icon-16.png',
    32: 'assets/icons/icon-32.png',
    48: 'assets/icons/icon-48.png',
    128: 'assets/icons/icon-128.png',
  },

  action: {
    default_title: '__MSG_extName__',
    default_popup: 'src/popup/index.html',
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },

  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'unlimitedStorage',
    'downloads',
    // The content script writes to the clipboard on an overlay button click; without
    // this permission a page's own permissions-policy could deny it.
    'clipboardWrite',
    'contextMenus',
  ],

  // `debugger` cannot go here: Chrome answers "cannot be listed as optional" and
  // silently drops it from the manifest. So the high-fidelity mode
  // must either be a required permission with an install-time warning or not exist —
  // to be decided in phase 4; until then it's absent.
  //
  // There is no `optional_permissions` at all in v1.0, and that is deliberate. `tabCapture`
  // and `desktopCapture` belong to the recorder, which is phase 7 and ships as a separate
  // update to an already-approved extension; `tabs` belongs to the multi-tab
  // batch capture, which is not written either. An optional permission that no call site
  // ever requests is a question at review with no answer behind it — and for these two
  // in particular, the answer costs weeks of moderation.

  optional_host_permissions: ['<all_urls>'],

  /**
   * `wasm-unsafe-eval` is required by local OCR: without it Chrome refuses to compile
   * WebAssembly and recognition fails before the first letter.
   *
   * The name is scary but the grant is narrow: it allows executing wasm and nothing
   * else — `unsafe-eval` with its `eval()` and strings-as-code stays forbidden. The
   * only module compiled is the one shipped inside the package.
   */
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },

  // No web_accessible_resources on purpose. The content script is bundled as a
  // self-contained IIFE (`?iife`) and injected via chrome.scripting under activeTab:
  // the extension supplies its own file, so nothing needs to be exposed to the page.
  // As a bonus, pages cannot probe our resources to fingerprint the extension.

  commands: {
    'capture-fullpage': {
      suggested_key: { default: 'Alt+Shift+F' },
      description: '__MSG_cmdCaptureFullPage__',
    },
    'capture-visible': {
      suggested_key: { default: 'Alt+Shift+V' },
      description: '__MSG_cmdCaptureVisible__',
    },
    'capture-area': {
      suggested_key: { default: 'Alt+Shift+A' },
      description: '__MSG_cmdCaptureArea__',
    },
    'capture-element': {
      suggested_key: { default: 'Alt+Shift+E' },
      description: '__MSG_cmdCaptureElement__',
    },
    // No `suggested_key`: Chrome allows suggested shortcuts for only four commands;
    // the rest are assigned manually at chrome://extensions/shortcuts.
    'capture-scroll': { description: '__MSG_cmdCaptureScroll__' },
  },
})
