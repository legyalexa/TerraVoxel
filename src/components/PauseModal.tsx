import React, { useState } from 'react';
import { Check, Copy, Download, Globe, Save, Users, Volume2, VolumeX } from 'lucide-react';
import { soundEngine } from '../engine/audio';
import { downloadWorldSaveFile } from '../engine/storage';
import { VoxelWorld } from '../engine/VoxelWorld';
import { HudSnapshot } from '../types/game';

interface PauseModalProps {
  world: VoxelWorld;
  hud: HudSnapshot;
  onResume: () => void;
  onQuitToTitle: () => void;
  onHostOnline: () => void;
  hostingOnline: boolean;
  hostError: string | null;
}

export const PauseModal: React.FC<PauseModalProps> = ({
  world,
  hud,
  onResume,
  onQuitToTitle,
  onHostOnline,
  hostingOnline,
  hostError,
}) => {
  const [renderDist, setRenderDist] = useState(4);
  const [muted, setMuted] = useState(soundEngine.muted);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await world.saveWorld();
    setSaving(false);
  };

  const handleExport = () => {
    const data = world.buildSaveData();
    downloadWorldSaveFile(data);
  };

  const toggleMute = () => {
    soundEngine.muted = !soundEngine.muted;
    setMuted(soundEngine.muted);
  };

  const handleCopyCode = async () => {
    if (!hud.roomCode) return;
    try {
      await navigator.clipboard.writeText(hud.roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  return (
    <div className="fixed inset-0 z-30 bg-slate-950/75 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/15 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-white">{world.meta.name}</h2>
            <p className="text-xs text-slate-400 font-mono-tabular mt-0.5">
              Seed {world.meta.seed} · Day {hud.dayCount} · {hud.mode === 'creative' ? 'Creative' : 'Survival'}
            </p>
          </div>
          <button
            onClick={toggleMute}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer"
            title={muted ? 'Unmute Audio' : 'Mute Audio'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>

        {/* Online Multiplayer Panel */}
        {hud.roomCode ? (
          <div className="bg-amber-500/10 border border-amber-400/35 rounded-lg p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
                  {hud.isHost ? 'Hosting Online Game' : 'Joined Online Game'}
                </div>
                <div className="font-mono-tabular text-2xl font-bold tracking-[0.2em] text-white mt-0.5">
                  {hud.roomCode}
                </div>
              </div>
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy Code'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
              <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{hud.onlinePlayers.length + 1} player{hud.onlinePlayers.length === 0 ? '' : 's'} connected</span>
              {hud.onlinePlayers.map((p) => (
                <span key={p.id} className="px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 text-[11px]" style={{ color: p.color }}>
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-slate-950/60 border border-white/10 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white">Play With Friends</div>
              <div className="text-[11px] text-slate-400">Open this world to get a 6-digit join code</div>
              {hostError && <div className="text-[11px] text-red-400 mt-1">{hostError}</div>}
            </div>
            <button
              onClick={onHostOnline}
              disabled={hostingOnline}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-60 text-slate-950 font-semibold text-xs cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5" />
              {hostingOnline ? 'Starting...' : 'Host Online'}
            </button>
          </div>
        )}

        <div className="space-y-3 bg-slate-950/60 p-4 rounded-lg border border-white/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">Game Mode</span>
            <div className="flex items-center gap-1 p-0.5 bg-slate-900 rounded-md border border-white/10">
              {(['survival', 'creative'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => world.setGameMode(m)}
                  disabled={Boolean(hud.roomCode && !hud.isHost)}
                  className={`px-3 py-1 rounded text-xs capitalize cursor-pointer transition-colors disabled:opacity-50 ${
                    hud.mode === m ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
              Render Distance ({renderDist} chunks)
            </span>
            <input
              type="range"
              min={2}
              max={6}
              value={renderDist}
              onChange={(e) => {
                const v = Number(e.target.value);
                setRenderDist(v);
                world.setRenderDistance(v);
              }}
              className="w-32 accent-amber-500 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs font-medium text-slate-300">Time of Day</span>
            <div className="flex items-center gap-1">
              {[
                { label: 'Morning', sec: 120 },
                { label: 'Noon', sec: 300 },
                { label: 'Sunset', sec: 625 },
                { label: 'Night', sec: 850 },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => world.setTimeOfDay(t.sec)}
                  disabled={Boolean(hud.roomCode && !hud.isHost)}
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-[11px] text-slate-200 cursor-pointer"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save World'}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export .JSON
          </button>
        </div>

        <div className="flex items-center gap-2.5 pt-1">
          <button
            onClick={onResume}
            className="flex-1 px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
          >
            Resume Game
          </button>
          <button
            onClick={onQuitToTitle}
            className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            Save &amp; Quit
          </button>
        </div>
      </div>
    </div>
  );
};
