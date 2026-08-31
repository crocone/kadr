// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { cellText, closestTable, dataRowCount, isTableLike, readTable } from './read'

function mount(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild!
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('readTable', () => {
  it('reads a plain table with its header', () => {
    const table = mount(`
      <table>
        <thead><tr><th>Name</th><th>Qty</th></tr></thead>
        <tbody><tr><td>Bolt</td><td>12</td></tr><tr><td>Nut</td><td>7</td></tr></tbody>
      </table>
    `)
    const grid = readTable(table)!

    expect(grid.headerRows).toBe(1)
    expect(grid.rows).toEqual([
      ['Name', 'Qty'],
      ['Bolt', '12'],
      ['Nut', '7'],
    ])
    expect(dataRowCount(grid)).toBe(2)
  })

  it('repeats a colspan cell across every column it covered', () => {
    const table = mount(`
      <table>
        <tr><th colspan="2">Q1</th><th>Q2</th></tr>
        <tr><td>10</td><td>20</td><td>30</td></tr>
      </table>
    `)
    expect(readTable(table)!.rows).toEqual([
      ['Q1', 'Q1', 'Q2'],
      ['10', '20', '30'],
    ])
  })

  it('pushes the cells of the next row past a rowspan reaching into it', () => {
    const table = mount(`
      <table>
        <tr><td rowspan="2">Europe</td><td>France</td><td>1</td></tr>
        <tr><td>Spain</td><td>2</td></tr>
        <tr><td>Asia</td><td>Japan</td><td>3</td></tr>
      </table>
    `)
    expect(readTable(table)!.rows).toEqual([
      ['Europe', 'France', '1'],
      ['Europe', 'Spain', '2'],
      ['Asia', 'Japan', '3'],
    ])
  })

  it('keeps the table rectangular when a row is short', () => {
    const table = mount('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table>')
    expect(readTable(table)!.rows).toEqual([
      ['a', 'b'],
      ['c', ''],
    ])
  })

  it('puts the foot last, wherever the markup keeps it', () => {
    const table = mount(`
      <table>
        <tfoot><tr><td>Total</td><td>19</td></tr></tfoot>
        <tbody><tr><td>Bolt</td><td>12</td></tr></tbody>
      </table>
    `)
    expect(readTable(table)!.rows.at(-1)).toEqual(['Total', '19'])
  })

  it('reads an ARIA grid the same way as a real table', () => {
    const grid = mount(`
      <div role="grid">
        <div role="row"><div role="columnheader">Name</div><div role="columnheader">Qty</div></div>
        <div role="row"><div role="gridcell">Bolt</div><div role="gridcell">12</div></div>
      </div>
    `)
    expect(readTable(grid)!.rows).toEqual([
      ['Name', 'Qty'],
      ['Bolt', '12'],
    ])
  })

  it('treats an all-header table as data, not as three rows of column names', () => {
    const table = mount('<table><tr><th>a</th></tr><tr><th>b</th></tr></table>')
    expect(readTable(table)!.headerRows).toBe(0)
  })
})

describe('cellText', () => {
  it('drops the sort hint the page keeps for screen readers', () => {
    const table = mount(`
      <table><tr><th>Name<span aria-hidden="true">▲</span>
        <span style="display: none">Sorted ascending</span></th></tr></table>
    `)
    expect(cellText(table.querySelector('th')!)).toBe('Name')
  })

  it('takes the value of a field and the alt of an image', () => {
    const table = mount(`
      <table><tr>
        <td><input value="42"></td>
        <td><img alt="done"></td>
        <td><input type="checkbox" checked></td>
      </tr></table>
    `)
    const cells = [...table.querySelectorAll('td')].map(cellText)
    expect(cells).toEqual(['42', 'done', 'true'])
  })

  it('never reads a password field', () => {
    const table = mount('<table><tr><td><input type="password" value="hunter2"></td></tr></table>')
    expect(cellText(table.querySelector('td')!)).toBe('')
  })

  it('collapses the indentation of the markup but keeps a real line break', () => {
    const table = mount('<table><tr><td>\n  one<br>  two  three\n</td></tr></table>')
    expect(cellText(table.querySelector('td')!)).toBe('one\ntwo three')
  })
})

describe('closestTable', () => {
  it('walks up from the cell the cursor is actually over', () => {
    const table = mount('<table><tr><td><b>x</b></td></tr></table>')
    expect(closestTable(table.querySelector('b'))).toBe(table)
  })

  it('returns nothing outside a table', () => {
    const div = mount('<div><p>text</p></div>')
    expect(closestTable(div.querySelector('p'))).toBeNull()
  })

  /**
   * A wide table is almost always wrapped in a scroll container, which occupies
   * exactly the edge strip the cursor crosses on its way to the copy buttons.
   */
  it('looks inside a scroll wrapper, because that is what the cursor lands on', () => {
    const wrapper = mount('<div class="art-table-scroll"><table><tr><td>a</td></tr></table></div>')
    expect(closestTable(wrapper)?.tagName).toBe('TABLE')
  })

  it('refuses to guess when the container holds more than one table', () => {
    const wrapper = mount(
      '<div><table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table></div>',
    )
    expect(closestTable(wrapper)).toBeNull()
  })
})

describe('isTableLike', () => {
  it('accepts both a real table and an ARIA one', () => {
    expect(isTableLike(mount('<table></table>'))).toBe(true)
    expect(isTableLike(mount('<div role="treegrid"></div>'))).toBe(true)
    expect(isTableLike(mount('<div role="list"></div>'))).toBe(false)
  })
})
