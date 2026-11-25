//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { Typography } from '@mui/material'
import { IJobState, JobPhase, JobStage } from '../../lib/embosser'
import './jobPanel.scss'

const phaseText: Record<JobPhase, string> = {
  'idle': 'Ready',
  'connecting': 'Connecting to the embosser…',
  'uploading': 'Sending to the embosser',
  'starting': 'Starting…',
  'homing': 'Homing',
  'loading paper': 'Loading paper',
  'printing': 'Embossing',
  'ejecting': 'Ejecting paper',
  'cancelling': 'Cancelling…',
  'done': 'Done',
  'cancelled': 'Cancelled',
  'failed': 'Failed',
  'no contact': 'No contact with the embosser',
  'stopped': 'Stopped',
}

// order of the three segments
const SEGMENTS: { key: JobStage; label: string }[] = [
  { key: 'homing', label: 'Homing' },
  { key: 'paper', label: 'Paper' },
  { key: 'printing', label: 'Embossing' },
]

const phaseStage = (p: JobPhase): JobStage | undefined =>
  p === 'homing' || p === 'starting' ? 'homing' : p === 'loading paper' ? 'paper'
    : p === 'printing' || p === 'cancelling' ? 'printing' : p === 'ejecting' ? 'eject' : undefined

type SegState = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

const segmentStates = (job: IJobState): { state: SegState; fill: number }[] => {
  const order: JobStage[] = ['homing', 'paper', 'printing', 'eject', 'end']
  const finished = job.phase === 'done'
  const ended = ['failed', 'stopped', 'cancelled'].includes(job.phase)
  const current = ended ? job.failedAt : phaseStage(job.phase)
  const curIdx = current ? order.indexOf(current) : -1
  const idle = ['idle', 'connecting', 'uploading'].includes(job.phase) || (ended && !current)
  return SEGMENTS.map((seg, i) => {
    if (seg.key === 'paper' && job.homeY === false) return { state: 'skipped', fill: 0 }
    if (finished) return { state: 'done', fill: 1 }
    if (idle || curIdx < 0) return { state: 'pending', fill: 0 }
    if (i < curIdx) return { state: 'done', fill: 1 }
    if (i > curIdx) return { state: 'pending', fill: 0 }
    const fill = seg.key === 'printing' ? Math.min(1, job.progress / 100) : 1
    return { state: ended ? 'failed' : 'active', fill }
  })
}

interface IJobPanel {
  job: IJobState
  className?: string
}

const JobPanel = ({ job, className }: IJobPanel) => {
  const segs = segmentStates(job)
  const showDots = (job.phase === 'printing' || job.phase === 'cancelling') && job.dots
  const pct = job.phase === 'uploading' ? ` ${Math.round(job.progress)}%` : ''
  return (
    <div className={`br-job ${className || ''}`} aria-live="polite">
      <Typography className="br-job__text">
        {phaseText[job.phase]}{pct}
        {showDots ? ` ${job.dot}/${job.dots} dots` : ''}
        {job.message ? ` — ${job.message}` : ''}
      </Typography>
      {job.phase === 'uploading' ? (
        <div className="br-job__bar">
          <div className="br-job__seg br-job__seg--upload">
            <div className="br-job__fill" style={{ width: `${job.progress}%` }} />
          </div>
        </div>
      ) : (
        <div className="br-job__bar" role="progressbar" aria-valuenow={Math.round(job.progress)} aria-valuemin={0} aria-valuemax={100}>
          {SEGMENTS.map((seg, i) => (
            <div key={seg.key} className={`br-job__seg br-job__seg--${seg.key} br-job__seg--${segs[i].state}`} data-state={segs[i].state}>
              <div className="br-job__fill" style={{ width: `${segs[i].fill * 100}%` }} />
              <span className="br-job__seg-label">{seg.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default JobPanel
