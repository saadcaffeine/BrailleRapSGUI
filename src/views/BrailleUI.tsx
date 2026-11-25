//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useState } from 'react'
import TextInput from '../components/text-input/TextInput'
import Controls from '../components/controls/Controls'
import { IPosition2D, brailleToGCodeResult, paperPresets } from '../lib/script'
import BrailleCanvas from '../components/braille-canvas/BrailleCanvas'
import { gcodeParse } from '../lib/brailleDraw'
import { ISerialState, sendSerial, isSerialCompatible } from '../lib/serial'
import { IEsp3dJob, printViaEsp3d } from '../lib/esp3d'
import UiAlert, { IUiAlertProps } from '../components/ui-alert/UiAlert'
import './brailleUi.scss'
import UiHeader from '../components/ui-header/UiHeader'
import UiFooter from '../components/ui-footer/UiFooter'
import UiSettings, {
  IBrailleSettings,
} from '../components/ui-settings/UiSettings'
import { brailleTableOptions } from '../assets/language-tables/brailleTable'
import PrintState from '../components/print-state/PrintState'

let isPrinting = false
let currentJob: IEsp3dJob | undefined

// Served from the embosser (plain http on a LAN address) -> WiFi; otherwise USB
const servedFromEmbosser =
  window.location.protocol === 'http:' &&
  !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)

const defaultSettings: IBrailleSettings = {
  tableName: brailleTableOptions[0],
  homeY: true,
  ejectPaper: true,
  velocity: 2000,
  restrictSerialPort: false,
  baudRate: 250000, // MarlinBraille2 default
  connection: servedFromEmbosser ? 'wifi' : 'usb',
  host: window.location.host,
  paper: 'A3 (BrailleRAP XL)',
  brailleSize: 'standard',
}

const SETTINGS_KEY = 'braillerap-sg-settings'
const loadSettings = (): IBrailleSettings => {
  try {
    const saved = window.localStorage.getItem(SETTINGS_KEY)
    if (saved) {
      const parsed = { ...defaultSettings, ...(JSON.parse(saved) as Partial<IBrailleSettings>) }
      if (!brailleTableOptions.includes(parsed.tableName)) parsed.tableName = defaultSettings.tableName
      return parsed
    }
  } catch (e) {
    console.warn('Could not read saved settings', e)
  }
  return defaultSettings
}
const saveSettings = (settings: IBrailleSettings) => {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('Could not save settings', e)
  }
}

const defualtSerialState: ISerialState = {
  state: 'idle',
  progress: 0,
}

const BrailleUI = () => {
  const [brailleSettings, setBrailleSettings] = useState(loadSettings)
  const [text, setText] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [gcode, setGcode] = useState('')
  const [paths, setPaths] = useState([] as IPosition2D[])
  const [printState, setPrintState] = useState(defualtSerialState)
  const [alert, setAlert] = useState({
    title: 'ERROR',
    message: '',
    show: false,
    handleClose: () => {
      setAlert({ show: false })
    },
  } as IUiAlertProps)

  const showAlert = (title: string, message: string) => {
    setAlert({
      title,
      message,
      show: true,
      handleClose: () => {
        setAlert({ show: false })
      },
    })
  }

  const handlePrinterInfo = (info: string) => {
    console.debug(info)
  }

  const handleTextChanged = (value: string) => {
    setText(value)
    if (gcode.length > 0) {
      setGcode('')
    }
    if (paths.length > 0) [setPaths([])]
  }
  const handleSendClicked = () => {
    if (isPrinting) {
      showAlert('WARNING', 'Already printing. Wait!')
      return
    } else if (gcode.length === 0) {
      showAlert('ERROR', 'There is nothing to print')
      return
    }
    if (brailleSettings.connection === 'wifi') {
      isPrinting = true
      printViaEsp3d(gcode, {
        host: brailleSettings.host,
        onState: (state: ISerialState) => setPrintState(state),
      })
        .then((job) => {
          currentJob = job
          return job.done
        })
        .catch((err: Error) => {
          setPrintState({ state: 'idle', progress: 0 })
          showAlert('ERROR', err.message)
        })
        .finally(() => {
          isPrinting = false
          currentJob = undefined
        })
      return
    }
    if (!isSerialCompatible()) {
      showAlert(
        'ERROR',
        'USB printing needs desktop Chrome or Edge. On a phone, open this page from the embosser\'s WiFi and choose the WiFi connection in Settings.'
      )
      return
    }
    isPrinting = true
    sendSerial(
      gcode.split('\n'),
      brailleSettings.baudRate,
      brailleSettings.restrictSerialPort,
      handlePrinterInfo,
      (state: ISerialState) => setPrintState(state)
    )
      .catch((err: Error) => {
        showAlert('ERROR', `${err.message}`)
      })
      .finally(() => (isPrinting = false))
  }
  const handleCancelClicked = () => {
    if (!currentJob) return
    currentJob.cancel().catch((err: Error) => showAlert('ERROR', `Cancel failed: ${err.message}`))
  }
  const handleGenerateClicked = () => {
    if (text.length === 0) {
      showAlert('ERROR', 'There is no text to generate braille for.')
      return
    }
    const result = brailleToGCodeResult(text, brailleSettings)
    const _gcode = result?.gcode || ''
    setGcode(_gcode)
    setPaths(gcodeParse(_gcode))
    const warnings: string[] = []
    if (result?.truncated) warnings.push(`The text does not fit on one ${brailleSettings.paper} sheet; only the first page will be embossed.`)
    if (result?.unknownChars.length) warnings.push(`These characters are not in the braille table and were skipped: ${result.unknownChars.join(' ')}`)
    if (warnings.length) showAlert('WARNING', warnings.join(' '))
  }
  const handleSettingsClose = (settings: IBrailleSettings) => {
    setBrailleSettings(settings)
    saveSettings(settings)
    setShowSettings(false)
    if (gcode.length > 0) {
      setGcode('')
    }
    if (paths.length > 0) [setPaths([])]
  }
  const handleSettingsClicked = () => {
    setShowSettings(true)
  }
  const handleDebugClicked = () => {}
  return (
    <div>
      <div className="br-ui">
        <UiHeader className="br-ui-header" />
        <div className="br-ui-input">
          <TextInput
            className="br-ui-input__text"
            onChange={handleTextChanged}
          />
          <BrailleCanvas
            className="br-ui-input__braille-canvas"
            dots={paths}
            paperWidth={(paperPresets[brailleSettings.paper] || paperPresets['A3 (BrailleRAP XL)']).paperWidth}
          />
        </div>
        <div className="br-ui-controls">
          <Controls
            canPrint={gcode.length > 0}
            className="br-ui-controls__btns"
            onSendClicked={handleSendClicked}
            canCancel={brailleSettings.connection === 'wifi' && printState.state === 'printing'}
            onCancelClicked={handleCancelClicked}
            onGenerateClicked={handleGenerateClicked}
            onDebugClicked={handleDebugClicked}
            onSettingsClicked={handleSettingsClicked}
          />
          <PrintState
            className="br-ui-controls__print-state"
            state={printState}
          />
        </div>
        <UiFooter className="br-ui-footer" />
      </div>
      <UiSettings
        show={showSettings}
        handleClose={handleSettingsClose}
        settings={brailleSettings}
      />
      <UiAlert {...alert} />
    </div>
  )
}

export default BrailleUI
