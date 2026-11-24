//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { Typography } from '@mui/material'

interface IUiFooter {
  className?:string
}

const UiFooter = (props:IUiFooter)=>{
  return(
    <div className={props.className}>
      <div className='br-ui-footer__text-wrapper'>
        <Typography variant='body2'>
          Based on BrailleRap Bhutan UI by Ondrej Kyjanek and the Assistive Learning Units team,
          CST Fablab, Phuentsholing ♡
        </Typography>
      </div>
    </div>
  )
}

export default UiFooter
