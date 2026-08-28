// ============================================
// BrandMark — the Intrack mark, in one place
//
// One rounded square cut into three diagonal slices, each sitting higher than
// the one below it. Nothing is drawn as an arrow; the rise is the cut.
//
// The same geometry ships as public/favicon.svg, the five PWA icons, the
// apple-touch icon, and the logo uploaded to Google's OAuth consent screen. It
// lives here as a component rather than three copies of a <span> because the
// site previously carried a rupee glyph in three files and the installed app
// carried an unrelated lightning bolt, so "the logo" meant two different
// pictures depending on where you looked. If this shape ever changes, the PNGs
// in public/ must be regenerated with it.
//
// `size` is the rendered edge in px. Colour comes from `className` via
// currentColor, so the same component is brand green in the header and white
// on a dark surface.
// ============================================

import { useId } from 'react'

interface BrandMarkProps {
  /** Rendered width and height in px. */
  size?: number
  className?: string
}

export default function BrandMark({ size = 32, className }: BrandMarkProps) {
  // Every instance needs its own clipPath id. Two marks on one page — the
  // header and the footer — sharing a hardcoded id is invalid HTML, and a
  // browser resolving url(#id) to whichever element it finds first is not
  // something to rely on the day this shape stops being identical everywhere.
  const clipId = `brandmark-${useId()}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="450 310 1501 1641"
      className={className}
      role="img"
      aria-label="Intrack"
      focusable="false"
    >
      <defs>
        {/* Each slice is clipped to the tile in its own coordinate space and
            only then translated, which is what lets the pieces step upward
            while every outer edge keeps the tile's corner radius. */}
        <clipPath id={clipId}>
          <rect x="450" y="450" width="1500" height="1500" rx="430" />
        </clipPath>
      </defs>
      <g fill="currentColor">
        <g transform="translate(0,-140)">
          <g clipPath={`url(#${clipId})`}>
            <path d="M0 -2400 L2400 -3000 L2400 350 L0 950 Z" />
          </g>
        </g>
        <g transform="translate(0,-70)">
          <g clipPath={`url(#${clipId})`}>
            <path d="M0 950 L2400 350 L2400 850 L0 1450 Z" />
          </g>
        </g>
        <g clipPath={`url(#${clipId})`}>
          <path d="M0 1450 L2400 850 L2400 2400 L0 2400 Z" />
        </g>
      </g>
    </svg>
  )
}
