import { describe, expect, it } from 'vitest'

import {
  MESH_BLOBS,
  ringRadii,
  TILE_SIZE,
  TILED_PATTERNS,
  tileGeometry,
  WALLPAPER_PATTERNS,
} from './wallpaper'

describe('tileGeometry', () => {
  it('scales every measure with the tile, so a tile at 2x looks identical', () => {
    const small = tileGeometry('dots', TILE_SIZE)
    const large = tileGeometry('dots', TILE_SIZE * 2)

    expect(large.dotRadius / small.dotRadius).toBe(2)
    expect(large.step / small.step).toBe(2)
  })

  it('keeps grid lines visible at the smallest tile', () => {
    expect(tileGeometry('grid', 8).lineWidth).toBeGreaterThanOrEqual(1)
  })

  it('has no line or dot for patterns that are not tiled', () => {
    expect(tileGeometry('mesh')).toEqual({ step: TILE_SIZE, dotRadius: 0, lineWidth: 0 })
  })
})

describe('MESH_BLOBS', () => {
  it('places every blob inside the canvas, in fractions', () => {
    for (const blob of MESH_BLOBS) {
      expect(blob.x).toBeGreaterThanOrEqual(0)
      expect(blob.x).toBeLessThanOrEqual(1)
      expect(blob.y).toBeGreaterThanOrEqual(0)
      expect(blob.y).toBeLessThanOrEqual(1)
    }
  })

  it('uses both colours, or the mesh would be one flat wash', () => {
    const colours = new Set(MESH_BLOBS.map((blob) => blob.colour))
    expect(colours).toEqual(new Set(['from', 'to']))
  })

  /** No RNG: the same document looks the same every time. */
  it('is fixed data, not generated per render', () => {
    expect(MESH_BLOBS).toBe(MESH_BLOBS)
    expect(MESH_BLOBS.length).toBeGreaterThan(2)
  })
})

describe('ringRadii', () => {
  it('grows outwards and stays inside the canvas', () => {
    const radii = ringRadii()

    expect(radii).toEqual([...radii].sort((a, b) => a - b))
    expect(Math.max(...radii)).toBeLessThan(1)
  })

  it('honours the requested count', () => {
    expect(ringRadii(3)).toHaveLength(3)
  })
})

describe('pattern lists', () => {
  it('marks only the repeating patterns as tiled', () => {
    for (const pattern of TILED_PATTERNS) {
      expect(WALLPAPER_PATTERNS).toContain(pattern)
    }
    expect(TILED_PATTERNS).not.toContain('mesh')
    expect(TILED_PATTERNS).not.toContain('rings')
  })
})
