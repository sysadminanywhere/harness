const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

let serverProcess;
let mainWindow;
let workspacePath;
let logPath;

function log(message) {
  if (!logPath) return;
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function copySeedData(workspace) {
  const source = path.join(__dirname, '..', 'data', 'board.json');
  const targetDir = path.join(workspace, 'data');
  const target = path.join(targetDir, 'board.json');
  fs.mkdirSync(targetDir, { recursive: true });
  if (!fs.existsSync(target)) fs.copyFileSync(source, target);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const response = await fetch(`${url}/api/projects`);
        if (response.ok) return resolve();
      } catch { /* server is still starting */ }
      if (Date.now() >= deadline) return reject(new Error('Harness server did not start in time'));
      setTimeout(check, 150);
    };
    check();
  });
}

async function startServer() {
  workspacePath = path.join(app.getPath('userData'), 'workspace');
  logPath = path.join(app.getPath('userData'), 'harness.log');
  log(`Starting Harness Lab ${app.getVersion()} packaged=${app.isPackaged}`);
  copySeedData(workspacePath);
  const port = await findFreePort();
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'server.js')
    : path.join(__dirname, '..', 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HARNESS_APP_ROOT: app.isPackaged ? path.join(process.resourcesPath, 'app.asar') : path.dirname(serverPath),
      HARNESS_PORT: String(port),
      HARNESS_WORKSPACE: workspacePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.on('data', (data) => log(`server: ${data.toString().trim()}`));
  serverProcess.stderr.on('data', (data) => log(`server-error: ${data.toString().trim()}`));
  serverProcess.once('exit', (code) => {
    log(`Server exited with code ${code}`);
    if (!app.isQuitting && code !== 0) app.quit();
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url);
  log(`Server ready at ${url}`);
  return url;
}

function showAbout() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About Harness Lab',
    message: 'Harness Lab',
    detail: `Local-first project control\nVersion ${app.getVersion()}\n\nNo AI API or cloud service is required.`,
  });
}

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: 'About Harness Lab', click: showAbout },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  template.push({
    label: 'Workspace',
    submenu: [
      { label: 'Open data folder', click: () => shell.openPath(workspacePath) },
      { label: 'Reload workspace', role: 'reload' },
      { type: 'separator' },
      ...(isMac ? [] : [{ role: 'quit' }]),
    ],
  });

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });

  template.push({
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
    ],
  });

  template.push({
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'close' },
    ],
  });

  template.push({
    label: 'Help',
    submenu: [{ label: 'About Harness Lab', click: showAbout }],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  const url = await startServer();
  createApplicationMenu();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d1110',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadURL(url);
}

app.whenReady().then(createWindow).catch((error) => {
  console.error(error);
  log(`Startup error: ${error.stack || error.message}`);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
});
