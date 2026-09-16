import { ElectronAPI } from "@electron-toolkit/preload";

export interface BranchWiseApi {
  platform: NodeJS.Platform;
  isMac: boolean;
  isWindows: boolean;
  updateTitleBarOverlay: (options: { color: string; symbolColor: string }) => void;
  onMenuAction: (
    callback: (action: "open-settings" | "toggle-sidebar") => void,
  ) => () => void;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
    api?: BranchWiseApi;
  }
}

