import { braille6 } from './braille6'
import { braille6india } from './braille6india'
import { braille8new } from './braille8new'
import { brailleUeb1 } from './brailleUeb1'


export interface IBrailleTable {
  name: string,
  type: '6dots' | '8dots'
  dotMap: {[key:number]:{[key:number]:number}},
  numberPrefix:number[],
  latinToBraille:{[key:string]:number[]}
  // optional, used by the 'ueb' rules (see textToCells in lib/script.ts)
  rules?: 'legacy' | 'ueb'
  capitalPrefix?: number[]
  capitalWordPrefix?: number[][]
  letterAfterNumberPrefix?: number[]
  numericContinue?: string[]
  digits?: {[key:string]:number[]}
  multiCell?: {[key:string]:number[][]}
}

const buildName = (table:IBrailleTable)=>{
  return `${table.name} - ${table.type}`
}

const brailleTableMap = new Map<string,IBrailleTable>()
brailleTableMap.set(buildName(brailleUeb1),brailleUeb1)
brailleTableMap.set(buildName(braille6),braille6)
brailleTableMap.set(buildName(braille8new),braille8new)
brailleTableMap.set(buildName(braille6india),braille6india)
const brailleTableOptions:string[] = Array.from(brailleTableMap.keys())
export {  
  brailleTableMap,
  brailleTableOptions
}
