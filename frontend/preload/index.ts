import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

const api = {
  platform: process.platform,
  isMac,
  isWindows,
  updateTitleBarOverlay: (options: { color: string; symbolColor: string }): void => {
    ipcRenderer.send("window:update-title-bar-overlay", options);
  },
  onMenuAction: (callback: (action: "open-settings" | "toggle-sidebar") => void): (() => void) => {
    const handleSettings = (): void => callback("open-settings");
    const handleSidebar = (): void => callback("toggle-sidebar");

    ipcRenderer.on("menu:open-settings", handleSettings);
    ipcRenderer.on("menu:toggle-sidebar", handleSidebar);

    return () => {
      ipcRenderer.removeListener("menu:open-settings", handleSettings);
      ipcRenderer.removeListener("menu:toggle-sidebar", handleSidebar);
    };
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.api = api;
}

