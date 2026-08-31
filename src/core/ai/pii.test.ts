import { describe, expect, it } from 'vitest'

import {
  ibanValid,
  ssnValid,
  normalizeDigitRuns,
  findPii,
  hasPii,
  luhnValid,
  type PiiKind,
} from './pii'

const kinds = (text: string): PiiKind[] => findPii(text).map((match) => match.kind)
const texts = (text: string): string[] => findPii(text).map((match) => match.text)

describe('luhnValid', () => {
  it('accepts a real card number', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true)
  })

  // Without the checksum any long order number becomes a match.
  it('rejects a number that merely looks like one', () => {
    expect(luhnValid('1234 5678 9012 3456')).toBe(false)
  })

  it('rejects anything too short or too long to be a card', () => {
    expect(luhnValid('4242')).toBe(false)
    expect(luhnValid('4'.repeat(25))).toBe(false)
  })
})

describe('findPii', () => {
  it('finds an email', () => {
    expect(texts('пишите на ivan.petrov+work@example.co.uk сегодня')).toEqual([
      'ivan.petrov+work@example.co.uk',
    ])
  })

  it('finds a card, but only a valid one', () => {
    expect(kinds('карта 4242 4242 4242 4242')).toContain('card')
    expect(kinds('заказ 1234 5678 9012 3456')).not.toContain('card')
  })

  it('finds phones in the shapes people actually write', () => {
    expect(kinds('+7 (912) 345-67-89')).toContain('phone')
    expect(kinds('+1 415 555 2671')).toContain('phone')
  })

  it('finds a token and an api key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP'
    expect(kinds(jwt)).toEqual(['jwt'])
    expect(kinds('ключ sk-proj-abcdefghijklmnopqrstuvwx')).toEqual(['apiKey'])
  })

  it('finds an IBAN and an IP', () => {
    expect(kinds('DE89370400440532013000')).toContain('iban')
    expect(kinds('сервер 192.168.1.10')).toContain('ip')
  })

  // 999 in an octet is a build number or version, not an address.
  it('does not take any dotted numbers for an IP', () => {
    expect(kinds('версия 1.2.999.4')).not.toContain('ip')
  })

  it('finds several different things in one line', () => {
    const found = kinds('ivan@example.com, +7 912 345 67 89, 192.168.0.1')

    expect(found).toContain('email')
    expect(found).toContain('phone')
    expect(found).toContain('ip')
  })

  // The same span must not appear twice under different kinds.
  it('never returns overlapping matches', () => {
    const found = findPii('ivan@example.com +7 912 345 67 89 4242 4242 4242 4242')

    for (const [index, match] of found.entries()) {
      const next = found[index + 1]
      if (next) expect(match.end).toBeLessThanOrEqual(next.start)
    }
  })

  it('reports where in the string the find sits', () => {
    const [match] = findPii('почта: ivan@example.com')

    expect(match?.start).toBe(7)
    expect('почта: ivan@example.com'.slice(match!.start, match!.end)).toBe('ivan@example.com')
  })

  it('returns them in reading order', () => {
    const found = findPii('192.168.0.1 и ivan@example.com')

    expect(found[0]?.kind).toBe('ip')
    expect(found[1]?.kind).toBe('email')
  })

  // A false positive blurs a piece of UI — worse than a miss.
  it('finds nothing in ordinary text', () => {
    expect(findPii('Полный комплект по ФГОС ВО, три шага до готовой программы')).toEqual([])
    expect(hasPii('обычный текст без ничего')).toBe(false)
  })

  it('leaves names and addresses alone: they have no shape to match', () => {
    expect(findPii('Иван Петров, Москва, Тверская 12')).toEqual([])
  })
})

describe('normalizeDigitRuns', () => {
  // In a screen font 0/O, 1/l, 5/S differ by a couple of pixels — OCR returns
  // phones with letters inside, and the regex no longer sees them.
  it('straightens the letters OCR puts in the middle of a number', () => {
    expect(normalizeDigitRuns('+7961I8719O5')).toBe('+79611871905')
  })

  it('leaves words alone, however much they look like digits', () => {
    expect(normalizeDigitRuns('Sofia')).toBe('Sofia')
    expect(normalizeDigitRuns('Illia')).toBe('Illia')
    expect(normalizeDigitRuns('SOS')).toBe('SOS')
  })

  it('never touches a letter that is not surrounded by digits', () => {
    // Otherwise the leading D of an account number becomes a zero and the IBAN stops being one.
    expect(normalizeDigitRuns('DE89370400440532013000')).toBe('DE89370400440532013000')
  })

  it('keeps the length, so the found bounds still point at the right words', () => {
    const text = 'звоните +7961I8719O5 сегодня'
    expect(normalizeDigitRuns(text)).toHaveLength(text.length)
  })
})

describe('что читается с кадра плохо', () => {
  it('finds a phone the way OCR actually reads it', () => {
    expect(kinds('телефон +7961I8719O5')).toContain('phone')
  })

  it('finds an email even with the gap OCR leaves around the at sign', () => {
    expect(kinds('пишите name @ center.ru')).toContain('email')
  })

  it('finds a СНИЛС, which has a form of its own', () => {
    expect(kinds('СНИЛС 123-456-789 01')).toContain('snils')
  })

  it('finds a session id, which is just a long hexadecimal run', () => {
    expect(kinds('sid=9f8e7d6c5b4a39281706f5e4d3c2b1a0')).toContain('apiKey')
  })

  it('still refuses to call an ordinary word a secret', () => {
    expect(findPii('Конструктор программ · Демо-центр ДПО')).toEqual([])
  })
})

describe('США и Евросоюз', () => {
  it('finds a social security number', () => {
    expect(kinds('SSN 123-45-6789')).toContain('ssn')
  })

  it('refuses the ranges that are never issued', () => {
    // Otherwise any hyphenated number triple matches — dates, versions, extensions.
    expect(ssnValid('000-45-6789')).toBe(false)
    expect(ssnValid('666-45-6789')).toBe(false)
    expect(ssnValid('900-45-6789')).toBe(false)
    expect(ssnValid('123-00-6789')).toBe(false)
    expect(ssnValid('123-45-0000')).toBe(false)
    expect(ssnValid('123-45-6789')).toBe(true)
  })

  it('finds an IBAN printed the way banks print it, in groups of four', () => {
    expect(kinds('IBAN DE89 3704 0044 0532 0130 00')).toContain('iban')
    expect(texts('IBAN DE89 3704 0044 0532 0130 00')).toContain('DE89 3704 0044 0532 0130 00')
  })

  it('checks the IBAN sum instead of trusting its shape', () => {
    expect(ibanValid('DE89370400440532013000')).toBe(true)
    expect(ibanValid('FR1420041010050500013M02606')).toBe(true)
    // Same shape, one digit off — no longer an account.
    expect(ibanValid('DE89370400440532013001')).toBe(false)
    expect(ibanValid('XX00NOTANIBANATALL')).toBe(false)
  })

  it('finds an EU VAT number', () => {
    expect(kinds('VAT DE123456789')).toContain('vat')
    expect(kinds('НДС FR12345678901')).toContain('vat')
  })

  it('does not take a word in capitals for a VAT number', () => {
    expect(findPii('DEPARTMENTS')).toEqual([])
    expect(findPii('ITALIANO')).toEqual([])
  })
})
