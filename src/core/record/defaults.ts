/**
 * What a clip looks like the moment recording stops, before anyone has touched it.
 *
 * Nothing is cut, nothing is sped up, and the camera does not move — auto-zoom is
 * offered by the editor, not applied behind the user's back. A recording that opens
 * already re-framed by a machine is a recording nobody trusts.
 *
 * The click rings are the one thing that is on from the start: they mark something the
 * captured frame has no way of showing by itself.
 */
import { DEFAULT_BACKGROUND, shadowFromPreset } from '@/core/doc/defaults'

import type { ClickStyle, Clip, ClipDecoration, ClipEdit, SoundEdit } from './types'

export const DEFAULT_CLICKS: ClickStyle = {
  show: true,
  color: '#6d5cf5',
  size: 0.06,
  duration: 520,
}

/**
 * Padding is a third of the screenshot editor's: a video is watched at its own size,
 * and a 64-px frame around a 1080p clip is a smaller video, not a nicer one.
 */
export const DEFAULT_DECORATION: ClipDecoration = {
  background: DEFAULT_BACKGROUND,
  padding: 0,
  radius: 0,
  shadow: shadowFromPreset('none'),
  frame: { style: 'none', theme: 'light', url: '', showUrl: true },
}

export function defaultSound(duration: number): SoundEdit {
  return {
    muted: false,
    trim: { start: 0, end: Math.max(0, duration) },
    silences: [],
  }
}

export function defaultEdit(duration: number): ClipEdit {
  return {
    trim: { start: 0, end: Math.max(0, duration) },
    speed: 1,
    crop: null,
    cuts: [],
    zooms: [],
    clicks: { ...DEFAULT_CLICKS },
    sound: defaultSound(duration),
  }
}

/**
 * A record written before the sound edit existed. IndexedDB hands records back exactly
 * as stored, so the field is filled in on the way out rather than by a migration pass
 * over every clip.
 */
export function upgradeClip(clip: Clip): Clip {
  const edit = clip.edit as Partial<ClipEdit> & Omit<ClipEdit, 'sound'>
  if (edit.sound) return clip
  return { ...clip, edit: { ...edit, sound: defaultSound(clip.duration) } }
}
