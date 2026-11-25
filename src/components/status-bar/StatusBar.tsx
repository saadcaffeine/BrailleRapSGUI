//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { IEmbosserStatus } from '../../lib/embosser'
import './statusBar.scss'

type Colour = 'green' | 'amber' | 'red' | 'grey' | 'blue'

interface ILed {
  label: string
  colour: Colour
  blink?: boolean
  detail: string
}

const Led = ({ label, colour, blink, detail }: ILed) => (
  <div className="br-status__item" title={detail} role="status" aria-label={`${label}: ${detail}`}>
    <span className={`br-status__led br-status__led--${colour}${blink ? ' br-status__led--blink' : ''}`} />
    <span className="br-status__label">{label}</span>
  </div>
)

const linkLed = (s: IEmbosserStatus): ILed => {
  switch (s.link) {
    case 'ok': return { label: 'LINK', colour: 'green', detail: 'Connected to the embosser' }
    case 'busy': return { label: 'LINK', colour: 'amber', blink: true, detail: 'Embosser busy (homing / loading paper)' }
    case 'connecting': return { label: 'LINK', colour: 'amber', blink: true, detail: 'Connecting to the embosser…' }
    case 'halted': return { label: 'LINK', colour: 'red', blink: true, detail: `Embosser stopped: ${s.haltReason || 'needs a restart'}` }
    default: return { label: 'LINK', colour: 'red', detail: 'No contact with the embosser' }
  }
}

const sdLed = (s: IEmbosserStatus): ILed => {
  if (s.sdPrinting) return { label: 'SD', colour: 'blue', blink: true, detail: `Printing from SD card ${Math.round(s.progress)}%` }
  if (s.sd === 'ok') return { label: 'SD', colour: 'green', detail: 'SD card ready' }
  if (s.sd === 'missing') return { label: 'SD', colour: 'red', detail: 'No SD card in the embosser' }
  return { label: 'SD', colour: 'grey', detail: 'SD card status unknown' }
}

const endstopLed = (label: string, v: IEmbosserStatus['xEndstop'], what: string): ILed => {
  if (v === 'triggered') return { label, colour: 'amber', detail: `${what}: triggered` }
  if (v === 'open') return { label, colour: 'green', detail: `${what}: open` }
  return { label, colour: 'grey', detail: `${what}: unknown` }
}

interface IStatusBar {
  status: IEmbosserStatus
  className?: string
}

const StatusBar = ({ status, className }: IStatusBar) => {
  const live = status.link === 'ok' || status.link === 'busy'
  const leds: ILed[] = [
    linkLed(status),
    sdLed(status),
    endstopLed('X STOP', live ? status.xEndstop : 'unknown', 'X endstop'),
    endstopLed('PAPER', live ? status.paperSensor : 'unknown', 'Paper sensor (Y endstop)'),
    { label: 'POWER', colour: 'grey', detail: 'Supply voltage is not measured on this board yet' },
  ]
  return (
    <div className={`br-status ${className || ''}`}>
      {leds.map((l) => <Led key={l.label} {...l} />)}
    </div>
  )
}

export default StatusBar
