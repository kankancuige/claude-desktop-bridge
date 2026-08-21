---
name: device-driver
description: Use when adding a new device driver — torque tool, PLC, sensor, RFID reader, barcode scanner, or any third-party industrial device integration. Triggers on keywords: device driver, new device, integration, PLC, sensor, RFID, barcode, torque tool, wrench, connect, disconnect, reconnect, auto-reconnect, handshake, BaseDevice.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a device driver specialist for an industrial tightening system. Every driver must follow the project's device abstraction pattern and be production-grade.

## Mandatory Design (before any code)

### 1. Device Abstraction
- C#: extend `BaseDevice` abstract class. Never hard-code model checks in the business layer.
- Java: implement the device interface. Each device type gets its own independent implementation.
- Connection parameters (IP, port, COM, passwords) MUST be read from config — never hard-coded.

### 2. Communication Cycle
Every driver MUST implement this full cycle:

```
Connect → Handshake → Read/Write Data → Disconnect
   ↓          ↓            ↓              ↓
 timeout   validate    continuous      release
 +retry    device ID   polling or      all resources
                        event-driven
```

### 3. Auto-Reconnect (mandatory)
- On disconnect: exponential backoff (1s → 2s → 4s → 8s → ... max 60s)
- On max retries exhausted: log Fatal, notify UI, stop retrying
- Reconnect MUST re-run full handshake, not just TCP reconnect

## Implementation Template

### C# (WinForms .NET 4.8)
```csharp
public class XxxDevice : BaseDevice
{
    // SIDE_EFFECT: opens TCP/Serial connection, starts background read loop
    public override async Task ConnectAsync(CancellationToken ct) { }

    // SIDE_EFFECT: triggers OnDataReceived event
    private async Task ReadLoopAsync(CancellationToken ct) { }

    // SIDE_EFFECT: sends raw bytes to device
    public override async Task SendAsync(byte[] data, CancellationToken ct) { }

    public override async Task DisconnectAsync() { }
}
```

### Java (Netty 4.1 + Spring Boot)

**Thread model** — triple isolation (`java.md` enforces ByteBuf/half-packet safety; this section covers architecture):
```
bossGroup(1)   — accepts connections
workerGroup(N) — IO reads, pipes bytes to pipeline
businessExecutor(M) — handshake, parse, dispatch (NEVER on IO thread)
```
IO threads must only do framing. Business work always offloaded to `businessExecutor`.

**Unified frame abstraction** — all device messages become:
```java
DeviceFrame { byte[] raw; String deviceId; long timestamp; DeviceType type; }
```
Parsers operate on `DeviceFrame`, not raw `ByteBuf` scattered across handlers.

**ProtocolRouter** — single entry point, dispatches by frame-header signature (fixed magic bytes, length field, ASCII identifier). New device → add a routing rule + a decoder. Never pile `if(type.equals("xxx"))` chains.

**Channel lifecycle** (in `ChannelInboundHandlerAdapter`):
- `channelActive` → handshake (validate device ID / version / capabilities)
- `channelRead` → decode → dispatch to business layer via Spring EventBus
- `channelInactive` → schedule reconnect (exponential backoff 1s→2s→…→max 60s; re-run full handshake, not just TCP)
- `exceptionCaught` → log + `ReferenceCountUtil.release(msg)` + close ctx

**Per-device isolation** — each device instance holds an independent `Channel`. Never share one `Channel` across devices. `ChannelGroup` for broadcast/management.

**Skeleton** (Decoder + Encoder + Handler):
```java
@Component public class XxxDecoder extends ByteToMessageDecoder { }
@Component public class XxxEncoder extends MessageToByteEncoder<XxxCommand> { }
@Component public class XxxHandler extends ChannelInboundHandlerAdapter { }
```
Full safety rules (ByteBuf release, half-packet, bounds) in `java.md` rule; parsing details in `protocol-parser` skill.

## Defensive Checklist
- [ ] Connection params from config (app.config / application.yml), NOT hard-coded?
- [ ] Timeout on Connect, Read, Write operations?
- [ ] Auto-reconnect with exponential backoff?
- [ ] All exceptions logged with stack trace — no empty catch blocks?
- [ ] IDisposable / channel resources released in finally / channelInactive?
- [ ] New driver does NOT break existing parsers (backward compatibility)?
- [ ] Mock integration test covering full cycle (connect → handshake → read → disconnect)?

## Logging
- Information: connection established, device online, protocol identified, handshake success
- Warning: reconnecting, timeout retry
- Error: connection failed, handshake failed, data corruption
- Every log MUST include `{DeviceId}` and `{ConnectionId}` context
