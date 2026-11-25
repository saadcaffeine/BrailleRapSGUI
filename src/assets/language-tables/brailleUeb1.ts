// Unified English Braille (UEB), Grade 1 (uncontracted), 6 dots.
//
// Handled by the translator (see textToCells in lib/script.ts):
//   - capital letter indicator  ⠠ (6); capitalised word ⠠⠠ (6,6) for words of 2+ capitals
//   - numeric indicator  ⠼ (3456); digits use the a–j cells; '.' and ',' keep numeric mode
//   - grade 1 indicator  ⠰ (56) before a letter a–j that directly follows a number
//
// Grade 2 (contracted) UEB needs a rule-based translator such as LibLouis.

import { IBrailleTable } from './brailleTable'

export const brailleUeb1: IBrailleTable = {
  name: 'English UEB grade 1',
  type: '6dots',
  rules: 'ueb',
  dotMap: {
    0: { 0: 1, 1: 2, 2: 3 },
    1: { 0: 4, 1: 5, 2: 6 },
  },
  numberPrefix: [3, 4, 5, 6],
  capitalPrefix: [6],
  capitalWordPrefix: [[6], [6]],
  letterAfterNumberPrefix: [5, 6],
  numericContinue: ['.', ','],
  digits: {
    '1': [1], '2': [1, 2], '3': [1, 4], '4': [1, 4, 5], '5': [1, 5],
    '6': [1, 2, 4], '7': [1, 2, 4, 5], '8': [1, 2, 5], '9': [2, 4], '0': [2, 4, 5],
  },
  latinToBraille: {
    'a': [1], 'b': [1, 2], 'c': [1, 4], 'd': [1, 4, 5], 'e': [1, 5],
    'f': [1, 2, 4], 'g': [1, 2, 4, 5], 'h': [1, 2, 5], 'i': [2, 4], 'j': [2, 4, 5],
    'k': [1, 3], 'l': [1, 2, 3], 'm': [1, 3, 4], 'n': [1, 3, 4, 5], 'o': [1, 3, 5],
    'p': [1, 2, 3, 4], 'q': [1, 2, 3, 4, 5], 'r': [1, 2, 3, 5], 's': [2, 3, 4], 't': [2, 3, 4, 5],
    'u': [1, 3, 6], 'v': [1, 2, 3, 6], 'w': [2, 4, 5, 6], 'x': [1, 3, 4, 6], 'y': [1, 3, 4, 5, 6],
    'z': [1, 3, 5, 6],
    ' ': [],
    ',': [2], ';': [2, 3], ':': [2, 5], '.': [2, 5, 6], '!': [2, 3, 5], '?': [2, 3, 6],
    '\'': [3], '’': [3], '-': [3, 6],
    '“': [2, 3, 6], '”': [3, 5, 6],
  },
  multiCell: {
    '"': [[6], [2, 3, 5, 6]],          // non-specific double quote
    '(': [[5], [1, 2, 6]], ')': [[5], [3, 4, 5]],
    '[': [[4, 6], [1, 2, 6]], ']': [[4, 6], [3, 4, 5]],
    '/': [[4, 5, 6], [3, 4]],
    '+': [[5], [2, 3, 5]], '=': [[5], [2, 3, 5, 6]], '*': [[5], [3, 5]],
    '@': [[4], [1]], '&': [[4], [1, 2, 3, 4, 6]], '#': [[4, 5, 6], [1, 4, 5, 6]],
    '%': [[4, 6], [3, 5, 6]], '$': [[4], [2, 3, 4]],
    '–': [[6], [3, 6]], '—': [[6], [3, 6]],   // en / em dash
  },
}
