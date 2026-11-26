import React, { useEffect, useRef, useState } from 'react';
import { Download, Globe, Play, Plus, Shuffle, Trash2, Upload, Users } from 'lucide-react';
import { decodeRLE } from '../engine/chunkMesher';
import { CHUNK_SIZE } from '../engine/constants';
import { MultiplayerClient, RemotePlayerState } from '../engine/multiplayer';
import { TerrainGenerator } from '../engine/noise';
import { deleteWorldFromDb, listSavedWorlds, loadWorldFromDb, parseWorldSaveFile, saveWorldToDb } from '../engine/storage';
import { createNewWorldSave } from '../engine/VoxelWorld';
import { GameMode, WorldMetadata, WorldSaveData } from '../types/game';

export interface GameSessionConfig {
  saveData: WorldSaveData;
  multiplayer?: {
    client: MultiplayerClient;
    initialEdits?: [string, number][];
    initialPlayers?: RemotePlayerState[];
  };
}

interface TitleScreenProps {
  onStartSession: (session: GameSessionConfig) => void;
}

function extractEditsFromSave(save: WorldSaveData): [string, number][] {
  if (!save.modifiedChunks.length) return [];
  const gen = new TerrainGenerator(save.meta.seed);
  const edits: [string, number][] = [];
  for (const sc of save.modifiedChunks) {
    const blocks = decodeRLE(sc.rle);
    const base = gen.generateChunkBlocks(sc.cx, sc.cz);
    const ox = sc.cx * CHUNK_SIZE;
    const oz = sc.cz * CHUNK_SIZE;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] !== base[i]) {
        const wy = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
        const rem = i % (CHUNK_SIZE * CHUNK_SIZE);
        const lz = Math.floor(rem / CHUNK_SIZE);
        const lx = rem % CHUNK_SIZE;
        edits.push([`${ox + lx},${wy},${oz + lz}`, blocks[i]]);
      }
    }
  }
  return edits;
}

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStartSession }) => {
  const [worlds, setWorlds] = useState<WorldMetadata[]>([]);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('terravoxel_player_name') || 'Explorer');
  const [worldName, setWorldName] = useState('Frontier');
  const [seedInput, setSeedInput] = useState(() => String(Math.floor(Math.random() * 900000 + 100000)));
  const [mode, setMode] = useState<GameMode>('survival');
  const [joinCode, setJoinCode] = useState('');
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [winBusy, setWinBusy] = useState(false);
  const [winStatus, setWinStatus] = useState<string | null>(null);
  const [winError, setWinError] = useState<string | null>(null);
  const [winBlobUrl, setWinBlobUrl] = useState<string | null>(null);
  const [winSizeMb, setWinSizeMb] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isDesktopApp = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');

  const refreshWorlds = async () => {
    const list = await listSavedWorlds();
    setWorlds(list);
  };

  useEffect(() => {
    refreshWorlds();
  }, []);

  useEffect(() => {
    return () => {
      if (winBlobUrl) {
        URL.revokeObjectURL(winBlobUrl);
      }
    };
  }, [winBlobUrl]);

  const persistName = (val: string) => {
    setPlayerName(val);
    localStorage.setItem('terravoxel_player_name', val.trim() || 'Explorer');
  };

  const buildNewSave = () => {
    const numericSeed =
      Number(seedInput) ||
      Math.abs(seedInput.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)) ||
      424242;
    return createNewWorldSave(worldName, numericSeed, mode);
  };

  const hostOnlineWithSave = (save: WorldSaveData) => {
    setMpError(null);
    setMpBusy(true);
    const client = new MultiplayerClient();
    client.setCallbacks({
      onJoined: (payload) => {
        setMpBusy(false);
        onStartSession({
          saveData: save,
          multiplayer: {
            client,
            initialEdits: payload.blockEdits,
            initialPlayers: payload.players,
          },
        });
      },
      onError: (msg) => {
        setMpBusy(false);
        setMpError(msg);
        client.disconnect();
      },
      onDisconnected: () => {
        setMpBusy(false);
      },
    });
    client.hostRoom({
      playerName: playerName.trim() || 'Host',
      worldName: save.meta.name,
      seed: save.meta.seed,
      mode: save.meta.mode,
      timeOfDay: save.meta.timeOfDay,
      dayCount: save.meta.dayCount,
      x: save.player.x,
      y: save.player.y > 0 ? save.player.y : 80,
      z: save.player.z,
      initialEdits: extractEditsFromSave(save),
    });
  };

  const handleCreate = async (e: React.FormEvent, hostOnline = false) => {
    e.preventDefault();
    const save = buildNewSave();
    await saveWorldToDb(save);
    if (hostOnline) {
      hostOnlineWithSave(save);
    } else {
      onStartSession({ saveData: save });
    }
  };

  const handleLoad = async (id: string, hostOnline = false) => {
    const data = await loadWorldFromDb(id);
    if (!data) return;
    if (hostOnline) {
      hostOnlineWithSave(data);
    } else {
      onStartSession({ saveData: data });
    }
  };

  const handleJoinOnline = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = joinCode.replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) {
      setMpError('Enter a valid 6-digit room code.');
      return;
    }
    setMpError(null);
    setMpBusy(true);
    const client = new MultiplayerClient();
    client.setCallbacks({
      onJoined: (payload) => {
        setMpBusy(false);
        const guestSave = createNewWorldSave(payload.worldName, payload.seed, payload.mode);
        guestSave.meta.timeOfDay = payload.timeOfDay;
        guestSave.meta.dayCount = payload.dayCount;
        onStartSession({
          saveData: guestSave,
          multiplayer: {
            client,
            initialEdits: payload.blockEdits,
            initialPlayers: payload.players,
          },
        });
      },
      onError: (msg) => {
        setMpBusy(false);
        setMpError(msg);
        client.disconnect();
      },
      onDisconnected: () => {
        setMpBusy(false);
      },
    });
    client.joinRoom(cleanCode, playerName.trim() || 'Player');
  };

  const handleDelete = async (id: string) => {
    await deleteWorldFromDb(id);
    await refreshWorlds();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseWorldSaveFile(file);
      await saveWorldToDb(parsed);
      await refreshWorlds();
      onStartSession({ saveData: parsed });
    } catch {
      setError('Could not import file. Select a valid TerraVoxel .json save.');
    } finally {
      e.target.value = '';
    }
  };

  const triggerBlobSave = (url: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = 'TerraVoxel-Windows-x64.zip';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadWindowsZip = async () => {
    if (winBusy) return;
    if (winBlobUrl) {
      triggerBlobSave(winBlobUrl);
      return;
    }
    setWinError(null);
    setWinBusy(true);
    setWinStatus('Building Windows .exe zip...');
    try {
      const prepRes = await fetch('/api/prepare-windows-zip', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const prepData = (await prepRes.json()) as { ok?: boolean; sizeBytes?: number; message?: string };
      if (!prepRes.ok || !prepData.ok || !prepData.sizeBytes) {
        throw new Error(prepData.message || 'Could not build Windows zip package.');
      }

      const totalBytes = prepData.sizeBytes;
      const totalMb = (totalBytes / (1024 * 1024)).toFixed(0);
      setWinSizeMb(`${totalMb} MB`);

      const chunkSize = 6 * 1024 * 1024;
      const parts: ArrayBuffer[] = [];
      let downloaded = 0;

      while (downloaded < totalBytes) {
        const len = Math.min(chunkSize, totalBytes - downloaded);
        const pct = Math.round((downloaded / totalBytes) * 100);
        const curMb = (downloaded / (1024 * 1024)).toFixed(0);
        setWinStatus(`Downloading ${pct}% (${curMb}/${totalMb} MB)...`);

        const chunkRes = await fetch(
          `/api/windows-zip-chunk?offset=${downloaded}&length=${len}`,
          { credentials: 'same-origin' },
        );
        if (!chunkRes.ok) {
          throw new Error(`Download interrupted (${chunkRes.status}). Please try again.`);
        }
        const buf = await chunkRes.arrayBuffer();
        parts.push(buf);
        downloaded += buf.byteLength;
        if (buf.byteLength === 0) break;
      }

      const blob = new Blob(parts, { type: 'application/zip' });
      const blobUrl = URL.createObjectURL(blob);
      setWinBlobUrl(blobUrl);
      setWinStatus('Ready — Saving file...');
      triggerBlobSave(blobUrl);
      setTimeout(() => setWinStatus(null), 3500);
    } catch (err) {
      setWinStatus(null);
      setWinError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setWinBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#0b0f17] text-slate-100 flex items-center justify-center p-6 overflow-y-auto">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left: Brand & Create World */}
        <div className="lg:col-span-5 space-y-5">
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight text-white">
              TerraVoxel
            </h1>
            <p className="mt-2 text-sm text-slate-400 leading-relaxed">
              Infinite procedural voxel sandbox with multi-biome terrain, underground caves, day-night lighting, crafting, smelting, and online co-op.
            </p>
            {!isDesktopApp && (
              <div className="mt-3 flex flex-col items-start gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadWindowsZip}
                    disabled={winBusy}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-60 border border-amber-400/35 text-amber-300 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {winBusy
                      ? winStatus || 'Preparing .zip...'
                      : winBlobUrl
                        ? `Save TerraVoxel-Windows-x64.zip (${winSizeMb})`
                        : winStatus || 'Download Windows .EXE (.zip)'}
                  </button>
                  {winBlobUrl && (
                    <a
                      href={winBlobUrl}
                      download="TerraVoxel-Windows-x64.zip"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors"
                    >
                      Save File
                    </a>
                  )}
                </div>
                <span className="text-[11px] text-slate-400">
                  Extract all files and run <span className="font-mono-tabular text-slate-300">TerraVoxel.exe</span> on Windows x64.
                </span>
                {winError && <span className="text-xs text-red-400">{winError}</span>}
              </div>
            )}
          </div>

          {/* Join Friend's Online Game */}
          <form onSubmit={handleJoinOnline} className="bg-slate-900/90 border border-sky-400/25 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-white flex items-center gap-2">
                <Users className="w-4 h-4 text-sky-400" />
                Join Friend&apos;s Online Game
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">Your Name</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => persistName(e.target.value)}
                  maxLength={18}
                  placeholder="Explorer"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-sm text-white focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">6-Digit Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6}
                  placeholder="123456"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-sm text-white font-mono-tabular tracking-[0.25em] text-center focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            {mpError && <div className="text-xs text-red-400">{mpError}</div>}

            <button
              type="submit"
              disabled={mpBusy || joinCode.length !== 6}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
            >
              <Globe className="w-4 h-4" />
              {mpBusy ? 'Connecting...' : 'Join Online World'}
            </button>
          </form>

          <form onSubmit={(e) => handleCreate(e, false)} className="bg-slate-900/90 border border-white/10 rounded-xl p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-white">Create New World</h2>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">World Name</label>
              <input
                type="text"
                value={worldName}
                onChange={(e) => setWorldName(e.target.value)}
                maxLength={32}
                required
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-sm text-white focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">World Seed</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={seedInput}
                  onChange={(e) => setSeedInput(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/10 text-sm text-white font-mono-tabular focus:outline-none focus:border-amber-400"
                />
                <button
                  type="button"
                  onClick={() => setSeedInput(String(Math.floor(Math.random() * 900000 + 100000)))}
                  className="p-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
                  title="Random Seed"
                >
                  <Shuffle className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">Game Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('survival')}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    mode === 'survival'
                      ? 'bg-amber-500/15 border-amber-400 text-white'
                      : 'bg-slate-950 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="text-xs font-semibold">Survival</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Gather, craft, health &amp; night mobs</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('creative')}
                  className={`px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${
                    mode === 'creative'
                      ? 'bg-amber-500/15 border-amber-400 text-white'
                      : 'bg-slate-950 border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="text-xs font-semibold">Creative</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">All blocks, instant break, flight</div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="submit"
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Play Solo
              </button>
              <button
                type="button"
                disabled={mpBusy}
                onClick={(e) => handleCreate(e, true)}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-sky-400/35 text-sky-300 font-semibold text-sm transition-colors cursor-pointer"
              >
                <Globe className="w-4 h-4" />
                Host Online
              </button>
            </div>
          </form>
        </div>

        {/* Right: Saved Worlds & Controls */}
        <div className="lg:col-span-7 space-y-5">
          <div className="bg-slate-900/90 border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-base font-semibold text-white">Saved Worlds</h2>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Import .JSON Save
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>

            {error && <div className="mb-3 text-xs text-red-400">{error}</div>}

            {worlds.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400 border border-dashed border-white/10 rounded-lg">
                No saved worlds yet. Create one on the left or import a JSON save file.
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {worlds.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg bg-slate-950/80 border border-white/10 hover:border-white/20"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{w.name}</div>
                      <div className="text-xs text-slate-400 font-mono-tabular">
                        {w.mode === 'creative' ? 'Creative' : 'Survival'} · Day {w.dayCount} · Seed {w.seed}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleLoad(w.id, false)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5" />
                        Play
                      </button>
                      <button
                        onClick={() => handleLoad(w.id, true)}
                        disabled={mpBusy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-300 font-medium text-xs cursor-pointer"
                        title="Host Saved World Online"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        Host
                      </button>
                      <button
                        onClick={() => handleDelete(w.id)}
                        className="p-2 rounded-lg bg-slate-800 hover:bg-red-900/60 text-slate-400 hover:text-red-300 cursor-pointer"
                        title="Delete World"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900/90 border border-white/10 rounded-xl p-5">
            <h3 className="font-display text-sm font-semibold text-white mb-3">Controls Reference</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4 text-xs text-slate-300">
              <div><span className="text-amber-300 font-mono-tabular">W A S D</span> Move</div>
              <div><span className="text-amber-300 font-mono-tabular">Space</span> Jump / 2x Fly</div>
              <div><span className="text-amber-300 font-mono-tabular">Shift</span> Sprint / Descend</div>
              <div><span className="text-amber-300 font-mono-tabular">C / Ctrl / V</span> Crouch</div>
              <div><span className="text-amber-300 font-mono-tabular">Left Click</span> Mine / Attack</div>
              <div><span className="text-amber-300 font-mono-tabular">Right Click</span> Place / Use / Eat</div>
              <div><span className="text-amber-300 font-mono-tabular">1-9 / Wheel</span> Select Slot</div>
              <div><span className="text-amber-300 font-mono-tabular">E</span> Inventory &amp; Craft</div>
              <div><span className="text-amber-300 font-mono-tabular">Q</span> Drop Held Item</div>
              <div><span className="text-amber-300 font-mono-tabular">T</span> Online Chat</div>
              <div><span className="text-amber-300 font-mono-tabular">F3</span> Debug Coords</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
