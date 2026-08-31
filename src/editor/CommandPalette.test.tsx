// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { translate } from '@/core/i18n'
import { AppContext, type AppContextValue } from '@/core/ui/app-context'
import { DEFAULT_SETTINGS } from '@/core/storage/settings'

import { type Command, CommandPalette } from './CommandPalette'

const app: AppContextValue = {
  settings: DEFAULT_SETTINGS,
  updateSettings: () => Promise.resolve(),
  locale: 'ru',
  theme: 'dark',
  t: (key, params) => translate('ru', key, params),
}

const noop = vi.fn()

function palette(commands: Command[], onClose: () => void = noop) {
  return render(
    <AppContext value={app}>
      <CommandPalette commands={commands} onClose={onClose} />
    </AppContext>,
  )
}

const command = (id: string, title: string, group = 'Инструмент', run = noop): Command => ({
  id,
  title,
  group,
  run,
})

// Tests run without globals, so testing-library's auto-cleanup does not hook itself up.
afterEach(cleanup)

describe('CommandPalette', () => {
  it('shows every command until something is typed', () => {
    palette([command('a', 'Стрелка'), command('b', 'Текст')])

    expect(screen.getByText('Стрелка')).toBeTruthy()
    expect(screen.getByText('Текст')).toBeTruthy()
  })

  it('filters by title', async () => {
    palette([command('a', 'Стрелка'), command('b', 'Текст')])

    await userEvent.type(screen.getByRole('textbox'), 'тек')

    expect(screen.queryByText('Стрелка')).toBeNull()
    expect(screen.getByText('Текст')).toBeTruthy()
  })

  // The group is searched alongside the title: a tool is also looked up by its group word.
  it('filters by group', async () => {
    palette([command('a', 'Стрелка', 'Инструмент'), command('b', 'Вписать', 'Вид')])

    await userEvent.type(screen.getByRole('textbox'), 'вид')

    expect(screen.getByText('Вписать')).toBeTruthy()
    expect(screen.queryByText('Стрелка')).toBeNull()
  })

  it('runs the first match on Enter and closes', async () => {
    const run = vi.fn()
    const onClose = vi.fn()
    palette([command('a', 'Стрелка'), command('b', 'Текст', 'Инструмент', run)], onClose)

    await userEvent.type(screen.getByRole('textbox'), 'тек{Enter}')

    expect(run).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('moves the choice with the arrow keys', async () => {
    const second = vi.fn()
    palette([command('a', 'Стрелка'), command('b', 'Текст', 'Инструмент', second)])

    await userEvent.type(screen.getByRole('textbox'), '{ArrowDown}{Enter}')

    expect(second).toHaveBeenCalledOnce()
  })

  it('closes on Escape without running anything', async () => {
    const run = vi.fn()
    const onClose = vi.fn()
    palette([command('a', 'Стрелка', 'Инструмент', run)], onClose)

    await userEvent.type(screen.getByRole('textbox'), '{Escape}')

    expect(run).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('says so when nothing matches', async () => {
    palette([command('a', 'Стрелка')])

    await userEvent.type(screen.getByRole('textbox'), 'квадратура круга')

    expect(screen.getByText('Ничего не нашлось')).toBeTruthy()
  })
})
