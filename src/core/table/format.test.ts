import { describe, expect, it } from 'vitest'

import { type TableGrid, toCsv, toJson, toMarkdown } from './format'

const grid = (rows: string[][], headerRows = 1, align: TableGrid['align'] = []): TableGrid => ({
  rows,
  headerRows,
  align,
})

describe('toCsv', () => {
  it('quotes a field that carries a comma, a quote or a newline', () => {
    const table = grid([['plain', 'a,b', 'say "hi"', 'two\nlines']])
    expect(toCsv(table)).toBe('plain,"a,b","say ""hi""","two\nlines"')
  })

  it('separates rows with CRLF, the only ending every spreadsheet agrees on', () => {
    expect(
      toCsv(
        grid([
          ['a', 'b'],
          ['c', 'd'],
        ]),
      ),
    ).toBe('a,b\r\nc,d')
  })
})

describe('toMarkdown', () => {
  it('pads the columns so the source stays readable by hand', () => {
    const table = grid([
      ['Name', 'Qty'],
      ['Bolt', '12'],
    ])
    expect(toMarkdown(table)).toBe(
      ['| Name | Qty |', '| :--- | :-- |', '| Bolt | 12  |'].join('\n'),
    )
  })

  it('carries the alignment that was on the page into the rule row', () => {
    const table = grid(
      [
        ['Name', 'Total'],
        ['Bolt', '12'],
      ],
      1,
      ['left', 'right'],
    )
    expect(toMarkdown(table).split('\n')[1]).toBe('| :--- | ----: |')
  })

  it('escapes the pipe and folds a line break, both of which break the table', () => {
    const table = grid([['a|b', 'two\nlines']])
    expect(toMarkdown(table).split('\n')[0]).toBe('| a\\|b | two<br>lines |')
  })

  it('promotes the first row to a header, because markdown has no headerless table', () => {
    const table = grid(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      0,
    )
    expect(toMarkdown(table).split('\n')).toHaveLength(3)
  })
})

describe('toJson', () => {
  it('keys the records by the header', () => {
    const table = grid([
      ['Name', 'Qty'],
      ['Bolt', '12'],
    ])
    expect(JSON.parse(toJson(table))).toEqual([{ Name: 'Bolt', Qty: '12' }])
  })

  it('keeps every row when there is no header to key on', () => {
    const table = grid(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      0,
    )
    expect(JSON.parse(toJson(table))).toEqual([
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('joins a two-level header into one readable key', () => {
    const table = grid(
      [
        ['Q1', 'Q1'],
        ['Revenue', 'Cost'],
        ['100', '40'],
      ],
      2,
    )
    expect(JSON.parse(toJson(table))).toEqual([{ 'Q1 · Revenue': '100', 'Q1 · Cost': '40' }])
  })

  it('keeps duplicate and empty column names reachable', () => {
    const table = grid([
      ['Name', 'Name', ''],
      ['a', 'b', 'c'],
    ])
    expect(JSON.parse(toJson(table))).toEqual([{ Name: 'a', 'Name (2)': 'b', column3: 'c' }])
  })
})
