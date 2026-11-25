//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as paper from 'paper'
import { IPosition2D } from '../../lib/script'
import { Paper } from '@mui/material'

export interface IBrailleCanvasProps {
  dots: IPosition2D[]          // in embossing order (as in the G-code)
  paperWidth: number
  className?: string
  embossed?: number            // dots embossed so far in the running job (undefined = no job)
}

const dotRadiusMm = 0.75 // ~1.5 mm embossed dot
const minDotRadiusPx = 1.6

const BrailleCanvas = (props: IBrailleCanvasProps) => {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const [pxMmRatio, setPxMmRatio] = useState(5)
  const [flash, setFlash] = useState(false)

  // flash the panel each time a dot is embossed
  useEffect(() => {
    if (!props.embossed) return
    setFlash(false)
    const raf = window.requestAnimationFrame(() => setFlash(true))
    const t = window.setTimeout(() => setFlash(false), 200)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [props.embossed])

  const handleWindowResize = () => {
    const width = ref.current?.clientWidth ?? 1
    const height = ref.current?.clientHeight ?? 1
    setPxMmRatio(width / props.paperWidth)
    setWidth(width)
    setHeight(height)
  }

  useEffect(() => {
    handleWindowResize()
    paper.setup('braille-canvas')
    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
    }
  }, [])

  useEffect(() => {
    if (!paper.project) {
      return
    }
    paper.project.clear()
    paper.view.viewSize.width = width
    paper.view.viewSize.height = height
    const r = Math.max(minDotRadiusPx, dotRadiusMm * pxMmRatio)
    const job = props.embossed !== undefined
    props.dots.forEach((dot, i) => {
      const _pt = new paper.Point(dot.x * pxMmRatio, dot.y * pxMmRatio)
      const current = job && i === (props.embossed as number) - 1
      const dotPath = new paper.Path.Circle(_pt, current ? r * 1.8 : r)
      // during a job: embossed dots black, the dot just fired orange, the rest light grey
      dotPath.fillColor = new paper.Color(!job ? 'black' : current ? '#f2a516' : i < (props.embossed as number) ? 'black' : '#c4c8ce')
    })
  }, [props.dots, width, pxMmRatio, props.embossed])

  useEffect(() => {
    handleWindowResize()
  }, [props.paperWidth])

  return (
    <Paper className={`${props.className || ''}${flash ? ' br-flash' : ''}`} variant="outlined" data-embossed={props.embossed ?? ''}>
      <canvas ref={ref} id="braille-canvas" />
    </Paper>
  )
}

export default BrailleCanvas
