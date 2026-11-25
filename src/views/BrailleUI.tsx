//@ts-ignore: : needs React
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React, { useEffect, useState } from 'react'
import TextInput from '../components/text-input/TextInput'
import Controls from '../components/controls/Controls'
import { IPosition2D, brailleToGCodeResult, paperPresets } from '../lib/script'
import BrailleCanvas from '../components/braille-canvas/BrailleCanvas'
import { gcodeParse } from '../lib/brailleDraw'
import { ISerialState, sendSerial, isSerialCompatible } from '../lib/serial'
import { embosser, IEmbosserStatus, IJobState, JobError } from '../lib/embosser'
import StatusBar from '../components/status-bar/StatusBar'
import JobPanel from '../components/job-panel/JobPanel'
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
let currentJob: { done: Promise<void>; cancel: () => Promise<void> } | undefined

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
  paperSensorInverted: false,
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
  const [embStatus, setEmbStatus] = useState<IEmbosserStatus>(embosser.status)
  const [job, setJob] = useState<IJobState>({ phase: 'idle', progress: 0 })
  const wifi = brailleSettings.connection === 'wifi'
  const jobBusy = wifi
    ? ['connecting', 'uploading', 'starting', 'homing', 'loading paper', 'printing', 'ejecting', 'cancelling', 'no contact'].includes(job.phase)
    : ['connecting', 'connected', 'printing'].includes(printState.state)

  // live status from the embosser while in WiFi mode
  useEffect(() => {
    if (!wifi) return
    embosser.start(brailleSettings.host)
    const off = embosser.subscribe(setEmbStatus)
    return () => {
      off()
      embosser.stop()
    }
  }, [wifi, brailleSettings.host])

  // after a restart (STOP, Settings or halt recovery) clear the "restarting" text once the link is back
  useEffect(() => {
    if (embStatus.link !== 'ok') return
    setJob((prev) =>
      prev.message && /restart/i.test(prev.message)
        ? { ...prev, phase: prev.phase === 'stopped' ? 'stopped' : 'idle', message: 'embosser ready' }
        : prev
    )
  }, [embStatus.link])

  // a job is running on the SD card that this page did not start (page reloaded,
  // another phone, contact lost and regained): follow it so it can be watched and cancelled
  useEffect(() => {
    if (!wifi || isPrinting || !embStatus.sdPrinting) return
    isPrinting = true
    const watched = embosser.watchJob(setJob)
    currentJob = watched
    watched.done.catch(handleJobError).finally(() => {
      isPrinting = false
      currentJob = undefined
    })
  }, [wifi, embStatus.sdPrinting])
  const [alert, setAlert] = useState<IUiAlertProps>({
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
  const closeAlert = () => setAlert({ show: false })

  // upload === undefined -> re-run the file already on the SD card (Retry)
  const runWifiJob = (upload: string | undefined) => {
    if (isPrinting) {
      showAlert('WARNING', 'The embosser is already busy with a job.')
      return
    }
    isPrinting = true
    const homeY = brailleSettings.homeY
    embosser
      .print(upload, (st) => setJob({ ...st, homeY }))
      .then((j) => {
        currentJob = j
        return j.done
      })
      .catch(handleJobError)
      .finally(() => {
        isPrinting = false
        currentJob = undefined
      })
  }

  const restartEmbosser = () => {
    setJob({ phase: 'connecting', progress: 0, message: 'Restarting the embosser…' })
    void embosser.restart()
    setAlert({
      title: 'RESTARTING',
      message: 'The embosser is restarting. Wait until the LINK light is green, check the paper, then press Retry.',
      show: true,
      handleClose: closeAlert,
      actions: [{ label: 'RETRY', onClick: () => { closeAlert(); runWifiJob(undefined) } }],
    })
  }

  function handleJobError(err: unknown) {
    const e = err as JobError
    const kind = e instanceof JobError ? e.kind : 'other'
    // keep where it failed (set by the job watcher) so the progress bar marks that stage
    setJob((prev) => ({
      ...prev,
      phase: 'failed',
      failedAt: prev.phase === 'failed' ? prev.failedAt : kind === 'paper' ? 'paper' : undefined,
      message: kind === 'paper' ? 'paper did not load' : kind === 'halted' ? 'embosser stopped' : undefined,
    }))
    const actions: IUiAlertProps['actions'] = []
    if (kind === 'paper' || kind === 'lost') actions.push({ label: 'RETRY', onClick: () => { closeAlert(); runWifiJob(undefined) } })
    if (kind === 'halted' || kind === 'not-responding') actions.push({ label: 'RESTART EMBOSSER', onClick: restartEmbosser })
    setAlert({
      title: kind === 'paper' ? 'PAPER' : kind === 'halted' ? 'EMBOSSER STOPPED' : 'ERROR',
      message: e?.message || String(err),
      show: true,
      handleClose: closeAlert,
      actions,
    })
  }

  const handleSendClicked = () => {
    if (isPrinting) {
      showAlert('WARNING', 'Already printing. Wait!')
      return
    } else if (gcode.length === 0) {
      showAlert('ERROR', 'There is nothing to print')
      return
    }
    if (wifi) {
      runWifiJob(gcode)
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
  // STOP: Marlin on the ESP32 has no working emergency parser, so M112 would wait in the
  // queue. Restarting the controller through ESP3D stops all motion immediately.
  const handleStopClicked = () => {
    const running = isPrinting
    void embosser.restart()
    if (!running) setJob({ phase: 'stopped', progress: 0, message: 'restarting the embosser…' })
  }
  const handleRestartFromSettings = () => {
    setShowSettings(false)
    void embosser.restart()
    if (!isPrinting) setJob({ phase: 'idle', progress: 0, message: 'Restarting the embosser…' })
    showAlert('RESTARTING', 'The embosser is restarting. The LINK light turns green when it is ready.')
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
  return (
    <div>
      <div className="br-ui">
        <UiHeader className="br-ui-header" onSettingsClicked={handleSettingsClicked} />
        {wifi && <StatusBar status={embStatus} paperSensorInverted={brailleSettings.paperSensorInverted} />}
        <div className="br-ui-input">
          <TextInput
            className="br-ui-input__text"
            onChange={handleTextChanged}
          />
          <BrailleCanvas
            className="br-ui-input__braille-canvas"
            dots={paths}
            paperWidth={(paperPresets[brailleSettings.paper] || paperPresets['A3 (BrailleRAP XL)']).paperWidth}
            embossed={wifi && ['printing', 'cancelling', 'ejecting'].includes(job.phase) ? job.dot ?? 0 : undefined}
          />
        </div>
        <div className="br-ui-controls">
          <Controls
            canPrint={gcode.length > 0}
            busy={jobBusy}
            className="br-ui-controls__btns"
            onSendClicked={handleSendClicked}
            canCancel={wifi && ['homing', 'loading paper', 'printing', 'starting', 'no contact'].includes(job.phase)}
            onCancelClicked={handleCancelClicked}
            showStop={wifi}
            canStop={embStatus.link !== 'connecting'}
            onStopClicked={handleStopClicked}
            onGenerateClicked={handleGenerateClicked}
          />
          {wifi ? (
            <JobPanel className="br-ui-controls__print-state" job={job} />
          ) : (
            <PrintState
              className="br-ui-controls__print-state"
              state={printState}
            />
          )}
        </div>
        <UiFooter className="br-ui-footer" />
      </div>
      <UiSettings
        show={showSettings}
        handleClose={handleSettingsClose}
        settings={brailleSettings}
        onRestartEmbosser={handleRestartFromSettings}
      />
      <UiAlert {...alert} />
    </div>
  )
}

export default BrailleUI
