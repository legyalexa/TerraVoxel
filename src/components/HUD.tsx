import React, { useEffect, useRef, useState } from 'react';
import { DAY_CYCLE_SECONDS } from '../engine/constants';
import { HudSnapshot } from '../types/game';
import { ItemIcon } from './ItemIcon';

interface HUDProps {
  hud: HudSnapshot;
  onResumeClick: () => void;
  onOpenPause: () => void;
  onOpenInventory: () => void;
  onToggleCrouch: () => void;
  onSendChat: (text: string) => void;
  onCloseChat: () => void;
}

function formatClock(timeOfDay: number): string {
  const frac = (timeOfDay % DAY_CYCLE_SECONDS) / DAY_CYCLE_SECONDS;
  // 0s = 06:00 sunrise
  const totalMinutes = Math.floor((frac * 24 * 60 + 6 * 60) % (24 * 60));
  const hh = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, '0');
  const mm = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export const HUD: React.FC<HUDProps> = ({
  hud,
  onResumeClick,
  onOpenPause,
  onOpenInventory,
  onToggleCrouch,
  onSendChat,
  onCloseChat,
}) => {
  const [chatText, setChatText] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (hud.chatOpen) {
      setChatText('');
      setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  }, [hud.chatOpen]);

  const renderHearts = () => {
    const icons = [];
    for (let i = 0; i < 10; i++) {
      const hpForThis = hud.health - i * 2;
      const state = hpForThis >= 2 ? 'full' : hpForThis >= 1 ? 'half' : 'empty';
      icons.push(
        <svg key={i} viewBox="0 0 16 16" className="w-4 h-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          <path
            d="M8 14s-5.5-3.5-6.5-7C.8 4.6 2.5 2.5 4.8 2.5c1.3 0 2.5.7 3.2 1.8.7-1.1 1.9-1.8 3.2-1.8 2.3 0 4 2.1 3.3 4.5C13.5 10.5 8 14 8 14z"
            fill="#1e293b"
            stroke="#020617"
            strokeWidth="1.2"
          />
          {state === 'full' && (
            <path
              d="M8 13.2s-4.8-3.1-5.7-6.2C1.7 5 3.1 3.2 4.9 3.2c1.2 0 2.3.7 3.1 1.8.8-1.1 1.9-1.8 3.1-1.8 1.8 0 3.2 1.8 2.6 3.8-.9 3.1-5.7 6.2-5.7 6.2z"
              fill="#ef4444"
            />
          )}
          {state === 'half' && (
            <path
              d="M8 13.2s-4.8-3.1-5.7-6.2C1.7 5 3.1 3.2 4.9 3.2c1.2 0 2.3.7 3.1 1.8v8.2z"
              fill="#ef4444"
            />
          )}
        </svg>,
      );
    }
    return icons;
  };

  const renderHunger = () => {
    const icons = [];
    for (let i = 0; i < 10; i++) {
      const idx = 9 - i;
      const val = hud.hunger - idx * 2;
      const fill = val >= 2 ? '#d97706' : val >= 1 ? '#f59e0b' : '#1e293b';
      icons.push(
        <svg key={i} viewBox="0 0 16 16" className="w-4 h-4 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          <circle cx="9.5" cy="6.5" r="4.5" fill={fill} stroke="#020617" strokeWidth="1.2" />
          <path d="M5.5 10.5 L2.5 13.5" stroke={val >= 1 ? '#e2e8f0' : '#475569'} strokeWidth="2.2" strokeLinecap="round" />
        </svg>,
      );
    }
    return icons;
  };

  const renderArmor = () => {
    if (hud.armorDefense <= 0) return null;
    const icons = [];
    for (let i = 0; i < 10; i++) {
      const val = hud.armorDefense - i * 2;
      const fill = val >= 2 ? '#cbd5e1' : val >= 1 ? '#94a3b8' : '#1e293b';
      icons.push(
        <svg key={i} viewBox="0 0 16 16" className="w-3.5 h-3.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          <path
            d="M3 3 L8 2 L13 3 L12 9 C11.5 12 8 14 8 14 C8 14 4.5 12 4 9 Z"
            fill={fill}
            stroke="#020617"
            strokeWidth="1.2"
          />
        </svg>,
      );
    }
    return <div className="flex items-center gap-0.5 mb-1">{icons}</div>;
  };

  const renderOxygen = () => {
    if (!hud.isUnderwater && hud.oxygen >= hud.maxOxygen) return null;
    const bubbles = Math.ceil(hud.oxygen / 2);
    return (
      <div className="flex items-center justify-end gap-0.5 mb-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full border border-sky-950 ${
              9 - i < bubbles ? 'bg-sky-400' : 'bg-slate-900/60'
            }`}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-10 select-none">
      {/* Underwater Tint */}
      {hud.isUnderwater && <div className="fixed inset-0 bg-sky-900/35 pointer-events-none" />}

      {/* Damage Flash Vignette */}
      {hud.damageFlash > 0 && (
        <div
          className="fixed inset-0 pointer-events-none border-[18px] border-red-600/65"
          style={{ opacity: hud.damageFlash }}
        />
      )}

      {/* F3 Technical Readout */}
      {hud.showDebug && (
        <div className="fixed top-4 left-4 bg-slate-950/85 border border-white/10 rounded px-3 py-2 text-xs text-slate-200 font-mono-tabular space-y-0.5">
          <div>
            XYZ: {hud.coords.x}, {hud.coords.y}, {hud.coords.z} · Biome: {hud.biome}
          </div>
          <div>
            Day {hud.dayCount} · {formatClock(hud.timeOfDay)} · {hud.mode === 'creative' ? 'Creative' : 'Survival'}
            {hud.isFlying ? ' · Flying' : ''}
            {hud.isCrouching ? ' · Crouching' : ''} · {hud.fps} FPS
          </div>
          {(hud.targetBlockName || hud.targetEntityName) && (
            <div className="text-amber-300">
              Target: {hud.targetEntityName ?? hud.targetBlockName}
            </div>
          )}
        </div>
      )}

      {/* Top Right Online Room Badge & Save Feedback */}
      <div className="fixed top-4 right-4 flex flex-col items-end gap-2">
        {hud.roomCode && (
          <div className="bg-slate-950/88 border border-white/15 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2.5">
            <span className="text-slate-400">Room</span>
            <span className="font-mono-tabular font-bold tracking-wider text-amber-400">{hud.roomCode}</span>
            <span className="text-slate-600">·</span>
            <span className="text-slate-200 font-medium">{hud.onlinePlayers.length + 1} online</span>
          </div>
        )}
        {hud.saveStatusText && (
          <div className="bg-slate-950/85 border border-white/15 rounded px-3 py-1.5 text-xs text-emerald-300 font-medium">
            {hud.saveStatusText}
          </div>
        )}
      </div>

      {/* Multiplayer Chat Feed & Input (Bottom Left) */}
      {hud.roomCode && (hud.chatMessages.length > 0 || hud.chatOpen) && (
        <div className="fixed bottom-24 left-4 w-80 max-w-[calc(100vw-2rem)] flex flex-col gap-1.5">
          {hud.chatMessages.length > 0 && (
            <div className="bg-slate-950/75 border border-white/10 rounded-lg px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
              {hud.chatMessages.slice(-6).map((m) => (
                <div key={m.id} className="text-xs leading-snug break-words">
                  <span className="font-semibold mr-1.5" style={{ color: m.color }}>
                    {m.sender}:
                  </span>
                  <span className="text-slate-100">{m.text}</span>
                </div>
              ))}
            </div>
          )}
          {hud.chatOpen && (
            <form
              className="pointer-events-auto flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onSendChat(chatText);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <input
                ref={chatInputRef}
                type="text"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    onCloseChat();
                  }
                }}
                maxLength={140}
                placeholder="Type message (Enter to send, Esc to cancel)"
                className="flex-1 px-3 py-1.5 rounded-lg bg-slate-950/95 border border-amber-400/60 text-xs text-white focus:outline-none"
              />
            </form>
          )}
        </div>
      )}

      {/* Center Crosshair & Attack Cooldown / Bow Tension */}
      {hud.activeModal === 'none' && !hud.chatOpen && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="relative w-5 h-5 flex items-center justify-center">
            <div className="w-4 h-0.5 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
            <div className="absolute w-0.5 h-4 bg-white/90 shadow-[0_0_2px_rgba(0,0,0,0.9)]" />
          </div>
          {hud.attackCooldown < 0.99 && (
            <div className="mt-2 w-8 h-1 bg-slate-950/80 rounded-full overflow-hidden">
              <div className="h-full bg-white/90" style={{ width: `${Math.round(hud.attackCooldown * 100)}%` }} />
            </div>
          )}
          {hud.bowCharge > 0.05 && (
            <div className="mt-2 w-10 h-1.5 bg-slate-950/80 rounded-full overflow-hidden border border-white/20">
              <div className="h-full bg-amber-400" style={{ width: `${Math.round(hud.bowCharge * 100)}%` }} />
            </div>
          )}
          {hud.targetEntityName && (
            <div className="mt-3 text-[11px] font-medium text-white bg-slate-950/75 px-2 py-0.5 rounded">
              {hud.targetEntityName}
            </div>
          )}
        </div>
      )}

      {/* Bottom Center Hotbar, Crouch Button & Survival Vitals */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
        {hud.heldItemName && (
          <div className="mb-1.5 text-xs font-medium text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
            {hud.heldItemName}
          </div>
        )}

        {hud.mode === 'survival' && (
          <div className="w-full flex items-end justify-between px-0.5 mb-1.5">
            <div className="flex flex-col">
              {renderArmor()}
              <div className="flex items-center gap-0.5">{renderHearts()}</div>
            </div>
            <div className="flex flex-col items-end">
              {renderOxygen()}
              <div className="flex items-center gap-0.5">{renderHunger()}</div>
            </div>
          </div>
        )}

        {/* 9-Slot Hotbar + Dedicated Crouch Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-1.5 bg-slate-950/85 border border-white/15 rounded-lg">
            {hud.hotbar.map((slot, i) => {
              const active = i === hud.activeSlot;
              return (
                <div
                  key={i}
                  className={`relative w-11 h-11 rounded flex items-center justify-center ${
                    active
                      ? 'bg-slate-700/90 ring-2 ring-amber-400'
                      : 'bg-slate-900/90 border border-white/10'
                  }`}
                >
                  <span className="absolute top-0.5 left-1 text-[9px] text-slate-400 font-mono-tabular">
                    {i + 1}
                  </span>
                  <ItemIcon slot={slot} size={32} />
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCrouch();
            }}
            className={`pointer-events-auto h-14 px-3 rounded-lg border flex flex-col items-center justify-center transition-colors cursor-pointer shrink-0 ${
              hud.isCrouching
                ? 'bg-amber-500 border-amber-300 text-slate-950 font-bold'
                : 'bg-slate-950/85 border-white/15 text-slate-200 hover:bg-slate-800/90 font-medium'
            }`}
            title="Toggle Crouch (C hold / V toggle)"
          >
            <svg viewBox="0 0 20 20" className="w-4 h-4 mb-0.5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="10" cy="4.5" r="2" />
              <path d="M7 9.5h6l-1.5 4.5h3v3M8.5 14l-2 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[10px] leading-none tracking-tight">
              {hud.isCrouching ? 'Crouched' : 'Crouch'}
            </span>
          </button>
        </div>

        {/* Subtle Single-Line Controls Legend */}
        <div className="mt-1.5 text-[11px] text-slate-300/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] whitespace-nowrap">
          WASD Move · Space Jump{hud.mode === 'creative' ? ' (2x Fly)' : ''} · C/V Crouch · E Inventory · Q Drop
          {hud.roomCode ? ' · T Chat' : ''} · Esc Menu
        </div>
      </div>

      {/* Click-to-Resume Pointer Lock Overlay */}
      {!hud.pointerLocked && hud.activeModal === 'none' && !hud.chatOpen && (
        <div className="fixed inset-0 bg-slate-950/55 flex items-center justify-center pointer-events-auto">
          <div className="bg-slate-900 border border-white/15 rounded-xl px-7 py-6 text-center max-w-sm shadow-2xl">
            <h2 className="font-display text-xl font-semibold text-white">Game Paused</h2>
            <p className="mt-1.5 text-sm text-slate-300">
              Click below to lock the cursor and return to first-person control.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                onClick={onResumeClick}
                className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Resume Playing
              </button>
              <button
                onClick={onOpenInventory}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Inventory
              </button>
              <button
                onClick={onOpenPause}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Menu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
