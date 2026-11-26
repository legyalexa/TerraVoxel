import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, BookOpen, Flame, ArrowRight } from 'lucide-react';
import { ALL_ITEM_IDS, ITEM_DEFS } from '../engine/constants';
import { RECIPES, findMatchingRecipe } from '../engine/crafting';
import { VoxelWorld } from '../engine/VoxelWorld';
import { ArmorSlotType, FurnaceState, HudSnapshot, InventorySlot, Recipe } from '../types/game';
import { ItemIcon } from './ItemIcon';

interface InventoryModalProps {
  world: VoxelWorld;
  hud: HudSnapshot;
  onClose: () => void;
}

const ARMOR_SLOT_TYPES: ArmorSlotType[] = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_LABELS = ['Helmet', 'Chest', 'Legs', 'Boots'];

export const InventoryModal: React.FC<InventoryModalProps> = ({ world, hud, onClose }) => {
  const isTable = hud.activeModal === 'crafting';
  const isFurnace = hud.activeModal === 'furnace' && hud.openFurnace !== null;
  const gridSize = isTable ? 3 : 2;

  const [craftGrid, setCraftGrid] = useState<(InventorySlot | null)[][]>(() =>
    Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => null)),
  );
  const [cursorSlot, setCursorSlot] = useState<InventorySlot | null>(null);
  const [hoverName, setHoverName] = useState<string>('');
  const [showRecipes, setShowRecipes] = useState<boolean>(true);
  const [creativeSearch, setCreativeSearch] = useState<string>('');
  const [creativeCat, setCreativeCat] = useState<string>('all');

  // Reset crafting grid when switching between 2x2 and 3x3
  useEffect(() => {
    setCraftGrid(Array.from({ length: gridSize }, () => Array.from({ length: gridSize }, () => null)));
  }, [gridSize]);

  const matchedRecipe = useMemo(() => findMatchingRecipe(craftGrid, isTable), [craftGrid, isTable]);

  const filteredCreativeItems = useMemo(() => {
    const q = creativeSearch.trim().toLowerCase();
    return ALL_ITEM_IDS.filter((id) => {
      const def = ITEM_DEFS[id];
      if (!def) return false;
      if (creativeCat !== 'all' && def.category !== creativeCat) return false;
      if (q && !def.name.toLowerCase().includes(q) && !id.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [creativeSearch, creativeCat]);

  const handleCloseSafely = () => {
    // Return any items in crafting grid or cursor to inventory
    for (const row of craftGrid) {
      for (const cell of row) {
        if (cell) world.addItemToInventory(cell.itemId, cell.count, cell.durability);
      }
    }
    if (cursorSlot) {
      world.addItemToInventory(cursorSlot.itemId, cursorSlot.count, cursorSlot.durability);
    }
    onClose();
  };

  const interactSlot = (
    current: InventorySlot | null,
    setter: (next: InventorySlot | null) => void,
    e: React.MouseEvent,
    acceptCheck?: (itemId: string) => boolean,
  ) => {
    e.preventDefault();
    const isRight = e.button === 2;

    if (e.shiftKey && current && !cursorSlot) {
      // Quick-move not needed for every sub-zone, handled in dedicated quick move or fallback:
    }

    if (!cursorSlot) {
      if (!current) return;
      if (isRight && current.count > 1) {
        const take = Math.ceil(current.count / 2);
        const rem = current.count - take;
        setCursorSlot({ ...current, count: take });
        setter(rem > 0 ? { ...current, count: rem } : null);
      } else {
        setCursorSlot({ ...current });
        setter(null);
      }
      return;
    }

    // Cursor has item
    if (acceptCheck && !acceptCheck(cursorSlot.itemId)) return;
    const def = ITEM_DEFS[cursorSlot.itemId];
    const maxStack = def?.maxStack ?? 64;

    if (!current) {
      if (isRight && cursorSlot.count > 1) {
        setter({ ...cursorSlot, count: 1 });
        setCursorSlot({ ...cursorSlot, count: cursorSlot.count - 1 });
      } else {
        setter({ ...cursorSlot });
        setCursorSlot(null);
      }
      return;
    }

    if (current.itemId === cursorSlot.itemId && maxStack > 1 && current.count < maxStack) {
      const add = isRight ? 1 : Math.min(cursorSlot.count, maxStack - current.count);
      setter({ ...current, count: current.count + add });
      const left = cursorSlot.count - add;
      setCursorSlot(left > 0 ? { ...cursorSlot, count: left } : null);
      return;
    }

    // Swap
    if (!isRight) {
      setter({ ...cursorSlot });
      setCursorSlot({ ...current });
    }
  };

  const handleCraftTake = (e: React.MouseEvent) => {
    if (!matchedRecipe) return;
    const outDef = ITEM_DEFS[matchedRecipe.outputItemId];
    if (!outDef) return;

    const maxCrafts = e.shiftKey ? 64 : 1;
    let crafted = 0;

    let nextGrid = craftGrid.map((r) => r.map((c) => (c ? { ...c } : null)));
    let tempCursor = cursorSlot ? { ...cursorSlot } : null;

    for (let step = 0; step < maxCrafts; step++) {
      const rec = findMatchingRecipe(nextGrid, isTable);
      if (!rec || rec.id !== matchedRecipe.id) break;

      if (tempCursor) {
        if (tempCursor.itemId !== rec.outputItemId) break;
        if (tempCursor.count + rec.outputCount > outDef.maxStack) break;
        tempCursor.count += rec.outputCount;
      } else {
        tempCursor = {
          itemId: rec.outputItemId,
          count: rec.outputCount,
          durability: outDef.maxDurability,
        };
      }

      // Consume 1 of each non-null cell
      for (let r = 0; r < nextGrid.length; r++) {
        for (let c = 0; c < nextGrid[0].length; c++) {
          const cell = nextGrid[r][c];
          if (cell) {
            cell.count -= 1;
            if (cell.count <= 0) nextGrid[r][c] = null;
          }
        }
      }
      crafted++;
      if (!e.shiftKey) break;
    }

    if (crafted > 0) {
      setCraftGrid(nextGrid);
      if (e.shiftKey && tempCursor) {
        const rem = world.addItemToInventory(tempCursor.itemId, tempCursor.count, tempCursor.durability);
        setCursorSlot(rem > 0 ? { ...tempCursor, count: rem } : null);
      } else {
        setCursorSlot(tempCursor);
      }
    }
  };

  const handleAutoFillRecipe = (recipe: Recipe) => {
    if (recipe.requiresTable && !isTable) return;
    // Clear existing grid back to inventory first
    for (const row of craftGrid) {
      for (const cell of row) {
        if (cell) world.addItemToInventory(cell.itemId, cell.count, cell.durability);
      }
    }
    const nextGrid: (InventorySlot | null)[][] = Array.from({ length: gridSize }, () =>
      Array.from({ length: gridSize }, () => null),
    );

    // Check required counts
    const needed = new Map<string, number>();
    if (recipe.shapeless && recipe.ingredients) {
      for (const id of recipe.ingredients) needed.set(id, (needed.get(id) ?? 0) + 1);
    } else if (recipe.pattern) {
      for (const row of recipe.pattern) {
        for (const id of row) {
          if (id) needed.set(id, (needed.get(id) ?? 0) + 1);
        }
      }
    }

    if (hud.mode === 'survival') {
      for (const [id, cnt] of needed.entries()) {
        if (world.countItem(id) < cnt) {
          setCraftGrid(nextGrid);
          return;
        }
      }
      for (const [id, cnt] of needed.entries()) {
        world.consumeItem(id, cnt);
      }
    }

    if (recipe.shapeless && recipe.ingredients) {
      recipe.ingredients.forEach((id, idx) => {
        const r = Math.floor(idx / gridSize);
        const c = idx % gridSize;
        if (r < gridSize) nextGrid[r][c] = { itemId: id, count: 1 };
      });
    } else if (recipe.pattern) {
      for (let r = 0; r < recipe.pattern.length; r++) {
        for (let c = 0; c < recipe.pattern[r].length; c++) {
          const id = recipe.pattern[r][c];
          if (id && r < gridSize && c < gridSize) {
            nextGrid[r][c] = { itemId: id, count: 1 };
          }
        }
      }
    }
    setCraftGrid(nextGrid);
  };

  const updateFurnace = (patch: Partial<FurnaceState>) => {
    if (!hud.openFurnace) return;
    world.updateFurnaceState(hud.openFurnace.key, {
      ...hud.openFurnace,
      ...patch,
    });
  };

  const renderSlotBox = (
    slot: InventorySlot | null,
    onMouseDown: (e: React.MouseEvent) => void,
    label?: string,
    extraClass = '',
  ) => (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={() => setHoverName(slot ? ITEM_DEFS[slot.itemId]?.name ?? slot.itemId : label ?? '')}
      onMouseLeave={() => setHoverName('')}
      className={`relative w-11 h-11 rounded bg-slate-900/95 border border-white/15 hover:border-amber-400/70 flex items-center justify-center cursor-pointer transition-colors ${extraClass}`}
    >
      {!slot && label && <span className="text-[9px] text-slate-500 text-center leading-tight px-0.5">{label}</span>}
      <ItemIcon slot={slot} size={32} />
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-30 bg-slate-950/72 flex items-center justify-center p-4"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="bg-slate-900 border border-white/15 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold text-white">
              {isFurnace
                ? 'Furnace'
                : isTable
                  ? 'Crafting Table (3x3)'
                  : hud.mode === 'creative'
                    ? 'Creative Catalog & Inventory'
                    : 'Inventory & Crafting'}
            </h2>
            {hoverName && <span className="text-xs text-amber-300 font-medium">{hoverName}</span>}
          </div>
          <div className="flex items-center gap-2">
            {!isFurnace && hud.mode === 'survival' && (
              <button
                onClick={() => setShowRecipes((s) => !s)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 cursor-pointer whitespace-nowrap"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {showRecipes ? 'Hide Recipes' : 'Show Recipes'}
              </button>
            )}
            <button
              onClick={handleCloseSafely}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col lg:flex-row gap-6 overflow-y-auto">
          {/* Left Side: Crafting / Furnace / Creative Catalog + Player Inventory */}
          <div className="flex-1 space-y-5">
            {isFurnace && hud.openFurnace ? (
              <div className="flex items-center justify-center gap-6 py-4 bg-slate-950/60 rounded-lg border border-white/10">
                <div className="flex flex-col items-center gap-2">
                  {renderSlotBox(
                    hud.openFurnace.input,
                    (e) =>
                      interactSlot(hud.openFurnace!.input, (next) => updateFurnace({ input: next }), e),
                    'Ore / Food',
                  )}
                  <div className="w-5 h-5 flex items-center justify-center">
                    <Flame
                      className={`w-4 h-4 ${
                        hud.openFurnace.burnTime > 0 ? 'text-amber-400' : 'text-slate-600'
                      }`}
                    />
                  </div>
                  {renderSlotBox(
                    hud.openFurnace.fuel,
                    (e) =>
                      interactSlot(hud.openFurnace!.fuel, (next) => updateFurnace({ fuel: next }), e),
                    'Fuel',
                  )}
                </div>

                <div className="flex flex-col items-center gap-1.5">
                  <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 transition-all"
                      style={{
                        width: `${Math.round((hud.openFurnace.cookProgress / hud.openFurnace.cookTime) * 100)}%`,
                      }}
                    />
                  </div>
                  <ArrowRight className="w-5 h-5 text-slate-400" />
                  <span className="text-[11px] text-slate-400 font-mono-tabular">
                    {hud.openFurnace.burnTime > 0 ? `${hud.openFurnace.burnTime.toFixed(0)}s fuel` : 'Idle'}
                  </span>
                </div>

                <div>
                  {renderSlotBox(
                    hud.openFurnace.output,
                    (e) =>
                      interactSlot(
                        hud.openFurnace!.output,
                        (next) => updateFurnace({ output: next }),
                        e,
                        () => false,
                      ),
                    'Output',
                    'ring-1 ring-amber-500/30',
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-950/60 p-4 rounded-lg border border-white/10">
                {/* Armor Column */}
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-1.5">
                    {ARMOR_SLOT_TYPES.map((slotType, idx) => (
                      <div key={slotType}>
                        {renderSlotBox(
                          hud.armor[idx],
                          (e) =>
                            interactSlot(
                              hud.armor[idx],
                              (next) => world.setInventorySlot('armor', idx, next),
                              e,
                              (itemId) => ITEM_DEFS[itemId]?.armorSlot === slotType,
                            ),
                          ARMOR_LABELS[idx],
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-400 pl-2 space-y-1">
                    <div className="font-medium text-slate-200">Armor</div>
                    <div className="font-mono-tabular">Defense: {hud.armorDefense}</div>
                  </div>
                </div>

                {/* Crafting Grid */}
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-xs text-slate-400 mb-1.5 font-medium">
                      Crafting ({gridSize}x{gridSize})
                    </div>
                    <div
                      className="grid gap-1"
                      style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}
                    >
                      {craftGrid.map((row, r) =>
                        row.map((cell, c) => (
                          <div key={`${r}-${c}`}>
                            {renderSlotBox(cell, (e) =>
                              interactSlot(cell, (next) => {
                                const copy = craftGrid.map((rr) => [...rr]);
                                copy[r][c] = next;
                                setCraftGrid(copy);
                              }, e),
                            )}
                          </div>
                        )),
                      )}
                    </div>
                  </div>

                  <ArrowRight className="w-5 h-5 text-slate-400 mt-5" />

                  <div className="mt-5">
                    {renderSlotBox(
                      matchedRecipe
                        ? { itemId: matchedRecipe.outputItemId, count: matchedRecipe.outputCount }
                        : null,
                      handleCraftTake,
                      'Result',
                      matchedRecipe ? 'ring-2 ring-amber-400/80' : '',
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Creative Searchable Catalog */}
            {hud.mode === 'creative' && !isFurnace && (
              <div className="bg-slate-950/60 p-3.5 rounded-lg border border-white/10 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[160px]">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={creativeSearch}
                      onChange={(e) => setCreativeSearch(e.target.value)}
                      placeholder="Search blocks & items..."
                      className="w-full pl-8 pr-3 py-1.5 rounded bg-slate-900 border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {(['all', 'block', 'tool', 'weapon', 'armor', 'food', 'material'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setCreativeCat(cat)}
                        className={`px-2 py-1 rounded text-[11px] capitalize cursor-pointer whitespace-nowrap ${
                          creativeCat === cat
                            ? 'bg-amber-500 text-slate-950 font-semibold'
                            : 'bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-9 gap-1 max-h-40 overflow-y-auto pr-1">
                  {filteredCreativeItems.map((id) => (
                    <div
                      key={id}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        world.giveCreativeItem(id, !e.shiftKey);
                      }}
                      onMouseEnter={() => setHoverName(ITEM_DEFS[id]?.name ?? id)}
                      onMouseLeave={() => setHoverName('')}
                      className="w-11 h-11 rounded bg-slate-900 border border-white/10 hover:border-amber-400 flex items-center justify-center cursor-pointer"
                    >
                      <ItemIcon itemId={id} size={32} showCount={false} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main 27-Slot Inventory */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5 font-medium">Backpack (Left-click Move · Right-click Split)</div>
              <div className="grid grid-cols-9 gap-1">
                {hud.inventory.map((slot, idx) => (
                  <div key={idx}>
                    {renderSlotBox(slot, (e) =>
                      interactSlot(slot, (next) => world.setInventorySlot('inventory', idx, next), e),
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 9-Slot Hotbar */}
            <div>
              <div className="text-xs text-slate-400 mb-1.5 font-medium">Hotbar</div>
              <div className="grid grid-cols-9 gap-1">
                {hud.hotbar.map((slot, idx) => (
                  <div key={idx}>
                    {renderSlotBox(
                      slot,
                      (e) => interactSlot(slot, (next) => world.setInventorySlot('hotbar', idx, next), e),
                      undefined,
                      idx === hud.activeSlot ? 'ring-2 ring-amber-400/70' : '',
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Side: Recipe Book Helper */}
          {!isFurnace && showRecipes && hud.mode === 'survival' && (
            <div className="w-full lg:w-64 bg-slate-950/65 border border-white/10 rounded-lg p-3 flex flex-col max-h-[520px]">
              <div className="text-xs font-semibold text-slate-200 mb-2">
                Crafting Recipes {isTable ? '(All Unlocked)' : '(2x2 Only)'}
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {RECIPES.filter((r) => isTable || !r.requiresTable).map((rec) => {
                  const outDef = ITEM_DEFS[rec.outputItemId];
                  return (
                    <button
                      key={rec.id}
                      onClick={() => handleAutoFillRecipe(rec)}
                      className="w-full flex items-center gap-2.5 p-2 rounded bg-slate-900/90 hover:bg-slate-800 border border-white/10 text-left transition-colors cursor-pointer"
                    >
                      <div className="w-8 h-8 shrink-0 flex items-center justify-center">
                        <ItemIcon itemId={rec.outputItemId} size={26} showCount={false} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white truncate">
                          {outDef?.name} {rec.outputCount > 1 ? `x${rec.outputCount}` : ''}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {rec.shapeless
                            ? rec.ingredients?.map((id) => ITEM_DEFS[id]?.name).join(', ')
                            : rec.pattern
                                ?.flat()
                                .filter(Boolean)
                                .reduce<Record<string, number>>((acc, id) => {
                                  if (id) acc[id] = (acc[id] ?? 0) + 1;
                                  return acc;
                                }, {}) &&
                              Object.entries(
                                rec.pattern
                                  .flat()
                                  .filter(Boolean)
                                  .reduce<Record<string, number>>((acc, id) => {
                                    if (id) acc[id] = (acc[id] ?? 0) + 1;
                                    return acc;
                                  }, {}),
                              )
                                .map(([id, c]) => `${c}x ${ITEM_DEFS[id]?.name}`)
                                .join(', ')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Floating Cursor Stack */}
      {cursorSlot && (
        <CursorFollower slot={cursorSlot} />
      )}
    </div>
  );
};

const CursorFollower: React.FC<{ slot: InventorySlot }> = ({ slot }) => {
  const [pos, setPos] = useState({ x: -100, y: -100 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div
      className="fixed z-50 w-10 h-10 pointer-events-none -translate-x-1/2 -translate-y-1/2"
      style={{ left: pos.x, top: pos.y }}
    >
      <ItemIcon slot={slot} size={34} />
    </div>
  );
};
