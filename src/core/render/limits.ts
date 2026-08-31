/**
 * Chrome canvas limits: roughly 268M pixels of area and 65,535 per side. We keep a
 * margin — better to hit the limit honestly and say so than get an empty frame
 * (PLAN.md §10).
 */
export const MAX_CANVAS_SIDE = 32_767
export const MAX_CANVAS_AREA = 178_956_970

/**
 * Clipboard limit. A scrolled full-page capture easily weighs tens of megabytes, and
 * clipboards handle that inconsistently: some silently drop the image, some hang the
 * paste in the receiving app for minutes. Better to refuse honestly and offer a file
 * than hand over something that won't paste.
 */
export const MAX_CLIPBOARD_BYTES = 32 * 1024 * 1024
