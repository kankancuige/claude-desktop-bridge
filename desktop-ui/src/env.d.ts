/**
 * 全局类型声明: electronAPI、Window 扩展、构建时常量
 */
export {}

declare global {
  interface ElectronAPI {
    platform: string
    minimize: () => void
    maximize: () => void
    close: () => void
    restartGateway: () => void
    getGatewayLogPath: () => Promise<string>
    selectDirectory: () => Promise<string | null>
    openExternal: (url: string) => Promise<boolean>
    showWindow: () => void
    quitApp: () => void
    onTrayNotification: (callback: (data: any) => void) => void
    isMaximized: () => Promise<boolean>
    getAppVersion: () => Promise<string>
    getBridgeToken: () => Promise<string | null>
    checkForUpdates: () => Promise<any>
    downloadUpdate: () => void
    installUpdate: () => void
    onUpdateAvailable: (cb: (info: any) => void) => () => void
    onUpdateDownloadProgress: (cb: (progress: any) => void) => () => void
    onUpdateDownloaded: (cb: (info: any) => void) => () => void
    onUpdateError: (cb: (err: any) => void) => () => void
  }

  interface Window {
    electronAPI?: ElectronAPI
    __petApi?: {
      setState: (state: string, extra?: Record<string, any>) => void
    }
    __petInfo?: {
      character: string
      scale: number
      message: string
    }
  }

  // Vite 构建时常量注入
  const __REPO_URL__: string
  const __COPYRIGHT__: string
  const __BUILD_TIME__: string
}
