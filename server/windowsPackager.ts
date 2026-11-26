import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const CACHE_DIR = '/tmp/terravoxel-cache';
const ELECTRON_URL = 'https://github.com/electron/electron/releases/download/v33.3.1/electron-v33.3.1-win32-x64.zip';
const ELECTRON_ZIP = path.join(CACHE_DIR, 'electron-v33.3.1-win32-x64.zip');
const OUTPUT_ZIP = path.join(CACHE_DIR, 'TerraVoxel-Windows-x64.zip');
const STAGING_DIR = path.join(CACHE_DIR, 'app_staging');
const PACKAGER_VERSION = 'v1';

const ELECTRON_MAIN_CJS = `const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const DIST_DIR = path.join(__dirname, 'dist');
const PREFERRED_PORT = 39845;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

let httpServer = null;
let mainWindow = null;

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

      // Do not serve SPA HTML for API routes so PeerJS multiplayer activates cleanly
      if (urlPath.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'Offline desktop mode uses P2P' }));
        return;
      }

      let relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\\/+/, '');
      let filePath = path.resolve(DIST_DIR, relPath);

      if (!filePath.startsWith(DIST_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(500);
          res.end('Failed to read application file');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      });
    });

    server.on('upgrade', (_req, socket) => {
      socket.destroy();
    });

    const onReady = () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        httpServer = server;
        resolve(addr.port);
      } else {
        reject(new Error('Could not determine server port'));
      }
    };

    server.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1', onReady);
      } else {
        reject(err);
      }
    });

    server.listen(PREFERRED_PORT, '127.0.0.1', onReady);
  });
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 960,
    minHeight: 600,
    title: 'TerraVoxel',
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadURL('http://127.0.0.1:' + port + '/');

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      event.preventDefault();
      if (mainWindow) {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const port = await startStaticServer();
  createWindow(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(port);
    }
  });
});

app.on('window-all-closed', () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
`;

const ELECTRON_PACKAGE_JSON = JSON.stringify(
  {
    name: 'terravoxel',
    productName: 'TerraVoxel',
    version: '1.0.0',
    description: 'TerraVoxel 3D Voxel Sandbox Survival Game',
    main: 'main.cjs',
  },
  null,
  2,
);

const WINDOWS_README = `TerraVoxel - Windows x64 Edition
================================

How to Play:
1. Extract ALL files from this .zip archive into a folder (do not drag TerraVoxel.exe out by itself, as it needs the accompanying .dll and resources files).
2. Double-click TerraVoxel.exe to launch the game.
3. Press F11 anytime to toggle fullscreen.

Multiplayer:
- Online hosting and joining via 6-digit codes works automatically over peer-to-peer WebRTC when connected to the internet.
`;

function getLatestMtimeMs(targetPath: string): number {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.statSync(targetPath);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let max = stat.mtimeMs;
  for (const entry of fs.readdirSync(targetPath)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const m = getLatestMtimeMs(path.join(targetPath, entry));
    if (m > max) max = m;
  }
  return max;
}

async function ensureFreshDist(projectRoot: string): Promise<string> {
  const distDir = path.join(projectRoot, 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const srcLatest = Math.max(
    getLatestMtimeMs(path.join(projectRoot, 'src')),
    getLatestMtimeMs(path.join(projectRoot, 'index.html')),
  );
  const distMtime = fs.existsSync(distIndex) ? fs.statSync(distIndex).mtimeMs : 0;

  if (!fs.existsSync(distIndex) || srcLatest > distMtime) {
    await execFileAsync('npx', ['vite', 'build'], {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
  return distDir;
}

async function ensureElectronRuntimeZip(): Promise<void> {
  if (fs.existsSync(ELECTRON_ZIP) && fs.statSync(ELECTRON_ZIP).size > 50_000_000) {
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const tmpPart = `${ELECTRON_ZIP}.part`;
  const res = await fetch(ELECTRON_URL, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download Windows runtime (${res.status})`);
  }
  const readable = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream);
  await pipeline(readable, fs.createWriteStream(tmpPart));
  fs.renameSync(tmpPart, ELECTRON_ZIP);
}

let activeBuild: Promise<{ zipPath: string; sizeBytes: number }> | null = null;

export function ensureWindowsZipPackage(projectRoot: string): Promise<{ zipPath: string; sizeBytes: number }> {
  if (activeBuild) return activeBuild;

  activeBuild = (async () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.mkdirSync(STAGING_DIR, { recursive: true });

    const [distDir] = await Promise.all([ensureFreshDist(projectRoot), ensureElectronRuntimeZip()]);

    const markerPath = path.join(STAGING_DIR, '.version');
    const prevMarker = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : '';
    const distIndexMtime = fs.statSync(path.join(distDir, 'index.html')).mtimeMs;
    const outputExists = fs.existsSync(OUTPUT_ZIP) && fs.statSync(OUTPUT_ZIP).size > 50_000_000;
    const outputMtime = outputExists ? fs.statSync(OUTPUT_ZIP).mtimeMs : 0;

    if (outputExists && prevMarker === PACKAGER_VERSION && outputMtime >= distIndexMtime) {
      return { zipPath: OUTPUT_ZIP, sizeBytes: fs.statSync(OUTPUT_ZIP).size };
    }

    fs.writeFileSync(path.join(STAGING_DIR, 'main.cjs'), ELECTRON_MAIN_CJS, 'utf8');
    fs.writeFileSync(path.join(STAGING_DIR, 'package.json'), ELECTRON_PACKAGE_JSON, 'utf8');
    fs.writeFileSync(path.join(STAGING_DIR, 'README.txt'), WINDOWS_README, 'utf8');

    const tmpOut = `${OUTPUT_ZIP}.tmp`;
    const pyScript = `
import os, sys, zipfile

electron_zip, dist_dir, staging_dir, out_zip = sys.argv[1:5]

with zipfile.ZipFile(electron_zip, 'r') as zin, zipfile.ZipFile(out_zip, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as zout:
    for item in zin.infolist():
        if item.filename == 'resources/default_app.asar':
            continue
        if item.is_dir():
            continue
        target_name = 'TerraVoxel/' + ('TerraVoxel.exe' if item.filename == 'electron.exe' else item.filename)
        info = zipfile.ZipInfo(target_name, date_time=item.date_time)
        info.external_attr = item.external_attr
        info.compress_type = zipfile.ZIP_DEFLATED
        zout.writestr(info, zin.read(item.filename))

    for fname in ('package.json', 'main.cjs'):
        fpath = os.path.join(staging_dir, fname)
        zout.write(fpath, 'TerraVoxel/resources/app/' + fname)

    zout.write(os.path.join(staging_dir, 'README.txt'), 'TerraVoxel/README.txt')

    for root, _, files in os.walk(dist_dir):
        for fname in files:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, dist_dir).replace(os.sep, '/')
            zout.write(full, 'TerraVoxel/resources/app/dist/' + rel)
`;

    await execFileAsync('python3', ['-c', pyScript, ELECTRON_ZIP, distDir, STAGING_DIR, tmpOut], {
      maxBuffer: 10 * 1024 * 1024,
    });

    fs.renameSync(tmpOut, OUTPUT_ZIP);
    fs.writeFileSync(markerPath, PACKAGER_VERSION, 'utf8');
    return { zipPath: OUTPUT_ZIP, sizeBytes: fs.statSync(OUTPUT_ZIP).size };
  })().finally(() => {
    activeBuild = null;
  });

  return activeBuild;
}
