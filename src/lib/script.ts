// Heavily based on code from StephaneG
// original code https://github.com/crocsg/BrailleRap 

import * as paper from 'paper'
import { IBrailleTable, brailleTableMap } from '../assets/language-tables/brailleTable'
import { compairCharAgaistDevnagriNumber, getPrefixforSpecialcharacter } from './charUtils'
import { IBrailleSettings } from '../components/ui-settings/UiSettings'


// Paper presets (mm). Printer coordinates: X = across the sheet from the X home,
// Y = down the sheet from the top edge (MarlinBraille2 homes Y to the top of the paper).
export const paperPresets = {
  'A4 (BrailleRAP)': { paperWidth: 175, paperHeight: 290, marginWidth: 3, marginHeight: 5 },
  'A4 on BrailleRAP XL': { paperWidth: 210, paperHeight: 297, marginWidth: 10, marginHeight: 10 },
  'A3 (BrailleRAP XL)': { paperWidth: 297, paperHeight: 420, marginWidth: 10, marginHeight: 10 },
}
export type PaperPreset = keyof typeof paperPresets

// Braille cell geometry (mm).
//   standard: 2.5 mm dot pitch, 6.0 mm cell pitch, 10 mm line pitch (common literary Braille spec)
//   large:    the original BrailleRap Bhutan spacing
export const brailleSizes = {
  'standard': { dotPitch: 2.5, cellPitch: 6.0, linePitch: 10.0 },
  'large (original Bhutan spacing)': { dotPitch: 4.0, cellPitch: 10.0, linePitch: 16.0 },
}
export type BrailleSize = keyof typeof brailleSizes

export const brailleConfig = {
  marginWidth: 10,
  marginHeight: 10,
  paperWidth: 297,
  paperHeight: 420,
  dotPitch: 2.5,
  cellPitch: 6.0,
  linePitch: 10.0,
  dotRadius: 1.25,
  headDownPosition: -2.0,
  headUpPosition: 10,
  speed: 2000,
  delta: false,
  goToZero: true,
  invertX: true,
  invertY: true,
  mirrorX: true,
  mirrorY: true,
  svgStep: 2,
  svgDots: true,
  svgPosX: 0,
  svgPosY: 0,
  // svgScale: 1,
  language: '6 dots',
  GCODEup: 'M3 S0',
  GCODEdown: 'M3 S1',
  GCODEafterpause: 'G4 P50',
  usedotgrid: false,
  homeY: true,
  ejectPaper: true

}

let xhead = 0
let yhead = 0

// Replace a char at index in a string
function replaceAt(s:string, n:number, t:string) {
  return s.substring(0, n) + t + s.substring(n + 1)
}

export interface IPosition2D {
  x: number,
  y: number
}

export interface IGCode {
  code:string
}

const GCODEdotposition:IPosition2D[] = []
const GCODEsvgdotposition:IPosition2D[] = []

const gcodeSetAbsolutePositioning = function() {
  return 'G90;\r\n'
}

const gcodeMotorOff = function()
{
  return 'M84;\r\n'
}

// Progress markers: M118 echoes text back to the host. M3 waits for the previous move to
// finish, so a marker right after M3 S1 arrives when the dot is embossed. The web UI uses
// these for the staged progress bar and to flash the preview on every dot.
export const MARK = 'M118 BR:'

const gcodeHome = function ()
{
  let str = MARK + 'HOMING\r\nG28 X;\r\n'
  if (brailleConfig.homeY){
    str += MARK + 'PAPER\r\nG28 Y;\r\n'
  }
  

  return str
}

const gcodeResetPosition = function(X:number, Y:number, Z:number) {
  return 'G92' + gcodePosition(X, Y, Z)
}

const gcodeSetSpeed = function(speed:number) {
  return `G1 F${speed};\r\n`
}

const gcodePosition = function(X?:number, Y?:number, Z?:number) {
  let code = ''
  if(X === undefined && Y === undefined && Z === undefined) {
    throw new Error('Null position when moving')
  }
  // note: 0 is a valid coordinate, so test against undefined (the original `if(X)` dropped zeros)
  if(X !== undefined) {
    code += ' X' + X.toFixed(2)
  }
  if(Y !== undefined) {
    code += ' Y' + Y.toFixed(2)
  }
  if(Z !== undefined && Z !== 0) {
    code += ' Z' + Z.toFixed(2)
  }
  code += ';\r\n'
  return code
}

const gcodeGoTo = function(X?:number, Y?:number, Z?:number) {
  return 'G0' + gcodePosition(X, Y, Z)
}

const gcodeMoveTo = function(X?:number, Y?:number, Z?:number) {
  return 'G1' + gcodePosition(X, Y, Z)
}

const gcodeMoveToCached = function (X?:number,Y?:number,Z?:number)
{
  if (X != null)
    xhead = X
  if (Y != null)
    yhead = Y

  return gcodeMoveTo (X,Y,Z)
}


let dotTotal = 0
let dotIndex = 0
const gcodeprintdot = function () {
  let s = brailleConfig.GCODEdown + ';\r\n'
  dotIndex += 1
  s += `${MARK}DOT ${dotIndex}/${dotTotal}\r\n`
  s += brailleConfig.GCODEup + ';\r\n'
  s += brailleConfig.GCODEafterpause + ';\r\n'

  return (s)
}

const gcodePrintDotCached = function ()
{
  if (xhead != null && yhead != null)
    GCODEdotposition.push ({x:xhead,y:yhead})

  return gcodeprintdot ()
}

const gcodeGraphDotCached = function ()
{
  if (xhead != null && yhead != null)
    GCODEsvgdotposition.push ({x:xhead,y:yhead})

  return gcodeprintdot ()
}

const buildoptimizedgcode = function ()
{
  const gridsizex = Math.floor(brailleConfig.paperWidth / brailleConfig.svgStep)
  const gridsizey = Math.floor (brailleConfig.paperHeight / brailleConfig.svgStep)



  const dotgrid = new Array<number[]>(gridsizex)
  for (let i = 0;i < gridsizex; i++)
  {
    dotgrid[i] = new Array<number>(gridsizey)
    dotgrid[i].fill (0)
  }
  let codestr = gcodeHome ()



  codestr += gcodeSetSpeed(brailleConfig.speed)


  if(brailleConfig.goToZero) {
    codestr += gcodeMoveTo(0, 0, 0)
  }


  GCODEdotposition.sort (function (a,b) {
    if (a.y == b.y) return (a.x - b.x)
    return (a.y - b.y)
  })

  const sortedpositions = gcodesortzigzag(GCODEdotposition)
  dotTotal = sortedpositions.length + GCODEsvgdotposition.length
  dotIndex = 0
  codestr += `${MARK}PRINT 0/${dotTotal}\r\n`

  if (brailleConfig.usedotgrid == true)
    console.log ('filtering dot neighbor')

  for (let i = 0; i < sortedpositions.length; i++)
  {
    codestr += gcodeMoveTo(sortedpositions[i].x, sortedpositions[i].y)
    codestr += gcodeprintdot ()
    dotgrid[Math.floor(sortedpositions[i].x / brailleConfig.svgStep)][Math.floor(sortedpositions[i].y / brailleConfig.svgStep)] = 1
  }

  // print svg
  for (let i=0; i < GCODEsvgdotposition.length; i++)
  {
    const gx = Math.floor (GCODEsvgdotposition[i].x / brailleConfig.svgStep)
    const gy = Math.floor (GCODEsvgdotposition[i].y / brailleConfig.svgStep)

    if (gx < 0 || gx >= gridsizex)
      continue
    if (gy < 0 || gy >= gridsizey)
      continue

    if (brailleConfig.usedotgrid  == true)
    {
      if (dotgrid[gx][gy] == 0)
      {
        codestr += gcodeMoveTo (GCODEsvgdotposition[i].x, GCODEsvgdotposition[i].y)
        codestr += gcodeprintdot ()
        dotgrid[gx][gy] = 1
      }
      else
      {
        console.log ('dot filtered')
      }
    }
    else
    {
      codestr += gcodeMoveTo (GCODEsvgdotposition[i].x, GCODEsvgdotposition[i].y)
      codestr += gcodeprintdot ()
    }
  }

  codestr += MARK + 'EJECT\r\n'
  if (brailleConfig.ejectPaper){
    codestr += gcodeMoveTo (0,brailleConfig.paperHeight)
  } else {
    codestr += gcodeMoveTo (0,0)
  }
  
  codestr += gcodeMotorOff ()
  codestr += MARK + 'END\r\n'
  return (codestr)
}

// gcode sort by line
const gcodesortzigzag = function (positions:IPosition2D[])
{
  let i
  let  s = 0
  let e = 0
  let dir = 1
  let tmp = []
  const sorted:IPosition2D[] = []

  if (positions == null)
    return (sorted)

  while (e < positions.length)
  {
    while ((positions[s].y == positions[e].y) )
    {
      e++
      if (e == (positions.length))
      {
        break
      }
    }

    //if (e - s >= 0)
    {
      for (let i = s; i < e; i++)
      {
        tmp.push (positions[i])
      }
      tmp.sort (function (a,b) {
        if (a.y == b.y) return ((a.x - b.x) * dir)
        return (a.y - b.y)
      })

      for(i = 0; i < tmp.length; i++)
        sorted.push (tmp[i])
      tmp = []
      dir = - dir

      s = e
    }
    if (e >= positions.length)
    {
      break
    }
  }

  return (sorted)
}

export interface ICharIndices {
  xAct:number,
  yAct:number,
  indices:number[]
}

type Cell = number[] | 'NL'

const isDigit = (c:string)=> c >= '0' && c <= '9'
const isUpper = (c:string)=> c !== c.toLowerCase() && c === c.toUpperCase()
const isLetter = (c:string)=> c.toLowerCase() !== c.toUpperCase()

// UEB grade 1: capitals, capitalised words, numeric mode, grade 1 indicator after numbers
const uebToCells = (text:string, table:IBrailleTable, unknown:Set<string>):Cell[]=>{
  const map = table.latinToBraille
  const multi = table.multiCell || {}
  const digits = table.digits || {}
  const cells:Cell[] = []
  let numeric = false
  let capsWord = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (/\r?\n|\r/.test(c)) {
      if (c === '\r' && text[i + 1] === '\n') i++
      cells.push('NL'); numeric = false; capsWord = false
      continue
    }
    if (isDigit(c)) {
      if (!numeric) { cells.push(table.numberPrefix); numeric = true }
      cells.push(digits[c])
      continue
    }
    if (numeric && (table.numericContinue || []).includes(c) && isDigit(text[i + 1] || '')) {
      cells.push(map[c])
      continue
    }
    if (isLetter(c)) {
      const lower = c.toLowerCase()
      if (!(lower in map)) { unknown.add(c); numeric = false; continue }
      if (numeric && /[a-j]/.test(lower) && table.letterAfterNumberPrefix) cells.push(table.letterAfterNumberPrefix)
      numeric = false
      if (isUpper(c)) {
        if (!capsWord) {
          // look ahead: a word of 2+ capitals gets the capitalised-word indicator
          let j = i
          while (j < text.length && isLetter(text[j]) && isUpper(text[j])) j++
          const wordEnds = j >= text.length || !isLetter(text[j])
          if (j - i >= 2 && wordEnds && table.capitalWordPrefix) {
            table.capitalWordPrefix.forEach((cell)=> cells.push(cell))
            capsWord = true
          } else if (table.capitalPrefix) {
            cells.push(table.capitalPrefix)
          }
        }
      } else {
        capsWord = false
      }
      cells.push(map[lower])
      continue
    }
    numeric = false
    capsWord = false
    if (c in multi) { multi[c].forEach((cell)=> cells.push(cell)); continue }
    if (c in map) { cells.push(map[c]); continue }
    unknown.add(c)
  }
  return cells
}

// Original BrailleRap Bhutan behaviour, kept for the existing French / Indian / 8-dot tables
const legacyToCells = (_text:string, table:IBrailleTable, unknown:Set<string>):Cell[]=>{
  const latinToBrailleMap = new Map(Object.entries(table.latinToBraille))
  const is8dot = table.type === '8dots'
  const cells:Cell[] = []
  let isWritingNumber = false
  let isSpecialchar = false
  for(let i = 0 ; i < _text.length ; i++) {
    const char = _text[i]
    const charIsCapitalLetter = is8dot ? false : /[A-Z]/.test(char)
    if(/\r?\n|\r/.test(char)) {
      cells.push('NL')
      continue
    }
    if(!latinToBrailleMap.has(char.toLowerCase())) {
      unknown.add(char)
      continue
    }
    let indices = latinToBrailleMap.get(char)
    let devnagriNr = compairCharAgaistDevnagriNumber(char)
    if (typeof devnagriNr === 'string') {
      devnagriNr = parseInt(devnagriNr)
    }
    let reread = false
    if(!isWritingNumber && !isNaN(devnagriNr)) {
      indices = table.numberPrefix
      reread = true
      isWritingNumber = true
    } else if(isWritingNumber && char == ' ') {
      isWritingNumber = false
    } else if( charIsCapitalLetter ) {
      indices = table.capitalPrefix || [4, 6]
      _text = replaceAt(_text, i, _text[i].toLowerCase())
      reread = true
    }
    if(!reread && !isSpecialchar && getPrefixforSpecialcharacter(char).length>0) {
      indices = getPrefixforSpecialcharacter(char)
      reread = true
      isSpecialchar = true
    } else if (!reread) {
      isSpecialchar = false
    }
    if (indices) cells.push(indices)
    if (reread) i--
  }
  return cells
}

export const textToCells = (text:string, table:IBrailleTable, unknown:Set<string> = new Set())=>
  table.rules === 'ueb' ? uebToCells(text, table, unknown) : legacyToCells(text, table, unknown)

// Lay cells out on the page; returns positioned cells and whether the text overflowed the sheet
const layoutCells = (cells:Cell[], table:IBrailleTable, cfg: typeof brailleConfig)=>{
  const is8dot = table.type === '8dots'
  const lineAdvance = cfg.linePitch + (is8dot ? cfg.dotPitch : 0)
  const cellHeight = (is8dot ? 3 : 2) * cfg.dotPitch
  const placed:ICharIndices[] = []
  let x = cfg.marginWidth
  let y = cfg.marginHeight
  let truncated = false
  const fitsVertically = ()=> y + cellHeight <= cfg.paperHeight - cfg.marginHeight
  for (const cell of cells) {
    if (cell === 'NL') {
      x = cfg.marginWidth
      y += lineAdvance
      continue
    }
    if (x + cfg.dotPitch + cfg.dotRadius > cfg.paperWidth - cfg.marginWidth) {
      x = cfg.marginWidth
      y += lineAdvance
    }
    if (!fitsVertically()) { truncated = true; break }
    placed.push({ xAct: x, yAct: y, indices: cell })
    x += cfg.cellPitch
  }
  return { placed, truncated }
}

export interface IGCodeResult {
  gcode: string
  dots: number
  truncated: boolean
  unknownChars: string[]
}

// Draw braille and generate gcode
export function brailleToGCodeResult(textToWrite:string,settings:IBrailleSettings):IGCodeResult|undefined {
  if (!brailleTableMap.has(settings.tableName)){
    console.error(`Table ${settings.tableName} does not exist`)
    return
  }
  const brailleTable:IBrailleTable = brailleTableMap.get(settings.tableName) as IBrailleTable
  brailleConfig.speed = settings.velocity
  brailleConfig.homeY = settings.homeY
  brailleConfig.ejectPaper = settings.ejectPaper
  Object.assign(brailleConfig, paperPresets[settings.paper] || paperPresets['A3 (BrailleRAP XL)'])
  Object.assign(brailleConfig, brailleSizes[settings.brailleSize] || brailleSizes['standard'])

  GCODEdotposition.length = 0
  GCODEsvgdotposition.length = 0

  const is8dot = brailleTable.type === '8dots'
  const unknown = new Set<string>()
  const cells = textToCells(textToWrite, brailleTable, unknown)
  const { placed, truncated } = layoutCells(cells, brailleTable, brailleConfig)

  for (const cell of placed) {
    for(let y = 0 ; y < (is8dot ? 4 : 3) ; y++) {
      for(let x = 0 ; x < 2 ; x++) {
        if(cell.indices.indexOf(brailleTable.dotMap[x][y]) != -1) {
          const px = cell.xAct + x * brailleConfig.dotPitch
          const py = cell.yAct + y * brailleConfig.dotPitch
          let gx = brailleConfig.invertX ? - px : brailleConfig.paperWidth - px
          let gy = -py // canvas y axis goes downward, printers goes upward
          if(brailleConfig.delta) {
            gx -= brailleConfig.paperWidth / 2
            gy += brailleConfig.paperHeight / 2
          } else if(!brailleConfig.invertY){
            gy += brailleConfig.paperHeight
          }
          gcodeMoveToCached(brailleConfig.mirrorX ? -gx : gx, brailleConfig.mirrorY ? -gy : gy,0)
          gcodePrintDotCached()
        }
      }
    }
  }

  return {
    gcode: buildoptimizedgcode(),
    dots: GCODEdotposition.length,
    truncated,
    unknownChars: Array.from(unknown),
  }
}

export function brailleToGCode(textToWrite:string,settings:IBrailleSettings) {
  return brailleToGCodeResult(textToWrite, settings)?.gcode
}
