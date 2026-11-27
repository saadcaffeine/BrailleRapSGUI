//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import './estop.scss'

interface IEStopButton {
  disabled?: boolean
  onClick: () => void
  className?: string
}

// Emergency stop: red mushroom head on a yellow collar, like a machine e-stop.
const EStopButton = ({ disabled, onClick, className }: IEStopButton) => (
  <button
    type="button"
    className={`br-estop ${className || ''}`}
    aria-label="Emergency stop"
    title="Emergency stop: stops all motion at once by restarting the embosser controller"
    disabled={disabled}
    onClick={onClick}
  >
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle cx="32" cy="32" r="31" fill="#f5c400" stroke="#3a3000" strokeWidth="1.5" />
      <path id="br-estop-arc" d="M 9 32 A 23 23 0 0 1 55 32" fill="none" />
      <text fontSize="7.5" fontWeight="700" fill="#3a3000" letterSpacing="1.5">
        <textPath href="#br-estop-arc" startOffset="50%" textAnchor="middle">EMERGENCY</textPath>
      </text>
      <circle className="br-estop__head" cx="32" cy="34" r="17" fill="#d62218" stroke="#7a0f0a" strokeWidth="1.5" />
      <ellipse cx="27" cy="28" rx="7" ry="4" fill="#ffffff" opacity="0.28" />
      <text x="32" y="37.5" fontSize="9" fontWeight="700" fill="#ffffff" textAnchor="middle">STOP</text>
    </svg>
  </button>
)

export default EStopButton
