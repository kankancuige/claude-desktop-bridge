---
paths: "**/*.axaml;**/*.axaml.cs"
---

# Avalonia UI Rules
Target: .NET 8+ / Avalonia 11+. MVVM: CommunityToolkit.Mvvm or ReactiveUI.

## MVVM
- `.axaml.cs` code-behind: `InitializeComponent()` ONLY. No business logic.
- ViewModel properties: use `[ObservableProperty]` (CommunityToolkit) or `[Reactive]` (ReactiveUI).
- Commands: `[RelayCommand]` or `ReactiveCommand`. Bind via `{Binding CmdName}`.
- ViewModel never holds a reference to the View or any Control.

## Thread Safety
- UI updates from background thread: `Dispatcher.UIThread.InvokeAsync(() => { ... })`.
- Never mutate a bindable ViewModel property from `Task.Run` without Dispatcher marshaling.

## Styling
- No inline Width/Height/Margin in XAML. Extract to `Styles.axaml` or resource dictionaries.
- Control variants via `Classes` attribute: `<Button Classes="primary" />`.
- Platform-specific adjustments: `<OnPlatform>` in XAML, not `#if` in C#.

## DI
- ViewModels registered in `App.axaml.cs` IoC. Constructor injection only.
- Config: `appsettings.json` + `IOptions<T>`. Never hard-code IP/port/passwords.

## Interop with WinForms (.NET 4.8)
- Shared types in `src/Shared` (.NET Standard 2.0).
- Communication via HTTP/MQTT/EventBus. No direct project reference.
