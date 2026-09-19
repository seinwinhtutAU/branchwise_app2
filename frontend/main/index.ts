import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItem,
  type MenuItemConstructorOptions,
} from "electron";
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
      sandbox: true,
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

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
