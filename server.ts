import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { ensureWindowsZipPackage } from './server/windowsPackager';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RemotePlayer {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouching: boolean;
  swinging: boolean;
  heldItemId: string | null;
}

interface PlayerEntry {
  ws?: WebSocket;
  httpQueue: unknown[];
  lastSeen: number;
  state: RemotePlayer;
}

interface RoomState {
  code: string;
  hostId: string;
  worldName: string;
  seed: number;
  mode: 'survival' | 'creative';
  timeOfDay: number;
  dayCount: number;
  blockEdits: Map<string, number>;
  players: Map<string, PlayerEntry>;
}

const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#ec4899', '#10b981', '#f97316'];

const rooms = new Map<string, RoomState>();

function generateRoomCode(): string {
  for (let i = 0; i < 50; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendToEntry(entry: PlayerEntry, payload: unknown) {
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify(payload));
  } else {
    entry.httpQueue.push(payload);
    if (entry.httpQueue.length > 250) {
      entry.httpQueue.shift();
    }
  }
}

function broadcastRoom(room: RoomState, payload: unknown, excludeId?: string) {
  for (const [pid, client] of room.players.entries()) {
    if (pid === excludeId) continue;
    sendToEntry(client, payload);
  }
}

function createRoomFromPayload(msg: Record<string, unknown>, ws?: WebSocket) {
  const code = generateRoomCode();
  const playerId = `p_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const playerName = String(msg.playerName || 'Host').slice(0, 20);
  const worldName = String(msg.worldName || 'Online World').slice(0, 32);
  const seed = Number(msg.seed) || 424242;
  const mode: 'survival' | 'creative' = msg.mode === 'creative' ? 'creative' : 'survival';
  const timeOfDay = Number(msg.timeOfDay) || 150;
  const dayCount = Number(msg.dayCount) || 1;

  const blockEdits = new Map<string, number>();
  if (Array.isArray(msg.initialEdits)) {
    for (const entry of msg.initialEdits as [string, number][]) {
      if (Array.isArray(entry) && entry.length === 2) {
        blockEdits.set(String(entry[0]), Number(entry[1]));
      }
    }
  }

  const pState: RemotePlayer = {
    id: playerId,
    name: playerName,
    color: PLAYER_COLORS[0],
    x: Number(msg.x) || 0.5,
    y: Number(msg.y) || 80,
    z: Number(msg.z) || 0.5,
    yaw: 0,
    pitch: 0,
    crouching: false,
    swinging: false,
    heldItemId: null,
  };

  const room: RoomState = {
    code,
    hostId: playerId,
    worldName,
    seed,
    mode,
    timeOfDay,
    dayCount,
    blockEdits,
    players: new Map([[playerId, { ws, httpQueue: [], lastSeen: Date.now(), state: pState }]]),
  };
  rooms.set(code, room);

  const joinedPayload = {
    type: 'room_joined',
    code,
    playerId,
    isHost: true,
    worldName: room.worldName,
    seed: room.seed,
    mode: room.mode,
    timeOfDay: room.timeOfDay,
    dayCount: room.dayCount,
    blockEdits: Array.from(room.blockEdits.entries()),
    players: [pState],
  };

  return { room, playerId, joinedPayload };
}

function joinRoomFromPayload(msg: Record<string, unknown>, ws?: WebSocket) {
  const code = String(msg.code || '').trim();
  const room = rooms.get(code);
  if (!room) {
    return { error: `No active game found for code "${code}".` };
  }

  const playerId = `p_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const playerName = String(msg.playerName || 'Player').slice(0, 20);
  const color = PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];

  const pState: RemotePlayer = {
    id: playerId,
    name: playerName,
    color,
    x: 0.5,
    y: -1,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    crouching: false,
    swinging: false,
    heldItemId: null,
  };

  room.players.set(playerId, { ws, httpQueue: [], lastSeen: Date.now(), state: pState });
  const existingPlayers = Array.from(room.players.values()).map((c) => c.state);

  const joinedPayload = {
    type: 'room_joined',
    code: room.code,
    playerId,
    isHost: false,
    worldName: room.worldName,
    seed: room.seed,
    mode: room.mode,
    timeOfDay: room.timeOfDay,
    dayCount: room.dayCount,
    blockEdits: Array.from(room.blockEdits.entries()),
    players: existingPlayers,
  };

  broadcastRoom(room, { type: 'player_joined', player: pState }, playerId);
  return { room, playerId, joinedPayload };
}

function handleRoomAction(room: RoomState, playerId: string, msg: Record<string, unknown>) {
  const entry = room.players.get(playerId);
  if (!entry) return;
  entry.lastSeen = Date.now();
  const type = msg.type as string;

  if (type === 'player_move') {
    entry.state.x = Number(msg.x) || 0;
    entry.state.y = Number(msg.y) || 0;
    entry.state.z = Number(msg.z) || 0;
    entry.state.yaw = Number(msg.yaw) || 0;
    entry.state.pitch = Number(msg.pitch) || 0;
    entry.state.crouching = Boolean(msg.crouching);
    entry.state.swinging = Boolean(msg.swinging);
    entry.state.heldItemId = typeof msg.heldItemId === 'string' ? msg.heldItemId : null;

    broadcastRoom(room, { type: 'player_moved', player: entry.state }, playerId);
  } else if (type === 'block_set') {
    const x = Math.floor(Number(msg.x));
    const y = Math.floor(Number(msg.y));
    const z = Math.floor(Number(msg.z));
    const blockId = Number(msg.blockId);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    const key = `${x},${y},${z}`;
    room.blockEdits.set(key, blockId);
    broadcastRoom(room, { type: 'block_updated', x, y, z, blockId, by: playerId }, playerId);
  } else if (type === 'chat_msg') {
    const text = String(msg.text || '').trim().slice(0, 140);
    if (!text) return;
    broadcastRoom(room, {
      type: 'chat_broadcast',
      sender: entry.state.name,
      color: entry.state.color,
      text,
    });
  } else if (type === 'world_sync' && playerId === room.hostId) {
    if (msg.mode === 'survival' || msg.mode === 'creative') {
      room.mode = msg.mode;
    }
    if (typeof msg.timeOfDay === 'number') {
      room.timeOfDay = msg.timeOfDay;
    }
    if (typeof msg.dayCount === 'number') {
      room.dayCount = msg.dayCount;
    }
    broadcastRoom(
      room,
      {
        type: 'world_synced',
        mode: room.mode,
        timeOfDay: room.timeOfDay,
        dayCount: room.dayCount,
      },
      playerId,
    );
  } else if (type === 'leave') {
    removePlayerFromRoom(room, playerId);
  }
}

function removePlayerFromRoom(room: RoomState, playerId: string) {
  const leaving = room.players.get(playerId);
  if (!leaving) return;
  room.players.delete(playerId);
  broadcastRoom(room, {
    type: 'player_left',
    playerId,
    name: leaving.state.name,
  });
  if (room.players.size === 0) {
    rooms.delete(room.code);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Clean up timed-out HTTP polling players every 15s
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const [pid, entry] of room.players.entries()) {
        if (!entry.ws && now - entry.lastSeen > 25000) {
          removePlayerFromRoom(room, pid);
        }
      }
    }
  }, 15000);

  // HTTP fallback multiplayer API (works cleanly even when proxies/iframes block WS upgrades)
  app.post('/api/mp/host', (req, res) => {
    const { joinedPayload } = createRoomFromPayload((req.body || {}) as Record<string, unknown>);
    res.json({ ok: true, ...joinedPayload });
  });

  app.post('/api/mp/join', (req, res) => {
    const result = joinRoomFromPayload((req.body || {}) as Record<string, unknown>);
    if ('error' in result) {
      res.status(404).json({ ok: false, message: result.error });
      return;
    }
    res.json({ ok: true, ...result.joinedPayload });
  });

  app.get('/api/mp/poll', (req, res) => {
    const code = String(req.query.code || '').trim();
    const playerId = String(req.query.playerId || '').trim();
    const room = rooms.get(code);
    const entry = room?.players.get(playerId);
    if (!room || !entry) {
      res.status(404).json({ ok: false, message: 'Room disconnected.' });
      return;
    }
    entry.lastSeen = Date.now();
    const events = entry.httpQueue.splice(0, entry.httpQueue.length);
    res.json({ ok: true, events });
  });

  app.post('/api/mp/action', (req, res) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const code = String(body.code || '').trim();
    const playerId = String(body.playerId || '').trim();
    const room = rooms.get(code);
    if (!room || !room.players.has(playerId)) {
      res.status(404).json({ ok: false, message: 'Room not found.' });
      return;
    }
    handleRoomAction(room, playerId, body);
    res.json({ ok: true });
  });

  app.post('/api/prepare-windows-zip', async (_req, res) => {
    try {
      const { sizeBytes } = await ensureWindowsZipPackage(__dirname);
      res.json({ ok: true, sizeBytes, filename: 'TerraVoxel-Windows-x64.zip' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to build Windows package';
      res.status(500).json({ ok: false, message });
    }
  });

  app.get('/api/windows-zip-chunk', async (req, res) => {
    try {
      const { zipPath, sizeBytes } = await ensureWindowsZipPackage(__dirname);
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      const maxChunk = 8 * 1024 * 1024;
      const requested = Math.max(1, Math.min(maxChunk, Math.floor(Number(req.query.length) || maxChunk)));
      if (offset >= sizeBytes) {
        res.status(416).json({ ok: false, message: 'Offset out of range' });
        return;
      }
      const end = Math.min(sizeBytes - 1, offset + requested - 1);
      const chunkLen = end - offset + 1;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(chunkLen));
      res.setHeader('Cache-Control', 'no-store');
      const stream = fs.createReadStream(zipPath, { start: offset, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read Windows package chunk';
      res.status(500).json({ ok: false, message });
    }
  });

  app.get('/api/download-windows-zip', async (_req, res) => {
    try {
      const { zipPath } = await ensureWindowsZipPackage(__dirname);
      res.download(zipPath, 'TerraVoxel-Windows-x64.zip');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to package Windows build';
      res.status(500).json({ ok: false, message });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    let currentRoom: RoomState | null = null;
    let currentPlayerId: string | null = null;

    ws.on('message', (data) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }

      const type = msg.type as string;

      if (type === 'host_room') {
        const { room, playerId, joinedPayload } = createRoomFromPayload(msg, ws);
        currentRoom = room;
        currentPlayerId = playerId;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(joinedPayload));
        }
        return;
      }

      if (type === 'join_room') {
        const result = joinRoomFromPayload(msg, ws);
        if ('error' in result) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'room_error', message: result.error }));
          }
          return;
        }
        currentRoom = result.room;
        currentPlayerId = result.playerId;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(result.joinedPayload));
        }
        return;
      }

      if (!currentRoom || !currentPlayerId) return;
      handleRoomAction(currentRoom, currentPlayerId, msg);
    });

    ws.on('close', () => {
      if (currentRoom && currentPlayerId) {
        removePlayerFromRoom(currentRoom, currentPlayerId);
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`TerraVoxel server running on http://0.0.0.0:${port}`);
  });
}

startServer();
