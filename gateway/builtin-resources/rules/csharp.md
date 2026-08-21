---
paths: "**/*.cs"
---

# C# Core Rules (shared: WinForms + Avalonia)
Applies to ALL C# files. This rule holds ONLY the conflict-free shared core. Framework-specific UI rules live elsewhere:
- WinForms (.NET 4.8, AntdUI, app.config) → `ui-winforms` skill
- Avalonia (.NET 8+, MVVM, appsettings.json) → `avalonia.md` rule + `avalonia-ui` skill

## Threading & UI
- Hardware IO (serial `SerialPort.Read`, TCP `Socket.Receive`, USB) must NEVER run synchronously on the main/UI thread. Offload to `Task.Run` / `BackgroundWorker`.
- Never touch a UI control from a background thread without marshaling to the UI thread (WinForms: `Control.Invoke`; Avalonia: `Dispatcher.UIThread`). The exact API is framework-specific — see the relevant skill/rule.
- Main/UI-thread blocking > 500ms must be made async.
- Each device instance runs on an independent thread/task. Never serialize-wait for other devices inside a callback.

## Data Access
- Never hand-concatenate SQL strings. Use parameterized APIs or ORM expression trees (e.g. `db.Queryable<T>().Where(...)`).
- DB connection strings come from config (WinForms `app.config`, Avalonia `appsettings.json`), never hard-coded.

## Logging
- Use Serilog (`Log.Information/Warning/Error`). Never `Console.WriteLine` or a message box for debug output. Every log carries context properties (`deviceId`, `stepNo`).

## IO Robustness
- Serial ports set `ReadTimeout`; TCP sets `ReceiveTimeout`. Never block infinitely.
- Every `Connect` / `Open` has a timeout. Every third-party device command has a response timeout.

## Style
- PascalCase public members, _camelCase private fields, camelCase local variables.
- Hex output: `BitConverter.ToString(bytes).Replace("-", " ")`. Never hand-write `for` loops to concatenate hex.
- Annotate protocol version + date in comments: `// v1.0 2026-05-30: added scanner prefix field`.

## Exceptions
- Never swallow exceptions. No empty `catch (Exception) { }` — if intentionally ignored, a comment explaining WHY is mandatory.

## Device Abstraction
- All hardware inherits `BaseDevice` (`Connect / Disconnect / Send / OnDataReceived / OnError`). Subclasses implement `ParseFrame(byte[] raw)` + `BuildCommand(object cmd)`. Never hard-code model checks in the business layer.

## Principles
- Industrial field: 7×24 stability first, performance second.
