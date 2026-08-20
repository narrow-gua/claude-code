import { describe, expect, test } from 'bun:test'
import type { Frame } from '../frame.js'
import { LogUpdate } from '../log-update.js'
import {
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  setCellAt,
  StylePool,
} from '../screen.js'

type Pools = {
  styles: StylePool
  chars: CharPool
  hyperlinks: HyperlinkPool
}

function createPools(): Pools {
  return {
    styles: new StylePool(),
    chars: new CharPool(),
    hyperlinks: new HyperlinkPool(),
  }
}

function createFrame(
  pools: Pools,
  cells: Array<{ x: number; char: string; width?: CellWidth }>,
): Frame {
  const screen = createScreen(
    12,
    1,
    pools.styles,
    pools.chars,
    pools.hyperlinks,
  )
  for (const cell of cells) {
    setCellAt(screen, cell.x, 0, {
      char: cell.char,
      styleId: pools.styles.none,
      width: cell.width ?? CellWidth.Narrow,
      hyperlink: undefined,
    })
  }
  return {
    screen,
    viewport: { width: 12, height: 8 },
    cursor: { x: 0, y: 0, visible: false },
  }
}

function createTallFrame(
  pools: Pools,
  height: number,
  viewportHeight: number,
  cells: Array<{ x: number; y: number; char: string }>,
): Frame {
  const screen = createScreen(
    12,
    height,
    pools.styles,
    pools.chars,
    pools.hyperlinks,
  )
  for (const cell of cells) {
    setCellAt(screen, cell.x, cell.y, {
      char: cell.char,
      styleId: pools.styles.none,
      width: CellWidth.Narrow,
      hyperlink: undefined,
    })
  }
  return {
    screen,
    viewport: { width: 12, height: viewportHeight },
    cursor: { x: 0, y: height, visible: false },
  }
}

describe('LogUpdate cursor positioning', () => {
  test('uses absolute columns for same-row changes', () => {
    const pools = createPools()
    const previous = createFrame(pools, [])
    const next = createFrame(pools, [
      { x: 1, char: 'A' },
      { x: 7, char: 'B' },
    ])
    const log = new LogUpdate({ isTTY: true, stylePool: pools.styles })

    const diff = log.render(previous, next)

    expect(diff).toContainEqual({ type: 'cursorTo', col: 2 })
    expect(diff).toContainEqual({ type: 'cursorTo', col: 8 })
    expect(
      diff.some(
        patch => patch.type === 'cursorMove' && patch.y === 0 && patch.x !== 0,
      ),
    ).toBe(false)
  })

  test('uses measured width when compensating an unusually wide cell', () => {
    const pools = createPools()
    const previous = createFrame(pools, [])
    const next = createFrame(pools, [
      { x: 1, char: '界界', width: CellWidth.Wide },
    ])
    const log = new LogUpdate({ isTTY: true, stylePool: pools.styles })

    const diff = log.render(previous, next)

    expect(diff).toContainEqual({ type: 'stdout', content: '   ' })
    expect(diff).toContainEqual({ type: 'cursorTo', col: 6 })
  })
})

describe('LogUpdate native scrollback', () => {
  test('skips unreachable scrollback changes while updating visible rows', () => {
    const pools = createPools()
    const previous = createTallFrame(pools, 6, 4, [
      { x: 0, y: 0, char: 'A' },
      { x: 0, y: 4, char: 'X' },
    ])
    const next = createTallFrame(pools, 6, 4, [
      { x: 0, y: 0, char: 'B' },
      { x: 0, y: 4, char: 'Y' },
    ])
    const log = new LogUpdate({ isTTY: true, stylePool: pools.styles })

    const diff = log.render(previous, next)
    const output = diff
      .filter(patch => patch.type === 'stdout')
      .map(patch => patch.content)
      .join('')

    expect(output).not.toContain('B')
    expect(output).toContain('Y')
    expect(diff.some(patch => patch.type === 'clearScreen')).toBe(false)
    expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(false)
  })

  test('repaints only the visible tail when a tall overlay closes', () => {
    const pools = createPools()
    const previous = createTallFrame(pools, 8, 5, [{ x: 0, y: 7, char: 'P' }])
    const next = createTallFrame(pools, 6, 5, [
      { x: 0, y: 0, char: 'H' },
      { x: 0, y: 2, char: 'V' },
      { x: 0, y: 5, char: 'Z' },
    ])
    const log = new LogUpdate({ isTTY: true, stylePool: pools.styles })

    const diff = log.render(previous, next)
    const output = diff
      .filter(patch => patch.type === 'stdout')
      .map(patch => patch.content)
      .join('')

    expect(diff[0]).toMatchObject({
      type: 'clearScreen',
      reason: 'offscreen',
    })
    expect(output).not.toContain('H')
    expect(output).toContain('V')
    expect(output).toContain('Z')
    expect(diff.some(patch => patch.type === 'clearTerminal')).toBe(false)
  })
})
