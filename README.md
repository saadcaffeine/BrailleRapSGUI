# BrailleRAP SG UI

Web interface for the Singapore **BrailleRAP XL** embosser. Type text on a phone or computer, preview the Braille, and emboss it over **WiFi**. The page itself is served from the embosser's ESP32 (MKS TinyBee running [MarlinBraille2 `xl-sg`](https://github.com/saadcaffeine/MarlinBraille2/tree/xl-sg) with ESP3D).

Fork of [kyjanond/BrailleRapUI](https://github.com/kyjanond/BrailleRapUI) (BrailleRap Bhutan, MIT). Thanks, Ondrej and the ALU team at CST Fablab.

## What's different from the Bhutan version

- **WiFi printing via the SD card.** The G-code is uploaded to the embosser's microSD card through ESP3D (`/upload`), then started with `M23`/`M24`. Progress comes from `M27`, and **Cancel** sends `M524`. The job runs from the card, so it keeps going if the phone sleeps. USB (Web Serial, desktop Chrome/Edge) is still available as an option.
- **English UEB Grade 1** table: capital and capitalised-word indicators, numeric indicator, grade 1 indicator after numbers, and UEB punctuation. The original `english` table was actually **French** Braille, so it is now labelled *French (original BrailleRap)*.
- **Paper presets:** A3 (BrailleRAP XL, default), A4 on XL, and A4 (original BrailleRAP).
- **Braille size:** *standard* (2.5 mm dot / 6 mm cell / 10 mm line) by default, or the original larger Bhutan spacing.
- Warns when text overflows the sheet or contains characters the table can't translate.
- Settings are remembered in the browser. The default baud rate is 250000 (MarlinBraille2).
- Single-file build for the ESP32: `esp/braille.html.gz`, about 260 KB.

## How it works

### From the page to the electronics

The page runs entirely in the browser and talks to the embosser's ESP32 over WiFi. ESP3DLib (core 0) serves the page, takes the G-code upload to the SD card and passes commands to MarlinBraille2 (core 1), which drives the motors and the solenoid. A USB cable to a desktop browser (dotted path) is the fallback.

```mermaid
flowchart TB
    UI["<b>braille.html</b> in any browser<br/>UEB translation, G-code, status lights"]
    WIFI["<b>WiFi</b><br/>HTTP /command and /upload<br/>WebSocket :81, output every 500 ms"]
    USB["<b>USB serial</b><br/>Web Serial via CH340<br/>desktop Chrome or Edge"]
    subgraph ESP32["ESP32 on the MKS TinyBee"]
        direction LR
        ESP3D["<b>ESP3DLib</b>, core 0<br/>web server, SD upload,<br/>restart and e-stop"]
        MARLIN["<b>MarlinBraille2</b>, core 1<br/>G-code queue, planner,<br/>M3 solenoid pulse"]
        ESP3D <-->|Serial2Socket| MARLIN
    end
    UI --> WIFI --> ESP3D
    UI -.-> USB -.-> MARLIN
    MARLIN --> I2S["<b>I2S expander</b><br/>step, dir, HB output"]
    ES["<b>Endstop inputs</b><br/>IO33 X, IO32 paper"] --> MARLIN
    ESP3D -->|writes braille.gco| SD["<b>microSD</b><br/>SPI, CS on IO5"]
    SD -->|M23, M24 reads| MARLIN
    I2S --> DRV["<b>TMC2209 drivers</b><br/>X carriage, Y paper feed"]
    I2S --> SOL["<b>Solenoid</b> on HB<br/>flyback diode and LED"]
    SW["<b>Switches</b><br/>X limit, paper sensor"] --> ES
```

Three details matter when debugging:
- **Bursty updates.** ESP3DLib's Serial2Socket forwards Marlin's output to the WebSocket only every 500 ms, so the dot count and preview update in steps rather than per dot.
- **Two writers on the SD card.** ESP3DLib writes `braille.gco` during an upload, and Marlin reads it with `M23` and `M24`. Config changes need a **clean build** of the firmware, or ESP3DLib can end up compiled without SD support.
- **The emergency stop bypasses Marlin.** It asks ESP3DLib to restart the whole ESP32 (`[ESP444]RESTART`), so it works even when Marlin is halted or busy homing. `M112` would only wait in Marlin's queue.

### Job states

A print job as the page and the firmware see it. The G-code carries `M118 BR:` markers (`HOMING`, `PAPER`, `PRINT`, `DOT n/N`, `EJECT`, `END`), which drive the staged progress bar.

```mermaid
stateDiagram-v2
    direction TB
    state "Idle" as Idle
    state "Upload and start" as Upload
    state "Homing" as Homing
    state "Loading paper" as Paper
    state "Embossing" as Emboss
    state "Ejecting" as Eject
    state "Done" as Done
    state "Paper not loaded" as NoPaper
    state "Halted" as Halted
    state "Cancelled" as Cancelled
    state "Restarting" as Restart

    [*] --> Idle
    Idle --> Upload : PRINT
    Upload --> Idle : no SD card or upload failed
    Upload --> Homing : M23, M24, BR HOMING, G28 X
    Homing --> Paper : BR PAPER, G28 Y
    Paper --> Emboss : BR PRINT
    Emboss --> Eject : BR EJECT
    Eject --> Done : BR END, M84
    Done --> Idle

    Paper --> NoPaper : Error Paper not loaded
    NoPaper --> Homing : RETRY re-runs the SD file
    Homing --> Halted : homing failed, kill()
    Halted --> Restart : RESTART EMBOSSER
    Homing --> Cancelled : CANCEL, M524
    Paper --> Cancelled : CANCEL, M524
    Emboss --> Cancelled : CANCEL, M524
    Cancelled --> Idle : G28 X, M84
    Restart --> Idle : controller back online

    note right of Restart
        The emergency stop restarts the
        controller from any state.
        No self test runs after it.
    end note
```

- **Cancel during homing or paper loading** only takes effect once that move ends, because `G28` blocks Marlin's queue.
- **Lost contact is not a state.** The job keeps running from the SD card, and the page picks it up again when contact returns, or after a reload.

## Install on the embosser

1. Flash [MarlinBraille2 `xl-sg-v1.0.0`](https://github.com/saadcaffeine/MarlinBraille2/releases/tag/xl-sg-v1.0.0) or later. It needs `ESP3D_WIFISUPPORT` and `SDSUPPORT`, built with a **clean build**. Put a FAT32 microSD card in the TinyBee.
2. Join the embosser's WiFi and open `http://192.168.0.1/?forcefallback=yes`.
3. Upload **`esp/braille.html.gz`** to the ESP3D flash (the same place as `index.html.gz`). Keep the file name.
4. Open **`http://192.168.0.1/braille.html`**. ESP3D serves the gzipped file automatically.

ESP3D's own interface stays at `http://192.168.0.1/` for setup and manual control.

## Develop

```
yarn install
yarn dev          # https://localhost:8080 (USB / Web Serial)
yarn build:esp    # -> dist-esp/braille.html(.gz) for the ESP32
```

### Test against a mock embosser

`test/esp3d-mock/` has a mock ESP3D + Marlin server (upload, `M23`/`M24`/`M27`/`M524`, websocket) and a Playwright test. The test types text on a phone-sized screen, prints, decodes the uploaded G-code back into Braille cells and checks them against UEB, then checks cancel.

```
cd test/esp3d-mock && npm install
node server.mjs ../../dist-esp/braille.html.gz &
python3 test_flow.py
```

## Limitations

- Grade 2 (contracted) UEB is not supported yet. It needs a rule-based translator such as LibLouis.
- One sheet per job: text that doesn't fit is cut off, with a warning.

---

![BrailleRap Bhutan](src/assets/images/braillerap-bhutan.png)
# BrailleRapUI
- See current version online: https://braille-rap-ui.ok-y.xyz
- This project was created as a part of the team effort of the **Assistive Learning Units (ALU)** group from the CST Fablab in Phuentsholing, Bhutan for the Fab Bhutan Challenge 2023 - Designing Resilient Futures. 
- The project was created for the BrailleRap Bhutan iteration https://github.com/kyjanond/BrailleRap
- Parts of the code are modified pieces of the https://github.com/crocsg/BrailleRap project.
- It was created fast, dirty and it probably contains lots of bugs. No guarantees.
- To be able to send the data your browser needs to support the web Serial API (more info: https://developer.mozilla.org/en-US/docs/Web/API/Serial)

### install and run locally
```
yarn install
yarn dev
```

### usage
- connect an opensource BrailleRap printer (see: https://github.com/kyjanond/BrailleRap) with a USB cable
- type text in the input area and hit 'generate'
- hit 'print' and select the connected printer in the popup dialog
- wait for the result
