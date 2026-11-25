//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { ChangeEvent, useEffect, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  FormControlLabel,
  Switch,
  SelectChangeEvent,
  TextField,
} from '@mui/material'
import { brailleTableOptions } from '../../assets/language-tables/brailleTable'
import { BrailleSize, PaperPreset, brailleSizes, paperPresets } from '../../lib/script'

export const BaudRateArray = [
  2400, 9600, 19200, 38400, 57600, 115200, 250000, 500000, 1000000,
]

export type Connection = 'wifi' | 'usb'

export interface IBrailleSettings {
  tableName: string
  homeY: boolean
  ejectPaper: boolean
  velocity: number
  restrictSerialPort: boolean
  baudRate: number
  connection: Connection
  host: string
  paper: PaperPreset
  brailleSize: BrailleSize
  paperSensorInverted: boolean   // false: Y endstop TRIGGERED = paper present
}

interface IUiSettings {
  settings: IBrailleSettings
  show: boolean
  handleClose: (settings: IBrailleSettings) => void
  onRestartEmbosser?: () => void
}

const UiSettings = (props: IUiSettings) => {
  const [state, setState] = useState(props.settings)
  const [confirmRestart, setConfirmRestart] = useState(false)
  useEffect(() => {
    if (props.show) {
      setState(props.settings)
      setConfirmRestart(false)
    }
  }, [props.show])

  const handleClose = () => {
    props.handleClose(state)
  }

  const selectChanged = (event: SelectChangeEvent<string | number>) => {
    setState({
      ...state,
      [event.target.name]: event.target.value,
    })
  }

  const switchChanged = (event: ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setState({
      ...state,
      [event.target.name]: checked,
    })
  }

  const select = (
    name: keyof IBrailleSettings,
    label: string,
    options: (string | number)[]
  ) => (
    <FormControl fullWidth className="br-ui-settings__drop-down">
      <InputLabel id={`${name}-select-label`}>{label}</InputLabel>
      <Select
        labelId={`${name}-select-label`}
        id={`${name}-select`}
        name={name}
        value={state[name] as string | number}
        label={label}
        onChange={selectChanged}
      >
        {options.map((element) => (
          <MenuItem key={element} value={element}>
            {element}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )

  return (
    <Dialog open={props.show}>
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ marginBottom: '16px' }}>
          Braille, paper and embosser connection.
        </DialogContentText>
        {select('tableName', 'Braille table', brailleTableOptions)}
        {select('paper', 'Paper', Object.keys(paperPresets))}
        {select('brailleSize', 'Braille size', Object.keys(brailleSizes))}
        <FormControl fullWidth className="br-ui-settings__drop-down">
          <InputLabel id="connection-select-label">Embosser connection</InputLabel>
          <Select
            labelId="connection-select-label"
            id="connection-select"
            name="connection"
            value={state.connection}
            label="Embosser connection"
            onChange={selectChanged}
          >
            <MenuItem value="wifi">WiFi (SD card on the embosser)</MenuItem>
            <MenuItem value="usb">USB cable (desktop Chrome / Edge)</MenuItem>
          </Select>
        </FormControl>
        {state.connection === 'wifi' && (
          <TextField
            fullWidth
            className="br-ui-settings__drop-down"
            label="Embosser address"
            helperText="Leave as is when this page was opened from the embosser"
            value={state.host}
            onChange={(e) => setState({ ...state, host: e.target.value.trim() })}
          />
        )}
        {state.connection === 'usb' && select('baudRate', 'Baud rate', BaudRateArray)}
        {state.connection === 'wifi' && (
          <FormControl>
            <FormControlLabel
              control={<Switch checked={state.paperSensorInverted} onChange={switchChanged} name="paperSensorInverted" />}
              label="paper sensor reads 'open' when paper is in"
            />
          </FormControl>
        )}
        <FormControl>
          <FormControlLabel
            control={<Switch checked={state.homeY} onChange={switchChanged} name="homeY" />}
            label="load paper in the beginning"
          />
        </FormControl>
        <FormControl>
          <FormControlLabel
            control={<Switch checked={state.ejectPaper} onChange={switchChanged} name="ejectPaper" />}
            label="eject paper when finished"
          />
        </FormControl>
        {state.connection === 'usb' && (
          <FormControl>
            <FormControlLabel
              control={
                <Switch
                  checked={state.restrictSerialPort}
                  onChange={switchChanged}
                  name="restrictSerialPort"
                />
              }
              label="only list CH340 serial ports"
            />
          </FormControl>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        {state.connection === 'wifi' && props.onRestartEmbosser ? (
          <Button
            color="error"
            variant={confirmRestart ? 'contained' : 'text'}
            onClick={() => {
              if (!confirmRestart) {
                setConfirmRestart(true)
                return
              }
              setConfirmRestart(false)
              props.onRestartEmbosser?.()
            }}
          >
            {confirmRestart ? 'Tap again to restart' : 'Restart embosser'}
          </Button>
        ) : <span />}
        <Button onClick={handleClose}>Save and exit</Button>
      </DialogActions>
    </Dialog>
  )
}

export default UiSettings
