//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { Button } from '@mui/material'
import EStopButton from '../estop/EStopButton'

export interface IControlsProps {
  className?: string
  canPrint: boolean
  busy?: boolean            // a job is running: PRINT and GENERATE are disabled
  canCancel?: boolean
  canStop?: boolean
  showStop?: boolean
  onCancelClicked?: () => void
  onStopClicked?: () => void
  onSendClicked: () => void
  onGenerateClicked: () => void
}

const Controls = (props: IControlsProps) => {
  return (
    <div className={`${props.className ? props.className : ''}`}>
      <Button variant='contained' disabled={props.busy} onClick={props.onGenerateClicked}>
        GENERATE
      </Button>
      <Button disabled={!props.canPrint || props.busy} variant='contained' onClick={props.onSendClicked}>
        PRINT
      </Button>
      {props.canCancel && (
        <Button variant='outlined' color='error' onClick={() => props.onCancelClicked && props.onCancelClicked()}>
          CANCEL
        </Button>
      )}
      {props.showStop && (
        <EStopButton disabled={!props.canStop} onClick={() => props.onStopClicked && props.onStopClicked()} />
      )}
    </div>
  )
}

export default Controls
