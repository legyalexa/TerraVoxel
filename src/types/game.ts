export type GameMode = 'survival' | 'creative';

export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  Sandstone = 6,
  Water = 7,
  OakLog = 8,
  OakLeaves = 9,
  BirchLog = 10,
  BirchLeaves = 11,
  Planks = 12,
  CraftingTable = 13,
  Furnace = 14,
  FurnaceLit = 15,
  Torch = 16,
  Glass = 17,
  CoalOre = 18,
  IronOre = 19,
  GoldOre = 20,
  DiamondOre = 21,
  Bedrock = 22,
  Snow = 23,
  Gravel = 24,
  Cactus = 25,
  Lava = 26,
  Glowstone = 27,
  Brick = 28,
  Wool = 29,
}

export type ToolCategory = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'bow' | 'none';
export type ToolTier = 0 | 1 | 2 | 3 | 4; // 0=hand, 1=wood, 2=stone, 3=iron, 4=diamond
export type ArmorSlotType = 'helmet' | 'chestplate' | 'leggings' | 'boots';
export type SoundMaterial = 'stone' | 'wood' | 'grass' | 'sand' | 'glass' | 'water' | 'snow';
export type BiomeType = 'forest' | 'plains' | 'desert' | 'mountains' | 'ocean';
export type MobType = 'pig' | 'cow' | 'sheep' | 'chicken' | 'zombie' | 'skeleton' | 'creeper' | 'spider';

export interface BlockDef {
  id: BlockId;
  name: string;
  solid: boolean;
  transparent: boolean;
  liquid: boolean;
  /** Non-full-cube decorative/light block like Torch */
  nonFullCube?: boolean;
  hardness: number; // seconds with bare hand; -1 = unbreakable
  preferredTool: ToolCategory;
  minTier: ToolTier;
  lightEmission: number; // 0..15
  lightOpacity: number; // 15 = completely blocks sky/block light, 0..3 = lets light pass
  sound: SoundMaterial;
  dropItemId: string | null;
  dropCount?: number;
  /** Atlas tile indices [right, left, top, bottom, front, back] */
  tiles: [number, number, number, number, number, number];
}

export interface ItemDef {
  id: string;
  name: string;
  category: 'block' | 'tool' | 'weapon' | 'armor' | 'material' | 'food';
  maxStack: number;
  placeBlockId?: BlockId;
  toolCategory?: ToolCategory;
  toolTier?: ToolTier;
  miningSpeed?: number;
  maxDurability?: number;
  attackDamage?: number;
  armorSlot?: ArmorSlotType;
  armorDefense?: number;
  hungerRestore?: number;
  saturationRestore?: number;
  fuelBurnSeconds?: number;
  color: string;
  accentColor?: string;
}

export interface InventorySlot {
  itemId: string;
  count: number;
  durability?: number;
}

export interface FurnaceState {
  key: string;
  x: number;
  y: number;
  z: number;
  input: InventorySlot | null;
  fuel: InventorySlot | null;
  output: InventorySlot | null;
  burnTime: number;
  maxBurnTime: number;
  cookProgress: number;
  cookTime: number;
}

export interface Recipe {
  id: string;
  outputItemId: string;
  outputCount: number;
  shapeless?: boolean;
  /** For shaped recipes: rows of itemIds or null */
  pattern?: (string | null)[][];
  /** For shapeless recipes: list of required itemIds */
  ingredients?: string[];
  requiresTable?: boolean;
  category: 'building' | 'tools' | 'armor' | 'combat' | 'misc';
}

export interface MobDrop {
  itemId: string;
  min: number;
  max: number;
  chance: number;
}

export interface WorldMetadata {
  id: string;
  name: string;
  seed: number;
  mode: GameMode;
  createdAt: number;
  updatedAt: number;
  dayCount: number;
  timeOfDay: number; // 0..1200 seconds
}

export interface SerializedChunk {
  cx: number;
  cz: number;
  /** Run-length encoded [blockId, count, ...] */
  rle: number[];
}

export interface WorldSaveData {
  meta: WorldMetadata;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    health: number;
    hunger: number;
    saturation: number;
    oxygen: number;
    isFlying: boolean;
    activeSlot: number;
    hotbar: (InventorySlot | null)[];
    inventory: (InventorySlot | null)[];
    armor: (InventorySlot | null)[];
  };
  modifiedChunks: SerializedChunk[];
  furnaces: FurnaceState[];
}

export type ActiveModal = 'none' | 'inventory' | 'crafting' | 'furnace' | 'pause' | 'dead';

export interface HudSnapshot {
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  armorDefense: number;
  oxygen: number;
  maxOxygen: number;
  mode: GameMode;
  isFlying: boolean;
  isCrouching: boolean;
  activeSlot: number;
  hotbar: (InventorySlot | null)[];
  inventory: (InventorySlot | null)[];
  armor: (InventorySlot | null)[];
  heldItemName: string;
  timeOfDay: number;
  dayCount: number;
  biome: BiomeType;
  coords: { x: number; y: number; z: number };
  fps: number;
  attackCooldown: number; // 0..1 (1 = ready)
  breakProgress: number; // 0..1
  bowCharge: number; // 0..1
  isUnderwater: boolean;
  damageFlash: number; // 0..1
  activeModal: ActiveModal;
  openFurnace: FurnaceState | null;
  pointerLocked: boolean;
  showDebug: boolean;
  targetBlockName: string | null;
  targetEntityName: string | null;
  saveStatusText: string | null;
  roomCode: string | null;
  isHost: boolean;
  onlinePlayers: { id: string; name: string; color: string }[];
  chatOpen: boolean;
  chatMessages: { id: string; sender: string; color: string; text: string; timestamp: number }[];
}
