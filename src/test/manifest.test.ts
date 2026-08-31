import { describe, expect, it } from 'vitest'

import manifestExport from '../../manifest.config'

/**
 * Permissions are a design decision, not an implementation detail: the base build lives
 * on `activeTab`, and the only heavy thing it can ask for is host access, one site at a
 * time. The test pins this property because "just add a host" is the easiest way to make
 * store review heavier.
 */
const manifest = manifestExport as unknown as chrome.runtime.ManifestV3

describe('manifest', () => {
  it('asks for no host permissions at install time', () => {
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.permissions).not.toContain('<all_urls>')
  })

  it('declares no static content scripts, so nothing runs before the user acts', () => {
    expect(manifest.content_scripts).toBeUndefined()
  })

  /**
   * v1.0 ships without the recorder, so it ships without the permissions the recorder
   * would need — in either list. Declaring them early costs a heavier first review and
   * buys nothing, because no call site requests them. Phase 7 puts
   * `tabCapture` and `desktopCapture` back into optional_*, and the batch capture puts
   * `tabs` there; until then this test is what keeps them out.
   */
  it('declares no permission the code never requests', () => {
    for (const permission of ['tabCapture', 'desktopCapture', 'tabs']) {
      expect(manifest.permissions).not.toContain(permission)
      expect(manifest.optional_permissions ?? []).not.toContain(permission)
    }
  })

  /**
   * Chrome refuses to treat `debugger` as optional and drops it from the manifest with
   * a warning. Keeping it required would show everyone a debugging warning at install;
   * a decision like that is made explicitly, not slipped in with someone's commit.
   */
  it('does not ask for the debugger permission at all', () => {
    expect(manifest.permissions).not.toContain('debugger')
    expect(manifest.optional_permissions ?? []).not.toContain('debugger')
  })

  /**
   * Local OCR compiles WebAssembly, which MV3 forbids without an explicit allowance.
   * The reverse is checked too: `unsafe-eval` did not appear next to it — that is a
   * different permission entirely and a very different review conversation.
   */
  it('allows WebAssembly, and nothing wider', () => {
    const csp = manifest.content_security_policy?.extension_pages ?? ''

    expect(csp).toContain("'wasm-unsafe-eval'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toContain("'unsafe-inline'")
  })

  it('stays within the four hotkeys Chrome allows to carry a suggested key', () => {
    const suggested = Object.values(manifest.commands ?? {}).filter(
      (command) => command.suggested_key,
    )
    expect(suggested.length).toBeLessThanOrEqual(4)
  })

  it('is localised through _locales', () => {
    expect(manifest.default_locale).toBe('en')
    expect(manifest.name).toMatch(/^__MSG_/)
    expect(manifest.description).toMatch(/^__MSG_/)
  })
})
