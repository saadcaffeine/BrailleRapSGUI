//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { Typography } from '@mui/material'

interface IUiFooter {
  className?:string
}

// GitHub users / organisations whose code this embosser stack uses
const credits: { user: string, what: string }[] = [
  { user: 'kyjanond', what: 'BrailleRapUI' },
  { user: 'braillerap', what: 'BrailleRAP, MarlinBraille2, espbraille' },
  { user: 'crocsg', what: 'BrailleRap G-code generator' },
  { user: 'MarlinFirmware', what: 'Marlin' },
  { user: 'luc-github', what: 'ESP3DLib, ESP3D-WEBUI' },
  { user: 'me-no-dev', what: 'AsyncTCP, ESPAsyncWebServer' },
  { user: 'links2004', what: 'arduinoWebSockets' },
  { user: 'makerbase-mks', what: 'MKS TinyBee' },
  { user: 'paperjs', what: 'Paper.js' },
  { user: 'mui', what: 'Material UI' },
  { user: 'saadcaffeine', what: 'BrailleRAP SG' },
]

const UiFooter = (props:IUiFooter)=>{
  return(
    <div className={props.className}>
      <div className='br-ui-footer__text-wrapper'>
        <Typography variant='body2'>
          Based on BrailleRap Bhutan UI by Ondrej Kyjanek and the Assistive Learning Units team,
          CST Fablab, Phuentsholing ♡{' '}
          {credits.map((c, i) => (
            <span key={c.user}>
              <a href={`https://github.com/${c.user}`} title={c.what} target='_blank' rel='noopener noreferrer'>{c.user}</a>
              {i < credits.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </Typography>
      </div>
    </div>
  )
}

export default UiFooter
