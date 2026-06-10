# Embedded Project Implementation Dashboard

This dashboard turns the public embedded systems portfolio into repo-level implementation tracks. Each project has a target, expected artifacts, and verification evidence so the portfolio is more than a list of ideas.

## Dashboard Location

- UI view: `Projects`
- Source data: `repo/ui/src/App.jsx`
- Public portfolio source: `https://rheslar1.github.io/BMS/portfolio`

## Implemented In Repo

| Project | Evidence |
| --- | --- |
| BEMS Edge AI Gateway | C++ edge runtime, BACnet polling, RabbitMQ command path, Docker deployment |
| nRF52840 BACnet Field Node | Field-device firmware model, persistent setpoints, BACnet object mapping |
| Production Flash and Test Rig | Production board runbook, SWUpdate checks, validation script |
| Embedded Linux / Yocto Image | Yocto layer, image recipe, edge-core recipe, SWUpdate packaging |

## Blueprinted Hardware/Firmware Tracks

| Project | Target | Verification Proof |
| --- | --- | --- |
| BACnet Wireless Field Sensor Node | Bare-metal Wi-Fi/BLE BACnet sensor node | Cooperative-loop tests, power profile, OTA rollback, MQTT smoke test |
| Closed-Loop Motor Control Platform | STM32 or ESP32 motor-control board | Step response, current limits, hardware-in-loop notes |
| Secure Bare-Metal Bootloader | MCU with protected flash slots | Signature rejection, power-loss recovery, boot log |
| Custom OTA Update System | ESP32 or STM32 dual-partition update | Staged update, bad signature, rollback drill |
| Bare-Metal Cooperative Scheduler | Bare-metal C++17 field-device firmware | IPC-style queue tests, scheduler trace, contention report |
| TinyML Sensor Anomaly Detector | ARM Cortex-M inference target | RAM/flash report, latency benchmark, sample set |
| CAN Bus ECU Simulation | SocketCAN or STM32 bus simulation | Bus error tests, filter tests, diagnostic captures |
| Low-Power Temperature Datalogger | Battery outdoor logger | Sleep-current table, runtime estimate, log export |
| SPI/I2C/UART MCU Bootloader | MCU reprogramming transport | Corrupt packet, transport swap, flash validation |
| Digi ConnectCore i.MX93 Peripheral Driver | Digi ConnectCore i.MX93 EVK | Unit tests, loopback test, scope checklist |
| DRV8801 Brushed DC Motor Controller | Brushed DC motor board | Velocity plot, position display, mode switch safety |
| Medical Wearable Power Manager | Bare-metal wearable MCU | Sleep residency, DMA capture, runtime estimate |
| Connected IoT Device | Secure MQTT bare-metal node | Cloud publish, cert rotation, battery profile, OTA smoke |
| Bare-Metal Custom Board Bring-Up | Custom PCB firmware | First-boot checklist, REPL transcript, peripheral smoke |
| Edge AI / TinyML Microcontroller | MCU edge inference demo | Memory budget, latency test, accuracy comparison |
