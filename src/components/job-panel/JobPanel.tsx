//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { LinearProgress, Typography } from '@mui/material'
import { IJobState } from '../../lib/embosser'

const phaseText: Record<IJobState['phase'], string> = {
  'idle': 'Ready',
  'connecting': 'Connecting to the embosser…',
  'uploading': 'Sending to the embosser',
  'starting': 'Starting…',
  'loading paper': 'Homing and loading paper…',
  'printing': 'Embossing',
  'cancelling': 'Cancelling…',
  'done': 'Done',
  'cancelled': 'Cancelled',
  'failed': 'Failed',
  'no contact': 'No contact with the embosser',
}

interface IJobPanel {
  job: IJobState
  className?: string
}

const JobPanel = ({ job, className }: IJobPanel) => {
  const showPct = job.phase === 'uploading' || job.phase === 'printing'
  const indeterminate = job.phase === 'connecting' || job.phase === 'starting' || job.phase === 'loading paper' || job.phase === 'cancelling'
  return (
    <div className={className || ''} aria-live="polite">
      <Typography>
        {phaseText[job.phase]}{showPct ? ` ${Math.round(job.progress)}%` : ''}
        {job.message ? ` — ${job.message}` : ''}
      </Typography>
      <LinearProgress
        variant={indeterminate ? 'indeterminate' : 'determinate'}
        value={job.phase === 'done' ? 100 : job.progress}
        color={job.phase === 'failed' || job.phase === 'no contact' ? 'error' : 'primary'}
      />
    </div>
  )
}

export default JobPanel
