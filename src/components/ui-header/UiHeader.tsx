//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'
import { IconButton, Typography } from '@mui/material'
import SettingsIcon from '@mui/icons-material/Settings'

interface IUiHeader {
  className?: string
  onSettingsClicked?: () => void
}

// Six-dot cell icon drawn inline (keeps the on-board build small)
const BrailleIcon = () => (
  <svg className='br-ui-header__logo' viewBox='0 0 30 44' width='30' height='44' aria-hidden='true'>
    {[[8, 8], [8, 22], [22, 8], [22, 36]].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r='5' fill='currentColor' />
    ))}
    {[[8, 36], [22, 22]].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r='4.2' fill='none' stroke='currentColor' strokeWidth='1.2' />
    ))}
  </svg>
)

const UiHeader = (props: IUiHeader) => {
  return (
    <div className={props.className}>
      <BrailleIcon />
      <Typography variant='h3'>
        BRAILLERAP SG
      </Typography>
      {props.onSettingsClicked && (
        <IconButton
          className='br-ui-header__settings'
          aria-label='Settings'
          title='Settings'
          onClick={props.onSettingsClicked}
          size='large'
        >
          <SettingsIcon fontSize='inherit' />
        </IconButton>
      )}
    </div>
  )
}

export default UiHeader
