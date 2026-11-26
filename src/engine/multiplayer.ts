import Peer, { DataConnection } from 'peerjs';
import { GameMode } from '../types/game';

export interface RemotePlayerState {
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

export interface ChatMessage {
  id: string;
  sender: string;
  color: string;
  text: string;
  timestamp: number;
}

export interface RoomJoinedPayload {
  code: string;
  playerId: string;
  isHost: boolean;
  worldName: string;
  seed: number;
  mode: GameMode;
  timeOfDay: number;
  dayCount: number;
  blockEdits: [string, number][];
  players: RemotePlayerState[];
}

export interface MultiplayerCallbacks {
  onJoined?: (payload: RoomJoinedPayload) => void;
  onError?: (message: string) => void;
  onPlayerJoined?: (player: RemotePlayerState) => void;
  onPlayerMoved?: (player: RemotePlayerState) => void;
  onPlayerLeft?: (playerId: string, name: string) => void;
  onBlockUpdated?: (x: number, y: number, z: number, blockId: number) => void;
  onChat?: (msg: ChatMessage) => void;
  onWorldSynced?: (mode: GameMode, timeOfDay: number, dayCount: number) => void;
  onDisconnected?: () => void;
}

const PEER_PREFIX = 'terravoxel-527864-';
const PLAYER_COLORS = ['#f59e0b', '#38bdf8', '#a855f7', '#ec4899', '#10b981', '#f97316'];

interface HostRoomParams {
  playerName: string;
  worldName: string;
  seed: number;
  mode: GameMode;
  timeOfDay: number;
  dayCount: number;
  x: number;
  y: number;
  z: number;
  initialEdits: [string, number][];
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private transport: 'none' | 'ws' | 'http' | 'p2p' = 'none';
  private pollTimer: number | null = null;
  private httpMoveInFlight = false;
  private disposed = false;

  // PeerJS cross-origin / fallback P2P state
  private peer: Peer | null = null;
  private guestConn: DataConnection | null = null;
  private hostPeerConns = new Map<string, DataConnection>();
  private hostMirror: {
    worldName: string;
    seed: number;
    mode: GameMode;
    timeOfDay: number;
    dayCount: number;
    blockEdits: Map<string, number>;
    players: Map<string, RemotePlayerState>;
  } | null = null;

  private callbacks: MultiplayerCallbacks = {};
  public code: string | null = null;
  public playerId: string | null = null;
  public isHost = false;
  public connected = false;

  setCallbacks(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  private handleServerEvent(msg: Record<string, unknown>, fromServer = true) {
    switch (msg.type) {
      case 'player_joined': {
        const player = msg.player as RemotePlayerState;
        if (this.hostMirror && player) {
          this.hostMirror.players.set(player.id, player);
          if (fromServer) this.broadcastToP2pPeers(msg);
        }
        this.callbacks.onPlayerJoined?.(player);
        break;
      }
      case 'player_moved': {
        const player = msg.player as RemotePlayerState;
        if (this.hostMirror && player) {
          this.hostMirror.players.set(player.id, player);
          if (fromServer) this.broadcastToP2pPeers(msg);
        }
        this.callbacks.onPlayerMoved?.(player);
        break;
      }
      case 'player_left': {
        const pid = String(msg.playerId);
        if (this.hostMirror) {
          this.hostMirror.players.delete(pid);
          if (fromServer) this.broadcastToP2pPeers(msg);
        }
        this.callbacks.onPlayerLeft?.(pid, String(msg.name || 'Player'));
        break;
      }
      case 'block_updated': {
        const x = Number(msg.x);
        const y = Number(msg.y);
        const z = Number(msg.z);
        const blockId = Number(msg.blockId);
        if (this.hostMirror) {
          this.hostMirror.blockEdits.set(`${x},${y},${z}`, blockId);
          if (fromServer) this.broadcastToP2pPeers(msg);
        }
        this.callbacks.onBlockUpdated?.(x, y, z, blockId);
        break;
      }
      case 'chat_broadcast': {
        if (this.hostMirror && fromServer) {
          this.broadcastToP2pPeers(msg);
        }
        this.callbacks.onChat?.({
          id: `${Date.now()}_${Math.random()}`,
          sender: String(msg.sender || 'Player'),
          color: String(msg.color || '#f59e0b'),
          text: String(msg.text || ''),
          timestamp: Date.now(),
        });
        break;
      }
      case 'world_synced':
        this.callbacks.onWorldSynced?.(
          msg.mode === 'creative' ? 'creative' : 'survival',
          Number(msg.timeOfDay),
          Number(msg.dayCount),
        );
        break;
    }
  }

  private tryWebSocketHandshake(
    initialPayload: Record<string, unknown>,
    timeoutMs = 2200,
  ): Promise<{ ok: true; payload: RoomJoinedPayload } | { ok: false; roomMissing?: boolean; message: string }> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (res: { ok: true; payload: RoomJoinedPayload } | { ok: false; roomMissing?: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        finish({ ok: false, message: 'WebSocket unavailable' });
        return;
      }

      const timer = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          // ignore
        }
        finish({ ok: false, message: 'WebSocket timed out' });
      }, timeoutMs);

      ws.onopen = () => {
        ws.send(JSON.stringify(initialPayload));
      };

      ws.onmessage = (ev) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }

        if (!settled) {
          if (msg.type === 'room_joined') {
            this.ws = ws;
            this.transport = 'ws';
            this.connected = true;
            const payload = msg as unknown as RoomJoinedPayload;
            this.code = payload.code;
            this.playerId = payload.playerId;
            this.isHost = payload.isHost;
            finish({ ok: true, payload });
          } else if (msg.type === 'room_error') {
            try {
              ws.close();
            } catch {
              // ignore
            }
            finish({ ok: false, roomMissing: true, message: String(msg.message || 'Room not found') });
          }
          return;
        }

        this.handleServerEvent(msg, true);
      };

      ws.onerror = () => {
        if (!settled) {
          finish({ ok: false, message: 'WebSocket error' });
        }
      };

      ws.onclose = () => {
        if (!settled) {
          finish({ ok: false, message: 'WebSocket closed' });
          return;
        }
        if (this.transport === 'ws' && !this.disposed) {
          this.connected = false;
          this.callbacks.onDisconnected?.();
        }
      };
    });
  }

  private startHttpPolling() {
    this.stopHttpPolling();
    let inFlight = false;
    let consecutiveFailures = 0;

    this.pollTimer = window.setInterval(async () => {
      if (this.disposed || this.transport !== 'http' || !this.code || !this.playerId || inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(
          `/api/mp/poll?code=${encodeURIComponent(this.code)}&playerId=${encodeURIComponent(this.playerId)}`,
          { credentials: 'same-origin' },
        );
        if (res.status === 404) {
          this.connected = false;
          this.stopHttpPolling();
          this.callbacks.onDisconnected?.();
          return;
        }
        if (res.ok) {
          consecutiveFailures = 0;
          const data = (await res.json()) as { events?: Record<string, unknown>[] };
          if (Array.isArray(data.events)) {
            for (const ev of data.events) {
              this.handleServerEvent(ev, true);
            }
          }
        }
      } catch {
        consecutiveFailures++;
        if (consecutiveFailures > 25) {
          this.connected = false;
          this.stopHttpPolling();
          this.callbacks.onDisconnected?.();
        }
      } finally {
        inFlight = false;
      }
    }, 110);
  }

  private stopHttpPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private startPeerHostBridge(code: string) {
    try {
      const peer = new Peer(`${PEER_PREFIX}${code}`, { debug: 0 });
      this.peer = peer;

      peer.on('error', () => {
        // Non-fatal: same-server WS/HTTP hosting still works even if PeerJS signaling is unreachable
      });

      peer.on('connection', (conn) => {
        let guestId: string | null = null;

        conn.on('data', (raw) => {
          const msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
          if (!msg || !this.hostMirror) return;

          if (msg.type === 'join_room') {
            guestId = `p_p2p_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const guestName = String(msg.playerName || 'Player').slice(0, 20);
            const color = PLAYER_COLORS[this.hostMirror.players.size % PLAYER_COLORS.length];
            const guestState: RemotePlayerState = {
              id: guestId,
              name: guestName,
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

            this.hostMirror.players.set(guestId, guestState);
            this.hostPeerConns.set(guestId, conn);

            conn.send({
              type: 'room_joined',
              code,
              playerId: guestId,
              isHost: false,
              worldName: this.hostMirror.worldName,
              seed: this.hostMirror.seed,
              mode: this.hostMirror.mode,
              timeOfDay: this.hostMirror.timeOfDay,
              dayCount: this.hostMirror.dayCount,
              blockEdits: Array.from(this.hostMirror.blockEdits.entries()),
              players: Array.from(this.hostMirror.players.values()),
            });

            this.callbacks.onPlayerJoined?.(guestState);
            this.broadcastToP2pPeers({ type: 'player_joined', player: guestState }, guestId);
            return;
          }

          if (!guestId) return;

          if (msg.type === 'player_move') {
            const p = this.hostMirror.players.get(guestId);
            if (!p) return;
            p.x = Number(msg.x) || 0;
            p.y = Number(msg.y) || 0;
            p.z = Number(msg.z) || 0;
            p.yaw = Number(msg.yaw) || 0;
            p.pitch = Number(msg.pitch) || 0;
            p.crouching = Boolean(msg.crouching);
            p.swinging = Boolean(msg.swinging);
            p.heldItemId = typeof msg.heldItemId === 'string' ? msg.heldItemId : null;
            this.callbacks.onPlayerMoved?.(p);
            this.broadcastToP2pPeers({ type: 'player_moved', player: p }, guestId);
          } else if (msg.type === 'block_set') {
            const x = Math.floor(Number(msg.x));
            const y = Math.floor(Number(msg.y));
            const z = Math.floor(Number(msg.z));
            const blockId = Number(msg.blockId);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
            this.hostMirror.blockEdits.set(`${x},${y},${z}`, blockId);
            this.callbacks.onBlockUpdated?.(x, y, z, blockId);
            this.broadcastToP2pPeers({ type: 'block_updated', x, y, z, blockId }, guestId);
            this.sendToLocalServer({ type: 'block_set', x, y, z, blockId });
          } else if (msg.type === 'chat_msg') {
            const p = this.hostMirror.players.get(guestId);
            const text = String(msg.text || '').trim().slice(0, 140);
            if (!p || !text) return;
            const chatPayload = {
              type: 'chat_broadcast',
              sender: p.name,
              color: p.color,
              text,
            };
            this.handleServerEvent(chatPayload, false);
            this.broadcastToP2pPeers(chatPayload);
            this.sendToLocalServer({ type: 'chat_msg', text: `[${p.name}] ${text}` });
          }
        });

        const cleanupPeer = () => {
          if (!guestId || !this.hostMirror) return;
          const leaving = this.hostMirror.players.get(guestId);
          this.hostPeerConns.delete(guestId);
          this.hostMirror.players.delete(guestId);
          this.callbacks.onPlayerLeft?.(guestId, leaving?.name || 'Player');
          this.broadcastToP2pPeers({
            type: 'player_left',
            playerId: guestId,
            name: leaving?.name || 'Player',
          });
          guestId = null;
        };

        conn.on('close', cleanupPeer);
        conn.on('error', cleanupPeer);
      });
    } catch {
      // Ignore P2P bridge init errors; local server hosting continues
    }
  }

  private broadcastToP2pPeers(payload: unknown, excludeId?: string) {
    for (const [pid, conn] of this.hostPeerConns.entries()) {
      if (pid === excludeId) continue;
      if (conn.open) {
        conn.send(payload);
      }
    }
  }

  async hostRoom(params: HostRoomParams) {
    this.disconnect();
    this.disposed = false;

    const reqPayload: Record<string, unknown> = { type: 'host_room', ...params };

    // 1. Try WebSocket first
    const wsRes = await this.tryWebSocketHandshake(reqPayload);
    if (this.disposed) return;

    let joined: RoomJoinedPayload | null = null;
    if (wsRes.ok) {
      joined = wsRes.payload;
    } else {
      // 2. Fallback to HTTP /api/mp/host
      try {
        const res = await fetch('/api/mp/host', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqPayload),
        });
        if (res.ok) {
          const data = (await res.json()) as RoomJoinedPayload & { ok?: boolean };
          if (data.code) {
            this.transport = 'http';
            this.connected = true;
            this.code = data.code;
            this.playerId = data.playerId;
            this.isHost = true;
            this.startHttpPolling();
            joined = data;
          }
        }
      } catch {
        // Fall through to pure P2P host if server unreachable
      }
    }

    if (!joined) {
      // Pure P2P fallback
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const playerId = `p_host_${Date.now()}`;
      this.transport = 'p2p';
      this.connected = true;
      this.code = code;
      this.playerId = playerId;
      this.isHost = true;
      joined = {
        code,
        playerId,
        isHost: true,
        worldName: params.worldName,
        seed: params.seed,
        mode: params.mode,
        timeOfDay: params.timeOfDay,
        dayCount: params.dayCount,
        blockEdits: params.initialEdits,
        players: [
          {
            id: playerId,
            name: params.playerName,
            color: PLAYER_COLORS[0],
            x: params.x,
            y: params.y,
            z: params.z,
            yaw: 0,
            pitch: 0,
            crouching: false,
            swinging: false,
            heldItemId: null,
          },
        ],
      };
    }

    // Initialize local mirror for cross-origin P2P friends
    const playersMap = new Map<string, RemotePlayerState>();
    for (const p of joined.players) {
      playersMap.set(p.id, { ...p });
    }
    this.hostMirror = {
      worldName: joined.worldName,
      seed: joined.seed,
      mode: joined.mode,
      timeOfDay: joined.timeOfDay,
      dayCount: joined.dayCount,
      blockEdits: new Map(joined.blockEdits),
      players: playersMap,
    };

    this.startPeerHostBridge(joined.code);
    this.callbacks.onJoined?.(joined);
  }

  async joinRoom(code: string, playerName: string) {
    this.disconnect();
    this.disposed = false;
    const cleanCode = code.trim();

    // 1. Try local server WebSocket
    const wsRes = await this.tryWebSocketHandshake({ type: 'join_room', code: cleanCode, playerName });
    if (this.disposed) return;

    if (wsRes.ok) {
      this.callbacks.onJoined?.(wsRes.payload);
      return;
    }

    // 2. If WebSocket failed (not just missing room), try local HTTP /api/mp/join
    if (!wsRes.roomMissing) {
      try {
        const res = await fetch('/api/mp/join', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: cleanCode, playerName }),
        });
        if (res.ok) {
          const data = (await res.json()) as RoomJoinedPayload & { ok?: boolean };
          if (data.code) {
            this.transport = 'http';
            this.connected = true;
            this.code = data.code;
            this.playerId = data.playerId;
            this.isHost = false;
            this.startHttpPolling();
            this.callbacks.onJoined?.(data);
            return;
          }
        }
      } catch {
        // Proceed to PeerJS cross-origin fallback
      }
    }

    // 3. Cross-origin / Cross-container PeerJS WebRTC fallback
    this.joinViaPeerJS(cleanCode, playerName);
  }

  private joinViaPeerJS(code: string, playerName: string) {
    let settled = false;
    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.disconnect();
      this.callbacks.onError?.(msg);
    };

    const timer = window.setTimeout(() => {
      fail(`No active game found for code "${code}". Make sure the host is currently online.`);
    }, 9000);

    try {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;

      peer.on('error', (err) => {
        if (!settled) {
          if (err.type === 'peer-unavailable') {
            fail(`No active game found for code "${code}".`);
          } else {
            fail(`Could not connect to room "${code}".`);
          }
        }
      });

      peer.on('open', () => {
        if (this.disposed || settled) return;
        const conn = peer.connect(`${PEER_PREFIX}${code}`, { reliable: true });
        this.guestConn = conn;

        conn.on('open', () => {
          conn.send({ type: 'join_room', code, playerName });
        });

        conn.on('data', (raw) => {
          const msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
          if (!msg) return;

          if (!settled && msg.type === 'room_joined') {
            settled = true;
            clearTimeout(timer);
            const payload = msg as unknown as RoomJoinedPayload;
            this.transport = 'p2p';
            this.connected = true;
            this.code = payload.code;
            this.playerId = payload.playerId;
            this.isHost = false;
            this.callbacks.onJoined?.(payload);
            return;
          }

          this.handleServerEvent(msg, false);
        });

        conn.on('close', () => {
          if (!settled) {
            fail(`Connection to room "${code}" closed.`);
          } else if (!this.disposed) {
            this.connected = false;
            this.callbacks.onDisconnected?.();
          }
        });

        conn.on('error', () => {
          if (!settled) {
            fail(`Failed to connect to host for code "${code}".`);
          }
        });
      });
    } catch {
      fail('Online multiplayer connection failed.');
    }
  }

  private sendToLocalServer(payload: Record<string, unknown>) {
    if (this.transport === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else if (this.transport === 'http' && this.code && this.playerId) {
      if (payload.type === 'player_move') {
        if (this.httpMoveInFlight) return;
        this.httpMoveInFlight = true;
      }
      fetch('/api/mp/action', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.code, playerId: this.playerId, ...payload }),
      })
        .catch(() => {})
        .finally(() => {
          if (payload.type === 'player_move') {
            this.httpMoveInFlight = false;
          }
        });
    }
  }

  sendMove(state: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    crouching: boolean;
    swinging: boolean;
    heldItemId: string | null;
  }) {
    if (!this.connected) return;
    if (this.isHost && this.hostMirror && this.playerId) {
      const me = this.hostMirror.players.get(this.playerId);
      if (me) {
        Object.assign(me, state);
        this.broadcastToP2pPeers({ type: 'player_moved', player: me });
      }
    }
    if (this.transport === 'p2p' && this.guestConn?.open) {
      this.guestConn.send({ type: 'player_move', ...state });
    } else {
      this.sendToLocalServer({ type: 'player_move', ...state });
    }
  }

  sendBlockSet(x: number, y: number, z: number, blockId: number) {
    if (!this.connected) return;
    if (this.isHost && this.hostMirror) {
      this.hostMirror.blockEdits.set(`${x},${y},${z}`, blockId);
      this.broadcastToP2pPeers({ type: 'block_updated', x, y, z, blockId });
    }
    if (this.transport === 'p2p' && this.guestConn?.open) {
      this.guestConn.send({ type: 'block_set', x, y, z, blockId });
    } else {
      this.sendToLocalServer({ type: 'block_set', x, y, z, blockId });
    }
  }

  sendChat(text: string) {
    if (!this.connected) return;
    if (this.isHost && this.hostMirror && this.playerId) {
      const me = this.hostMirror.players.get(this.playerId);
      if (me) {
        this.broadcastToP2pPeers({
          type: 'chat_broadcast',
          sender: me.name,
          color: me.color,
          text,
        });
      }
    }
    if (this.transport === 'p2p' && this.guestConn?.open) {
      this.guestConn.send({ type: 'chat_msg', text });
    } else {
      this.sendToLocalServer({ type: 'chat_msg', text });
    }
  }

  sendWorldSync(mode: GameMode, timeOfDay: number, dayCount: number) {
    if (!this.connected || !this.isHost) return;
    if (this.hostMirror) {
      this.hostMirror.mode = mode;
      this.hostMirror.timeOfDay = timeOfDay;
      this.hostMirror.dayCount = dayCount;
      this.broadcastToP2pPeers({ type: 'world_synced', mode, timeOfDay, dayCount });
    }
    this.sendToLocalServer({ type: 'world_sync', mode, timeOfDay, dayCount });
  }

  disconnect() {
    this.disposed = true;
    this.stopHttpPolling();
    if (this.transport === 'http' && this.code && this.playerId) {
      try {
        navigator.sendBeacon?.(
          '/api/mp/action',
          new Blob([JSON.stringify({ code: this.code, playerId: this.playerId, type: 'leave' })], {
            type: 'application/json',
          }),
        );
      } catch {
        // ignore
      }
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.guestConn) {
      try {
        this.guestConn.close();
      } catch {
        // ignore
      }
      this.guestConn = null;
    }
    for (const conn of this.hostPeerConns.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.hostPeerConns.clear();
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    this.hostMirror = null;
    this.transport = 'none';
    this.connected = false;
    this.code = null;
    this.playerId = null;
    this.isHost = false;
  }
}
