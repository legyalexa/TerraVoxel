import { InventorySlot, Recipe } from '../types/game';
import { ITEM_DEFS } from './constants';

export const RECIPES: Recipe[] = [
  // Basic 2x2 survival essentials
  {
    id: 'planks_from_oak',
    outputItemId: 'block_planks',
    outputCount: 4,
    shapeless: true,
    ingredients: ['block_oak_log'],
    category: 'building',
  },
  {
    id: 'planks_from_birch',
    outputItemId: 'block_planks',
    outputCount: 4,
    shapeless: true,
    ingredients: ['block_birch_log'],
    category: 'building',
  },
  {
    id: 'sticks',
    outputItemId: 'stick',
    outputCount: 4,
    pattern: [
      ['block_planks'],
      ['block_planks'],
    ],
    category: 'misc',
  },
  {
    id: 'crafting_table',
    outputItemId: 'block_crafting_table',
    outputCount: 1,
    pattern: [
      ['block_planks', 'block_planks'],
      ['block_planks', 'block_planks'],
    ],
    category: 'building',
  },
  {
    id: 'torches',
    outputItemId: 'block_torch',
    outputCount: 4,
    pattern: [
      ['coal'],
      ['stick'],
    ],
    category: 'misc',
  },
  {
    id: 'sandstone',
    outputItemId: 'block_sandstone',
    outputCount: 1,
    pattern: [
      ['block_sand', 'block_sand'],
      ['block_sand', 'block_sand'],
    ],
    category: 'building',
  },
  {
    id: 'wool_from_none',
    outputItemId: 'block_brick',
    outputCount: 4,
    pattern: [
      ['block_stone', 'block_stone'],
      ['block_stone', 'block_stone'],
    ],
    category: 'building',
  },

  // 3x3 Utility Blocks
  {
    id: 'furnace',
    outputItemId: 'block_furnace',
    outputCount: 1,
    requiresTable: true,
    pattern: [
      ['block_cobblestone', 'block_cobblestone', 'block_cobblestone'],
      ['block_cobblestone', null, 'block_cobblestone'],
      ['block_cobblestone', 'block_cobblestone', 'block_cobblestone'],
    ],
    category: 'building',
  },

  // Tiered Tools (Wood, Stone, Iron, Diamond)
  ...(['wood', 'stone', 'iron', 'diamond'] as const).flatMap((tier): Recipe[] => {
    const mat =
      tier === 'wood'
        ? 'block_planks'
        : tier === 'stone'
          ? 'block_cobblestone'
          : tier === 'iron'
            ? 'iron_ingot'
            : 'diamond';
    return [
      {
        id: `${tier}_pickaxe`,
        outputItemId: `${tier}_pickaxe`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, mat, mat],
          [null, 'stick', null],
          [null, 'stick', null],
        ],
        category: 'tools',
      },
      {
        id: `${tier}_axe`,
        outputItemId: `${tier}_axe`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, mat],
          [mat, 'stick'],
          [null, 'stick'],
        ],
        category: 'tools',
      },
      {
        id: `${tier}_shovel`,
        outputItemId: `${tier}_shovel`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat],
          ['stick'],
          ['stick'],
        ],
        category: 'tools',
      },
      {
        id: `${tier}_sword`,
        outputItemId: `${tier}_sword`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat],
          [mat],
          ['stick'],
        ],
        category: 'combat',
      },
    ];
  }),

  // Bow & Arrow
  {
    id: 'bow',
    outputItemId: 'bow',
    outputCount: 1,
    requiresTable: true,
    pattern: [
      [null, 'stick', 'block_wool'],
      ['stick', null, 'block_wool'],
      [null, 'stick', 'block_wool'],
    ],
    category: 'combat',
  },
  {
    id: 'bow_wood_string',
    outputItemId: 'bow',
    outputCount: 1,
    requiresTable: true,
    pattern: [
      [null, 'stick', 'stick'],
      ['stick', null, 'feather'],
      [null, 'stick', 'stick'],
    ],
    category: 'combat',
  },
  {
    id: 'arrows',
    outputItemId: 'arrow',
    outputCount: 4,
    requiresTable: true,
    pattern: [
      ['block_cobblestone'],
      ['stick'],
      ['feather'],
    ],
    category: 'combat',
  },

  // Armor (Leather, Iron, Diamond)
  ...(['leather', 'iron', 'diamond'] as const).flatMap((tier): Recipe[] => {
    const mat = tier === 'leather' ? 'leather' : tier === 'iron' ? 'iron_ingot' : 'diamond';
    return [
      {
        id: `${tier}_helmet`,
        outputItemId: `${tier}_helmet`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, mat, mat],
          [mat, null, mat],
        ],
        category: 'armor',
      },
      {
        id: `${tier}_chestplate`,
        outputItemId: `${tier}_chestplate`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, null, mat],
          [mat, mat, mat],
          [mat, mat, mat],
        ],
        category: 'armor',
      },
      {
        id: `${tier}_leggings`,
        outputItemId: `${tier}_leggings`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, mat, mat],
          [mat, null, mat],
          [mat, null, mat],
        ],
        category: 'armor',
      },
      {
        id: `${tier}_boots`,
        outputItemId: `${tier}_boots`,
        outputCount: 1,
        requiresTable: true,
        pattern: [
          [mat, null, mat],
          [mat, null, mat],
        ],
        category: 'armor',
      },
    ];
  }),
];

/** Smelting map: input itemId -> output itemId */
export const SMELTING_RECIPES: Record<string, string> = {
  raw_iron: 'iron_ingot',
  block_iron_ore: 'iron_ingot',
  raw_gold: 'gold_ingot',
  block_gold_ore: 'gold_ingot',
  block_sand: 'block_glass',
  block_cobblestone: 'block_stone',
  raw_pork: 'cooked_pork',
  raw_beef: 'cooked_beef',
  raw_chicken: 'cooked_chicken',
  raw_mutton: 'cooked_mutton',
  block_oak_log: 'coal',
  block_birch_log: 'coal',
};

export function getFuelBurnTime(itemId: string): number {
  return ITEM_DEFS[itemId]?.fuelBurnSeconds ?? 0;
}

/** Trim empty outer rows/cols from a 2x2 or 3x3 crafting grid */
function trimGrid(grid: (InventorySlot | null)[][]): (string | null)[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) {
        minR = Math.min(minR, r);
        maxR = Math.max(maxR, r);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < minR) return [];
  const trimmed: (string | null)[][] = [];
  for (let r = minR; r <= maxR; r++) {
    const row: (string | null)[] = [];
    for (let c = minC; c <= maxC; c++) {
      row.push(grid[r][c]?.itemId ?? null);
    }
    trimmed.push(row);
  }
  return trimmed;
}

function matchShaped(trimmed: (string | null)[][], pattern: (string | null)[][]): boolean {
  if (trimmed.length !== pattern.length) return false;
  if (trimmed.length === 0) return false;
  if (trimmed[0].length !== pattern[0].length) return false;

  // Normal orientation
  let normalMatch = true;
  for (let r = 0; r < pattern.length && normalMatch; r++) {
    for (let c = 0; c < pattern[0].length; c++) {
      if (trimmed[r][c] !== pattern[r][c]) {
        normalMatch = false;
        break;
      }
    }
  }
  if (normalMatch) return true;

  // Horizontally mirrored (e.g., axe facing left or right)
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[0].length; c++) {
      if (trimmed[r][c] !== pattern[r][pattern[0].length - 1 - c]) {
        return false;
      }
    }
  }
  return true;
}

function matchShapeless(grid: (InventorySlot | null)[][], ingredients: string[]): boolean {
  const present: string[] = [];
  for (const row of grid) {
    for (const cell of row) {
      if (cell) present.push(cell.itemId);
    }
  }
  if (present.length !== ingredients.length) return false;
  const sortedA = [...present].sort();
  const sortedB = [...ingredients].sort();
  return sortedA.every((v, i) => v === sortedB[i]);
}

export function findMatchingRecipe(grid: (InventorySlot | null)[][], isTableOpen: boolean): Recipe | null {
  const trimmed = trimGrid(grid);
  if (trimmed.length === 0) return null;

  for (const recipe of RECIPES) {
    if (recipe.requiresTable && !isTableOpen) continue;
    if (recipe.shapeless && recipe.ingredients) {
      if (matchShapeless(grid, recipe.ingredients)) return recipe;
    } else if (recipe.pattern) {
      if (matchShaped(trimmed, recipe.pattern)) return recipe;
    }
  }
  return null;
}
