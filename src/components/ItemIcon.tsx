import React, { useMemo } from 'react';
import { ITEM_DEFS } from '../engine/constants';
import { getItemIconUrl } from '../engine/textures';
import { InventorySlot } from '../types/game';

interface ItemIconProps {
  slot?: InventorySlot | null;
  itemId?: string;
  size?: number;
  showCount?: boolean;
}

export const ItemIcon: React.FC<ItemIconProps> = ({ slot, itemId, size = 34, showCount = true }) => {
  const id = slot?.itemId ?? itemId;
  const iconUrl = useMemo(() => (id ? getItemIconUrl(id) : ''), [id]);

  if (!id) return null;
  const def = ITEM_DEFS[id];
  const maxDur = def?.maxDurability;
  const durRatio =
    slot?.durability !== undefined && maxDur ? Math.max(0, Math.min(1, slot.durability / maxDur)) : null;

  return (
    <div className="relative flex items-center justify-center w-full h-full pointer-events-none">
      <img
        src={iconUrl}
        alt={def?.name ?? id}
        width={size}
        height={size}
        className="pixelated object-contain"
        draggable={false}
      />
      {showCount && slot && slot.count > 1 && (
        <span className="absolute bottom-0.5 right-1 text-[11px] font-semibold leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] font-mono-tabular">
          {slot.count}
        </span>
      )}
      {durRatio !== null && durRatio < 1 && (
        <div className="absolute bottom-1 left-1.5 right-1.5 h-1 bg-slate-950/90 rounded-sm overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${Math.round(durRatio * 100)}%`,
              backgroundColor: durRatio > 0.5 ? '#22c55e' : durRatio > 0.25 ? '#eab308' : '#ef4444',
            }}
          />
        </div>
      )}
    </div>
  );
};
