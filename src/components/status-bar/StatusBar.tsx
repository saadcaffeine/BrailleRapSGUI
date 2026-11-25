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

// X STOP: green when the carriage is on the limit switch, amber otherwise
const xStopLed = (v: IEmbosserStatus['xEndstop']): ILed => {
  if (v === 'triggered') return { label: 'X STOP', colour: 'green', detail: 'X carriage is on the limit switch' }
  if (v === 'open') return { label: 'X STOP', colour: 'amber', detail: 'X carriage is away from the limit switch' }
  return { label: 'X STOP', colour: 'grey', detail: 'X endstop: unknown' }
}

// PAPER: green only when a sheet is detected, amber otherwise
const paperLed = (v: IEmbosserStatus['paperSensor'], inverted: boolean): ILed => {
  if (v === 'unknown') return { label: 'PAPER', colour: 'grey', detail: 'Paper sensor: unknown' }
  const present = (v === 'triggered') !== inverted
  return present
    ? { label: 'PAPER', colour: 'green', detail: 'Paper detected' }
    : { label: 'PAPER', colour: 'amber', detail: 'No paper detected' }
}

interface IStatusBar {
  status: IEmbosserStatus
  paperSensorInverted?: boolean
  className?: string
}

const StatusBar = ({ status, paperSensorInverted, className }: IStatusBar) => {
  const live = status.link === 'ok' || status.link === 'busy'
  const leds: ILed[] = [
    linkLed(status),
    sdLed(status),
    xStopLed(live ? status.xEndstop : 'unknown'),
    paperLed(live ? status.paperSensor : 'unknown', !!paperSensorInverted),
    { label: 'POWER', colour: 'grey', detail: 'Supply voltage is not measured on this board yet' },
  ]
  return (
    <div className={`br-status ${className || ''}`}>
      {leds.map((l) => <Led key={l.label} {...l} />)}
    </div>
  )
}

export default StatusBar
