import type { SVGProps } from 'react'

/**
 * UI icons. Drawn in code to match the design language: 1.5 stroke, round caps,
 * 20×20 grid — so the set looks like a set, not scavenged symbols. No third-party
 * icon fonts or sprites in the repo.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconCursor = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 3l11 6.2-4.8 1.3-1.7 4.7z" />
  </Icon>
)

export const IconText = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 5h11M10 5v10M7.5 15h5" />
  </Icon>
)

export const IconArrow = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 15L15 5M9 5h6v6" />
  </Icon>
)

export const IconRect = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="13" height="10" rx="2" />
  </Icon>
)

export const IconEllipse = (props: IconProps) => (
  <Icon {...props}>
    <ellipse cx="10" cy="10" rx="6.5" ry="5" />
  </Icon>
)

export const IconCallout = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5h12a1.5 1.5 0 011.5 1.5v5a1.5 1.5 0 01-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 012.5 12V7A1.5 1.5 0 014 5.5z" />
  </Icon>
)

export const IconBadge = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M9 8l1.5-1v6M9 13h3" strokeWidth={1.3} />
  </Icon>
)

export const IconEmoji = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M7.5 12c.7.8 1.6 1.2 2.5 1.2s1.8-.4 2.5-1.2" />
    <path d="M7.7 8.2h.01M12.3 8.2h.01" strokeWidth={2} />
  </Icon>
)

export const IconSpotlight = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="4" />
    <path d="M10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.4 4.4l1.3 1.3M14.3 14.3l1.3 1.3M15.6 4.4l-1.3 1.3M5.7 14.3l-1.3 1.3" />
  </Icon>
)

export const IconBlur = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="13" height="10" rx="2" />
    <path d="M6 8.5h2M10 8.5h1M13 8.5h1M6 11.5h1M9 11.5h2M13.5 11.5h.5" strokeWidth={1.6} />
  </Icon>
)

export const IconPen = (props: IconProps) => (
  <Icon {...props}>
    <path d="M14.2 3.8l2 2-9 9-2.8.8.8-2.8z" />
  </Icon>
)

export const IconHighlighter = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6 12.5l5.5-5.5 2.5 2.5L8.5 15H6z" />
    <path d="M4 17.5h12" strokeWidth={2} />
  </Icon>
)

export const IconCrop = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 2.5v12h12M2.5 5.5h12v12" />
  </Icon>
)

export const IconUndo = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7 7H4V4M4.2 7A6 6 0 1110 16" />
  </Icon>
)

export const IconRedo = (props: IconProps) => (
  <Icon {...props}>
    <path d="M13 7h3V4M15.8 7A6 6 0 1010 16" />
  </Icon>
)

export const IconCopy = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
    <path d="M13 4.5H5.5A1.5 1.5 0 004 6v7.5" />
  </Icon>
)

export const IconDownload = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3v9M6.5 9l3.5 3.5L13.5 9M4 16h12" />
  </Icon>
)

export const IconSettings = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="10" r="2.4" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M15.4 4.6L14 6M6 14l-1.4 1.4" />
  </Icon>
)

export const IconEye = (props: IconProps) => (
  <Icon {...props}>
    <path d="M1.8 10S4.9 5 10 5s8.2 5 8.2 5-3.1 5-8.2 5-8.2-5-8.2-5z" />
    <circle cx="10" cy="10" r="2.2" />
  </Icon>
)

export const IconEyeOff = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 4l12 12" />
    <path d="M7.4 7.5A9.9 9.9 0 001.8 10s3.1 5 8.2 5c1.4 0 2.6-.4 3.7-.9M8.5 5.2A8 8 0 0110 5c5.1 0 8.2 5 8.2 5a15 15 0 01-2.3 2.7" />
  </Icon>
)

export const IconLock = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
    <path d="M7 8.5V6.5a3 3 0 016 0v2" />
  </Icon>
)

export const IconUnlock = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4.5" y="8.5" width="11" height="8" rx="2" />
    <path d="M7 8.5V6.5a3 3 0 015.6-1.5" />
  </Icon>
)

export const IconDuplicate = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
    <rect x="3.5" y="3.5" width="9.5" height="9.5" rx="2" />
  </Icon>
)

export const IconClose = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icon>
)

export const IconVisible = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <path d="M2.5 8h15" />
  </Icon>
)

export const IconFullPage = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4.5" y="2.5" width="11" height="15" rx="2" />
    <path d="M10 6v8M7.5 11.5L10 14l2.5-2.5" />
  </Icon>
)

export const IconArea = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3 6.5V4a1 1 0 011-1h2.5M17 6.5V4a1 1 0 00-1-1h-2.5M3 13.5V16a1 1 0 001 1h2.5M17 13.5V16a1 1 0 01-1 1h-2.5" />
    <path d="M7 10h6" />
  </Icon>
)

export const IconElement = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="9" height="9" rx="1.5" />
    <path d="M10.5 10.5L17 17M17 12.5V17h-4.5" />
  </Icon>
)

/**
 * Alignment. The line is the canvas edge or middle, the two rectangles are the object
 * snapping to it: one glyph shows exactly where the selection will go.
 */
export const IconAlignLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 3.5v13" />
    <rect x="7" y="5.5" width="9" height="3.5" rx="1" />
    <rect x="7" y="11" width="6" height="3.5" rx="1" />
  </Icon>
)

export const IconAlignCentreX = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 3.5v13" />
    <rect x="4" y="5.5" width="12" height="3.5" rx="1" />
    <rect x="6.5" y="11" width="7" height="3.5" rx="1" />
  </Icon>
)

export const IconAlignRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 3.5v13" />
    <rect x="4" y="5.5" width="9" height="3.5" rx="1" />
    <rect x="7" y="11" width="6" height="3.5" rx="1" />
  </Icon>
)

export const IconAlignTop = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 4h13" />
    <rect x="5.5" y="7" width="3.5" height="9" rx="1" />
    <rect x="11" y="7" width="3.5" height="6" rx="1" />
  </Icon>
)

export const IconAlignCentreY = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 10h13" />
    <rect x="5.5" y="4" width="3.5" height="12" rx="1" />
    <rect x="11" y="6.5" width="3.5" height="7" rx="1" />
  </Icon>
)

export const IconAlignBottom = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 16h13" />
    <rect x="5.5" y="4" width="3.5" height="9" rx="1" />
    <rect x="11" y="7" width="3.5" height="6" rx="1" />
  </Icon>
)

/** Eraser: a tilted block and the table line it runs along. */
export const IconEraser = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8.5 16H16" />
    <path d="M4.2 12.2l5-5a1.6 1.6 0 0 1 2.3 0l3.3 3.3a1.6 1.6 0 0 1 0 2.3l-3.2 3.2H7.4l-3.2-3.2a1.6 1.6 0 0 1 0-2.3Z" />
    <path d="M7.6 9.1l4.9 4.9" />
  </Icon>
)

export const IconEyedropper = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12.4 4.6a2 2 0 0 1 2.9 2.8l-1.2 1.2 1 1-1.4 1.4-1-1-5 5-2.9.6.6-2.9 5-5-1-1 1.4-1.4 1 1Z" />
  </Icon>
)

export const IconPlus = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
)

/** Raise layer: arrow toward the top edge. */
export const IconRaise = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 15.5V5m0 0L6 9m4-4 4 4" />
    <path d="M4.5 3h11" />
  </Icon>
)

export const IconLower = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10 4.5V15m0 0 4-4m-4 4-4-4" />
    <path d="M4.5 17h11" />
  </Icon>
)

/** Responsive series: three screens of different widths in a row. */
export const IconResponsive = (props: IconProps) => (
  <Icon {...props}>
    <rect x="2.5" y="5" width="4" height="10" rx="1" />
    <rect x="8" y="3.5" width="4.5" height="13" rx="1" />
    <rect x="14" y="6.5" width="3.5" height="7" rx="1" />
  </Icon>
)

/** Library: a stack of frames. */
export const IconLibrary = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="6" width="14" height="10" rx="1.5" />
    <path d="M5.5 3.5h9M4.5 13l3-3 2.5 2.5 2-2 3.5 3.5" />
  </Icon>
)

export const IconSearch = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="9" cy="9" r="5" />
    <path d="M12.8 12.8 16.5 16.5" />
  </Icon>
)

export const IconTrash = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
  </Icon>
)

/** Guide recording: a cursor with a trail of steps behind it. */
export const IconScribe = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 4.5h7M3.5 8h5M3.5 11.5h3" />
    <path d="M11 8.5l5.5 3.2-2.4.7-.9 2.3z" />
  </Icon>
)

/** Reshoot: a circular arrow — "same thing again", not "undo". */
export const IconRefresh = (props: IconProps) => (
  <Icon {...props}>
    <path d="M16 10a6 6 0 1 1-1.9-4.4" />
    <path d="M16.2 3.4v3h-3" />
  </Icon>
)

export const IconTag = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 9.5V4a.5.5 0 0 1 .5-.5h5.5l7 7-6 6z" />
    <circle cx="6.8" cy="6.8" r="1" />
  </Icon>
)

/** Scrolling capture: a frame growing down with the scroll. */
export const IconScroll = (props: IconProps) => (
  <Icon {...props}>
    <rect x="4.5" y="2.5" width="11" height="9" rx="1.5" />
    <path d="M10 13.5v4m0 0 2-2m-2 2-2-2" />
  </Icon>
)

/** Grid and list: two views of the same shot feed. */
export const IconGrid = (props: IconProps) => (
  <Icon {...props}>
    <rect x="3" y="3" width="6" height="6" rx="1.2" />
    <rect x="11" y="3" width="6" height="6" rx="1.2" />
    <rect x="3" y="11" width="6" height="6" rx="1.2" />
    <rect x="11" y="11" width="6" height="6" rx="1.2" />
  </Icon>
)

export const IconList = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" />
  </Icon>
)

/** Selection check: placed on the thumbnail of a selected shot. */
export const IconCheck = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 10.5 8 14l7.5-8" />
  </Icon>
)
