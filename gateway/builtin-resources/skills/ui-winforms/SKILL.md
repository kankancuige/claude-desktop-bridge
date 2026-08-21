---
name: ui-winforms
description: Use when writing C# WinForms UI code — forms, controls, event handlers, data binding, grid views, dialogs. Triggers on keywords: WinForms, Form, Control, Button, DataGridView, TextBox, ComboBox, Label, Panel, TabControl, event handler, Click, SelectionChanged, AntdUI, UI, interface, form, dialog, popup, refresh, update UI.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

You are a WinForms UI specialist for an industrial HMI system (C# .NET Framework 4.8 + AntdUI). Every UI component must be thread-safe and production-grade.

## Mandatory Rules

### 1. Thread Safety (highest priority)
- Any non-UI thread updating a control MUST use `Control.Invoke` or `Control.BeginInvoke`.
- Before Invoke, ALWAYS guard with `if (!ctrl.IsDisposed && ctrl.IsHandleCreated)`.
- NEVER `await` IO-bound operations inside EventHandlers — use `Task.Run` + `BeginInvoke` to marshal results back.
- Pattern:
  ```csharp
  // SIDE_EFFECT: updates UI from background thread
  private void UpdateLabel(string text) {
      if (label1.IsDisposed || !label1.IsHandleCreated) return;
      if (label1.InvokeRequired)
          label1.BeginInvoke((Action)(() => label1.Text = text));
      else
          label1.Text = text;
  }
  ```

### 2. Event Handler Rules
- Event handlers MUST be lightweight (< 50ms). Heavy work → `Task.Run`.
- Click handlers that open connections: MUST use CancellationTokenSource, cancel on FormClosing.
- Never show MessageBox from background thread — marshal to UI thread first.

### 3. Resource Management
- `Form.OnFormClosing`: cancel all CancellationTokenSources, dispose timers, close connections.
- DataGridView with large datasets: enable VirtualMode for > 1000 rows.
- Timers: use `System.Windows.Forms.Timer` (UI-thread) for UI updates, `System.Threading.Timer` for background work.

### 4. AntdUI Controls
- Use AntdUI controls where available (they are themed and support dark mode).
- `AntdUI.Button`: prefer over standard Button for consistent theme.
- `AntdUI.DataGridView`: supports built-in pagination and filtering.

### 5. Data Binding
- Bind data sources on UI thread only.
- Use `BindingSource` as intermediate — never bind DataGridView directly to raw DataTable from background thread.
- Refresh pattern: fetch data on background thread → marshal to UI thread → update BindingSource.

### 6. WinForms Platform Rules (.NET 4.8 / AntdUI / config / Serilog)
> These are WinForms-specific. The generic C# rules (threading principle, SqlSugar/no-SQL-concat, Serilog context, hex idiom, BaseDevice) auto-inject from `rules/csharp.md`; this section adds the WinForms-only specifics.
- **Lock to .NET Framework 4.8.** Never upgrade to .NET Core (legacy driver/DLL compatibility). (Avalonia modules are .NET 8 — do not mix.)
- **AntdUI controls exclusively** — `AntdUI.Button`, `AntdUI.Table`, `AntdUI.Input`, etc. Never mix native WinForms controls (style fragmentation). Prompts use `AntdUI.Message.success/error/warning`, never native `MessageBox.Show`.
- AntdUI control naming prefixes: `btn_`, `tbl_`, `inp_`, `msg_`, `bdg_` (Button, Table, Input, Message, Badge). Event handlers: `Btn_Start_Click`, `Device_OnDataReceived`, `Timer_Heartbeat_Tick`.
- AntdUI tables: `tbl.SetPagedData(list, total)` or `tbl.Binding(list)`. Never directly manipulate `Rows.Add`.
- **DB connection string in `app.config`** (SqlSugar). Initialize `SqlSugarScope` (singleton) with `InitKeyType.Attribute`; entities use `[SugarColumn]`. Parsed frames flow through a background queue (`BlockingCollection`/`Channel`); never insert to DB inside `DataReceived`.
- **Serilog** init before `Application.Run()`. Configure `WriteTo.File(path, rollingInterval: RollingInterval.Day, fileSizeLimitBytes: 10_485_760, retainedFileCountLimit: 7, rollOnFileSizeLimit: true)` — roll by BOTH time (daily) AND size (10MB), keep 7 files. Prevents disk-full on 7×24 machines. Log path derives from `Application.StartupPath`, never hard-coded.
- Devices auto-reconnect on disconnect. UI status lights via `AntdUI.Badge` (red/green/yellow), synced in real-time on the UI thread.

## Self-Review Checklist
- [ ] All cross-thread control access uses Invoke + IsDisposed/IsHandleCreated guard?
- [ ] No await IO in EventHandlers?
- [ ] CancellationTokenSource cancelled in OnFormClosing?
- [ ] MessageBox calls on UI thread?
- [ ] IDisposable controls/timers disposed?
