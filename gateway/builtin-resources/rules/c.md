---
paths: "**/*.c;**/*.h"
---

# Embedded C — see `embedded-c` skill for full rules
Stack: **HPM6360IEP2** RISC-V MCU + **BMI270** IMU (I2C/SPI) + **RW007** Wi-Fi (SPI). RTOS: **RT-Thread**.
Core constraints: ISR < 1ms (flag/semaphore only), static allocation preferred, volatile on ISR-shared vars, I2C ACK-check + 3-retry, SPI Mode 0 CS-manual, watchdog fed every 500ms, SSID/password from config.
For the full hardware register table, init sequences, runtime safety rules, auto-reconnect policy, and the compile-time + runtime checklists — invoke the `embedded-c` skill.
