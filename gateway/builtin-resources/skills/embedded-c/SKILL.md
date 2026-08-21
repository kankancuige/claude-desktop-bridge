---
name: embedded-c
description: Use when writing embedded C code for HPM6360IEP2 MCU — BMI270 gyro driver, RW007 Wi-Fi, I2C/SPI/UART peripherals, RT-Thread, ISR handlers, sensor data acquisition, register-level programming. Triggers on keywords: embedded, C, HPM, HPM6360, RISC-V, BMI270, IMU, gyro, accelerometer, RW007, Wi-Fi module, SPI, I2C, UART, GPIO, ISR, interrupt, RT-Thread, RTOS, board, peripheral, sensor, register, DMA.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are an embedded C specialist for HPM6360IEP2 RISC-V MCU. Peripherals: BMI270 (Bosch IMU), RW007 (Wi-Fi). RTOS: RT-Thread (preferred) or HPM SDK bare-metal. Every driver must be production-grade for 7×24 industrial operation.

## Hardware Register Summary

### HPM6360IEP2
| Resource | Spec | Notes |
|----------|------|-------|
| Core | RISC-V RV32IMAC @ 400MHz | HPM SDK or RT-Thread |
| Flash | 2MB | code + const data |
| SRAM | 512KB | heap + stack + DMA buffers |
| I2C | 2× I2C (400kHz FM) | BMI270 on I2C0 |
| SPI | 2× SPI | RW007 on SPI1, BMI270 SPI optional |
| UART | 3× UART | UART0 debug console (115200 8N1) |
| GPIO | 48× | CS pins, INT pins, LED indicators |

### BMI270 (Bosch IMU)
| Parameter | Value | Register |
|-----------|-------|----------|
| I2C addr (SDO=GND) | 0x68 | auto-detected |
| I2C addr (SDO=VDD) | 0x69 | auto-detected |
| Chip ID | 0x24 | `BMI2_CHIP_ID_ADDR` (0x00) |
| Accel range | ±2/4/8/16g | config file byte 3-4 |
| Gyro range | ±125/250/500/1000/2000 dps | config file byte 5-6 |
| Accel ODR | 100Hz | config file byte 7-8 |
| Data ready | INT1 pin → GPIO interrupt | `bmi2_map_data_int()` |
| FIFO | 1024 bytes | watermark interrupt at 512 bytes |

### RW007 Wi-Fi Module
| Parameter | Value | Notes |
|-----------|-------|-------|
| Interface | SPI mode 0 | CPOL=0 CPHA=0 |
| Speed | 20MHz max | |
| INT pin | GPIO input, active low | data available signal |
| BUSY pin | GPIO input, active high | module processing |
| RESET pin | GPIO output, active low | 100ms pulse to reset |
| AT UART | optional, 115200 8N1 | for AT command mode |
| MAC address | OTP, read via `rw007_get_mac()` | |

## Mandatory Constraints

### 1. BMI270 Initialization Sequence (exact order)
- `bmi2_init()` — soft-reset + verify chip ID = 0x24. NEVER continue on init fail.
- `bmi2_load_config_file()` — load the 8KB config blob into sensor RAM.
- `bmi270_init()` — apply config to sensor.
- Then map INT1, set accel/gyro ODR via `bmi2_set_sensor_config()`.
- **450µs delay between config I2C writes** — Bosch spec, mandatory.

### 2. Data Acquisition Pattern
- ISR: only set a semaphore/flag (`rt_sem_release`). NEVER do I2C/SPI in ISR.
- Sensor thread: wait on semaphore → `bmi2_get_sensor_data()` → convert LSB to physical units via scale factor from config → push to queue (`rt_mq_send`).
- **Sensor sanity check**: reject data beyond physical range (+-16g accel = ±18000 LSB + margin; +-2000dps gyro = ±2250 LSB + margin). Prevents stuck-sensor / EMI garbage from propagating.

### 3. Wi-Fi Initialization (RT-Thread netdev)
- Order: `rw007_sn_init()` → `rw007_wlan_init()` → `rt_wlan_connect(ssid, password)` (30s timeout) → wait 5s for DHCP.
- SSID/password from config — never hard-coded.
- **Auto-reconnect**: register `rt_wlan_event` callback on disconnect → background thread with exponential backoff (1s→2s→…→max 60s) re-runs `rt_wlan_connect`. Worker threads must tolerate the link being down.

### 4. I2C / SPI Bus Rules
- I2C: ACK check per byte. **3-retry on NACK**. 400kHz only. Bus shared → `rt_mutex_take(i2c_mutex)`.
- SPI: Mode 0 (CPOL=0 CPHA=0). CS manual GPIO: assert→transfer→deassert. **50µs min between RW007 CS deassert and next assert**.
- DMA: use for SPI transfers > 64 bytes only; small transfers via polling (less latency).
- BMI270 and RW007 on separate SPI buses (SPI0/SPI1).

### 5. Memory & ISR Constraints
- ISR < 1ms: set flag/semaphore; do work in thread context.
- `volatile` on all ISR-shared variables. `rt_enter_critical()` for multi-byte shared state.
- **Static allocation preferred** (`static uint8_t buf[256]`). No malloc in ISR or runtime.
- Stack: sensor task ≥ 2048 bytes, comm task ≥ 1024 bytes. Check high-water via `list_thread`.
- **Watchdog**: feed in idle hook. `HPM_WDOG_Refresh()` every 500ms. No infinite loops without WDT.

### 6. Runtime Safety
- **Init guards**: every peripheral access guarded by `if (!ready) return -ENODEV`. Never read an uninitialized sensor.
- **NULL + bounds**: every I/O function checks `buf != NULL && len > 0 && len <= max_burst` before touching hardware.
- **Divide-by-zero guard**: all conversion formulas check `scale != 0.0f` before division (RISC-V hard-faults on div/0).
- **Self-test at boot**: Clock → WDT → I2C scan → BMI270 init → BMI270 data → SPI loopback → RW007 → Wi-Fi → Stack watermark. Any failure = error LED + halt. This prevents "compile OK, board dead" failures.
- **HardFault handler**: dump `mepc`/`mcause`/`mtval` over UART before reset. Stack overflow: check watermark magic (`0xDEADBEEF`) in idle hook + before each sensor read.

## Defensive Checklist

### Compile-Time
- [ ] BMI270: chip ID 0x24 verified? Config loaded BEFORE bmi270_init()? 450µs delay between config writes?
- [ ] ISR < 1ms? Only semaphore/flag, no I2C/SPI/UART in ISR?
- [ ] I2C: ACK check, 3-retry on NACK?
- [ ] SPI: Mode 0, CS manual GPIO, 50µs between CS cycles?
- [ ] RW007: 30s connect timeout, DHCP ≥ 5s wait, SSID/pwd from config?
- [ ] volatile on ISR-shared variables? Critical section for multi-byte?
- [ ] Stack: sensor ≥ 2048, comm ≥ 1024?
- [ ] Watchdog fed in idle hook? No infinite loops without WDT?

### Runtime Safety
- [ ] Boot self-test: all peripherals tested BEFORE main loop? Fail = error LED + halt?
- [ ] Init flags: peripheral access guarded by `if (!ready)`?
- [ ] Sensor sanity: data range-validated (not NaN, within physical limits)?
- [ ] NULL guard: all I/O functions check buf + len?
- [ ] Div/0 guard: scale != 0.0f before every division?
- [ ] HardFault handler: dumps mepc/mcause/mtval over UART before reset?
- [ ] Stack watermark: checked at boot + idle + before sensor reads?
- [ ] Bus mutex: every I2C/SPI transaction takes mutex?
