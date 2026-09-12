import { app, shell, BrowserWindow, ipcMain } from "electron";
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
//
// On macOS this does NOT change the Dock label or the menu-bar name during `npm run dev`:
// there the app is hosted inside node_modules' stock Electron.app, and macOS reads those
// two from that bundle, which is why the Dock says "Electron". A packaged build
// (`npm run build:mac`) is its own bundle named from electron-builder's `productName`,
// and shows "BranchWise" everywhere.
app.setName("BranchWise");

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    icon: platformIcon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
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
