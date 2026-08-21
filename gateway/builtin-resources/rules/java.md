---
paths: "**/*.java"
---

# Java Core Rules (Netty + Spring Boot, all modules)
Applies to ALL Java files. This rule holds ONLY the universal safety constraints. Full architectural rules live in skills:
- Netty device communication (thread model, frame routing, channel lifecycle) → `device-driver` skill
- Spring Boot REST API (Controller/Service/Mapper, response body, pagination, permission) → `spring-boot-api` skill
- Protocol parsing (byte tables, half-packet, checksum) → `protocol-parser` skill

## Non-negotiables
- `ByteToMessageDecoder.decode()` must check `in.readableBytes() >= expectedFrameLength` first. Return immediately if insufficient; never read half-packets or overrun.
- `ByteBuf` must be released via `ReferenceCountUtil.release(msg)` in `channelRead`, `exceptionCaught`, or `channelInactive`. Never leak memory.
- Protocol parsing must operate on `byte[]` or `ByteBuf` native APIs — never concatenate hex strings for parsing logic.
- Each device type must have independent `Decoder` + `Encoder` + `ChannelHandler`. Route by frame-header signature via a factory/router table. Never hard-code `if(type.equals("xxx"))` model checks in the business layer.
- Auto-reconnect on disconnect with exponential backoff (1s → 2s → 4s → 8s → max 60s). Must include max retry limit to prevent avalanche.
- DB connection pool, MQTT/Redis passwords, device IP/port must go in `application.yml`. Never hard-code.

## Style
- camelCase methods/variables, SCREAMING_SNAKE_CASE constants, PascalCase classes.
- Entity classes: all `private` fields + getters/setters. Never `public` fields.
- Logging: SLF4J + Logback. Never `System.out.println` in production. Rolling policy: both time (daily) AND size (max 10MB per file), keep 7 days, auto-delete older — prevents disk-full on 7×24 machines (`SizeAndTimeBasedRollingPolicy` in logback-spring.xml).
- Annotate protocol version and date in comments: `// v1.0 2026-05-30: added new device header`.

## Principles
- Industrial communication: reliability > performance. Prefer retransmission + ACK over packet loss or half-packet parsing.
- All exceptions must reach `exceptionCaught`. Never swallow stacks.
- New device integration must not break existing parsers. Backward compatibility is mandatory.
