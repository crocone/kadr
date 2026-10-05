/**
 * The recorder's permissions, asked for on the button that needs them.
 *
 * `tabCapture` and `desktopCapture` are optional for one reason: in the install dialog
 * they read as "this extension can see your screen", and the extension that says that
 * up front is the extension nobody installs to crop a screenshot. Asked at the moment
 * someone presses "record", the same prompt is obvious and expected.
 *
 * Like the host permissions next door, these only work inside a user gesture — Chrome
 * rejects `permissions.request` otherwise, and the service worker never has one. So the
 * chain starts in the popup, and the worker only ever checks that the grant exists.
 */
import type { RecordSource } from '@/core/record/types'

/** Tab capture and screen capture are different permissions and different prompts. */
export function permissionFor(source: RecordSource): chrome.runtime.ManifestPermissions {
  return source === 'tab' ? 'tabCapture' : 'desktopCapture'
}

export async function hasRecordingPermission(source: RecordSource): Promise<boolean> {
  return await chrome.permissions.contains({ permissions: [permissionFor(source)] })
}

/**
 * Returns `false` rather than throwing: declining is an answer, not a failure. The
 * popup shows a line about what recording needs and stays open.
 */
export async function ensureRecordingPermission(source: RecordSource): Promise<boolean> {
  const permissions = [permissionFor(source)]
  if (await chrome.permissions.contains({ permissions })) return true

  try {
    return await chrome.permissions.request({ permissions })
  } catch {
    return false
  }
}

/** Settings page: shown so a granted recording permission can be taken back. */
export async function dropRecordingPermission(source: RecordSource): Promise<void> {
  await chrome.permissions.remove({ permissions: [permissionFor(source)] })
}

/**
 * Whether the microphone has already been allowed for the extension.
 *
 * Asked before a recording starts rather than during it: the document that records a
 * tab cannot show the prompt, so an unanswered question there is a refusal. When this
 * says no, the question is put from a window of ours first — see `src/mic`.
 */
export async function hasMicrophonePermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' })
    return status.state === 'granted'
  } catch {
    return false
  }
}
