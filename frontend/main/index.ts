import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
// The BranchWise app icon (see brand/). Windows and Linux take it from the window
// itself; a packaged mac app uses the .icns electron-builder generates from
// build/icon-macos.png, and the Dock override below applies only to `npm run dev`,
// which would otherwise show the generic Electron icon.
import appIcon from "../../resources/icon.png?asset";
import appIconMac from "../../resources/icon-macos.png?asset";

// macOS draws icons inset on a fixed grid, so the Dock gets the padded artwork and
// everything else the full-bleed version.
const platformIcon = process.platform === "darwin" ? appIconMac : appIcon;

// The name Electron reports for itself — used for the userData folder, notifications and
// the window/menu titles. It must be set before the app is ready.
app.setName("BranchWise");

let mainWindow: BrowserWindow | null = null;

function setupAppMenu(window: BrowserWindow): void {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates...",
                click: (): void => {
                  checkForUpdates(true);
                },
              },
              { type: "separator" },
              {
                label: "Preferences...",
                accelerator: "CmdOrCtrl+,",
                click: (): void => {
                  window.webContents.send("menu:open-settings");
                },
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ] as MenuItemConstructorOptions[],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        ...(!isMac
          ? [
              {
                label: "Preferences...",
                accelerator: "CmdOrCtrl+,",
                click: (): void => {
                  window.webContents.send("menu:open-settings");
                },
              },
              { type: "separator" },
            ]
          : []),
        isMac ? { role: "close" } : { role: "quit" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Sidebar",
          accelerator: "CmdOrCtrl+B",
          click: (): void => {
            window.webContents.send("menu:toggle-sidebar");
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? [{ type: "separator" }, { role: "front" }]
          : [{ role: "close" }]),
      ] as MenuItemConstructorOptions[],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Check for Updates...",
          click: (): void => {
            checkForUpdates(true);
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  const isWin = process.platform === "win32";

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    // Keep macOS's native title bar visible. With `hiddenInset`, the traffic-light
    // controls are drawn over the renderer, which can cover the app when the
    // preload bridge or a fixed sidebar is not ready yet. The native title bar
    // also gives the window a reliable drag area.
    titleBarStyle: isWin ? "hidden" : "default",
    titleBarOverlay: isWin
      ? {
          color: "#ffffff",
          symbolColor: "#111827",
          height: 36,
        }
      : false,
    icon: platformIcon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  setupAppMenu(mainWindow);

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(details.url);
      }
    } catch {
      // Ignore malformed URLs
    }
    return { action: "deny" };
  });

  // Native context menu for cut/copy/paste
  mainWindow.webContents.on("context-menu", (_, props) => {
    const contextMenu = new Menu();

    if (props.isEditable) {
      contextMenu.append(new MenuItem({ role: "undo" }));
      contextMenu.append(new MenuItem({ role: "redo" }));
      contextMenu.append(new MenuItem({ type: "separator" }));
      contextMenu.append(new MenuItem({ role: "cut" }));
      contextMenu.append(new MenuItem({ role: "copy" }));
      contextMenu.append(new MenuItem({ role: "paste" }));
      contextMenu.append(new MenuItem({ type: "separator" }));
      contextMenu.append(new MenuItem({ role: "selectAll" }));
      contextMenu.popup();
    } else if (props.selectionText && props.selectionText.trim().length > 0) {
      contextMenu.append(new MenuItem({ role: "copy" }));
      contextMenu.append(new MenuItem({ type: "separator" }));
      contextMenu.append(new MenuItem({ role: "selectAll" }));
      contextMenu.popup();
    }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.branchwise.app");

  // In development the app runs under the stock Electron binary, so the Dock shows
  // Electron's own icon unless we replace it by hand. A packaged mac build already
  // carries the right icon and doesn't need this.
  if (process.platform === "darwin" && is.dev) {
    app.dock?.setIcon(appIconMac);
  }

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  ipcMain.on("ping", () => console.log("pong"));

  ipcMain.on(
    "window:update-title-bar-overlay",
    (_, options: { color: string; symbolColor: string }) => {
      if (
        process.platform === "win32" &&
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.setTitleBarOverlay
      ) {
        mainWindow.setTitleBarOverlay(options);
      }
    },
  );

  createWindow();

  setupAutoUpdater();

  // Check for updates automatically in production after launch
  if (!is.dev) {
    setTimeout(() => {
      checkForUpdates(false);
    }, 4000);
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let manualCheckInProgress = false;

function setupAutoUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("[AutoUpdater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log("[AutoUpdater] Update available:", info.version);
    mainWindow?.webContents.send("update:available", info);
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("[AutoUpdater] Application is up to date:", info.version);
    if (manualCheckInProgress && mainWindow && !mainWindow.isDestroyed()) {
      manualCheckInProgress = false;
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "No Updates Available",
        message: "You are running the latest version of BranchWise.",
        detail: `Version ${app.getVersion()} is currently the newest version available.`,
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    mainWindow?.webContents.send("update:download-progress", progress);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[AutoUpdater] Update downloaded:", info.version);
    mainWindow?.webContents.send("update:downloaded", info);

    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: "info",
          title: "Update Ready",
          message: `BranchWise version ${info.version} has been downloaded.`,
          detail: "Restart the application now to apply the update.",
          buttons: ["Restart and Update", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) {
            autoUpdater.quitAndInstall();
          }
        });
    }
  });

  autoUpdater.on("error", (err) => {
    console.error("[AutoUpdater] Error during update check:", err);
    if (manualCheckInProgress && mainWindow && !mainWindow.isDestroyed()) {
      manualCheckInProgress = false;
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update Check Failed",
        message: "Could not check for updates.",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function checkForUpdates(isManual = false): void {
  if (is.dev) {
    if (isManual && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Development Mode",
        message: "Automatic updates are disabled in development mode.",
        detail: `Current version: ${app.getVersion()}`,
      });
    }
    return;
  }

  manualCheckInProgress = isManual;
  autoUpdater.checkForUpdates().catch((err) => {
    console.error("[AutoUpdater] checkForUpdates error:", err);
    manualCheckInProgress = false;
  });
}

// IPC Handlers for Version & Updates
ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("app:check-for-updates", async () => {
  if (is.dev) {
    return { status: "dev", version: app.getVersion() };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      status: "ok",
      currentVersion: app.getVersion(),
      updateVersion: result?.updateInfo?.version,
    };
  } catch (err: unknown) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
});

ipcMain.on("app:restart-and-install", () => {
  autoUpdater.quitAndInstall();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
