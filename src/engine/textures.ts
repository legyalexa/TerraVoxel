import * as THREE from 'three';
import { BlockId } from '../types/game';
import { BLOCK_DEFS, ITEM_DEFS, TILE } from './constants';

export const ATLAS_GRID = 8; // 8x8 tiles
export const TILE_PX = 16;   // 16x16 pixels per tile
export const ATLAS_PX = ATLAS_GRID * TILE_PX; // 128x128

function rng2D(x: number, y: number, seed: number): number {
  let n = Math.imul(x * 374761393 + y * 668265263 + seed * 1442695041, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967296;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgb(r: number, g: number, b: number, a = 255): string {
  return `rgba(${clampByte(r)},${clampByte(g)},${clampByte(b)},${a / 255})`;
}

function fillNoiseTile(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  base: [number, number, number],
  variance: number,
  seed: number,
  alpha = 255,
) {
  const ox = tx * TILE_PX;
  const oy = ty * TILE_PX;
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const n = (rng2D(x, y, seed) - 0.5) * 2 * variance;
      ctx.fillStyle = rgb(base[0] + n, base[1] + n, base[2] + n, alpha);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

function paintTileAt(ctx: CanvasRenderingContext2D, tileIndex: number, painter: (ox: number, oy: number) => void) {
  const tx = tileIndex % ATLAS_GRID;
  const ty = Math.floor(tileIndex / ATLAS_GRID);
  painter(tx * TILE_PX, ty * TILE_PX);
}

let cachedAtlasCanvas: HTMLCanvasElement | null = null;

export function buildAtlasCanvas(): HTMLCanvasElement {
  if (cachedAtlasCanvas) return cachedAtlasCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_PX;
  canvas.height = ATLAS_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ATLAS_PX, ATLAS_PX);

  const paintNoise = (idx: number, base: [number, number, number], variance: number, seed: number, alpha = 255) => {
    const tx = idx % ATLAS_GRID;
    const ty = Math.floor(idx / ATLAS_GRID);
    fillNoiseTile(ctx, tx, ty, base, variance, seed, alpha);
  };

  // Grass top
  paintNoise(TILE.GRASS_TOP, [92, 158, 62], 18, 101);
  // Dirt
  paintNoise(TILE.DIRT, [126, 87, 56], 16, 102);
  // Grass side
  paintNoise(TILE.GRASS_SIDE, [126, 87, 56], 15, 103);
  paintTileAt(ctx, TILE.GRASS_SIDE, (ox, oy) => {
    for (let x = 0; x < 16; x++) {
      const overhang = 3 + Math.floor(rng2D(x, 0, 104) * 3);
      for (let y = 0; y < overhang; y++) {
        const n = (rng2D(x, y, 105) - 0.5) * 24;
        ctx.fillStyle = rgb(88 + n, 152 + n, 58 + n);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  });

  // Stone
  paintNoise(TILE.STONE, [126, 130, 135], 16, 106);
  // Cobblestone
  paintNoise(TILE.COBBLESTONE, [108, 112, 118], 18, 107);
  paintTileAt(ctx, TILE.COBBLESTONE, (ox, oy) => {
    ctx.fillStyle = 'rgba(40,42,46,0.45)';
    for (let y = 0; y < 16; y += 4) ctx.fillRect(ox, oy + y, 16, 1);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let x = off; x < 16; x += 8) ctx.fillRect(ox + x, oy + row * 4, 1, 4);
    }
  });

  // Sand
  paintNoise(TILE.SAND, [222, 204, 146], 14, 108);
  // Sandstone top & side
  paintNoise(TILE.SANDSTONE_TOP, [212, 190, 130], 10, 109);
  paintNoise(TILE.SANDSTONE_SIDE, [212, 190, 130], 10, 110);
  paintTileAt(ctx, TILE.SANDSTONE_SIDE, (ox, oy) => {
    ctx.fillStyle = 'rgba(165, 140, 82, 0.35)';
    ctx.fillRect(ox, oy + 4, 16, 1);
    ctx.fillRect(ox, oy + 10, 16, 1);
  });

  // Water
  paintNoise(TILE.WATER, [46, 124, 214], 12, 111, 210);
  paintTileAt(ctx, TILE.WATER, (ox, oy) => {
    ctx.fillStyle = 'rgba(165, 215, 255, 0.28)';
    ctx.fillRect(ox + 2, oy + 4, 5, 1);
    ctx.fillRect(ox + 9, oy + 11, 5, 1);
  });

  // Oak Log top & side
  paintNoise(TILE.OAK_LOG_TOP, [178, 138, 86], 10, 112);
  paintTileAt(ctx, TILE.OAK_LOG_TOP, (ox, oy) => {
    ctx.strokeStyle = '#6b4b2b';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
    ctx.strokeStyle = '#9c7344';
    ctx.strokeRect(ox + 3.5, oy + 3.5, 9, 9);
  });
  paintNoise(TILE.OAK_LOG_SIDE, [104, 74, 45], 12, 113);
  paintTileAt(ctx, TILE.OAK_LOG_SIDE, (ox, oy) => {
    for (let x = 1; x < 16; x += 3) {
      ctx.fillStyle = 'rgba(55, 36, 18, 0.45)';
      ctx.fillRect(ox + x, oy, 1, 16);
    }
  });

  // Oak Leaves
  paintNoise(TILE.OAK_LEAVES, [58, 116, 40], 24, 114);
  paintTileAt(ctx, TILE.OAK_LEAVES, (ox, oy) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (rng2D(x, y, 115) < 0.22) {
          ctx.fillStyle = 'rgba(30, 65, 22, 0.85)';
          ctx.fillRect(ox + x, oy + y, 1, 1);
        }
      }
    }
  });

  // Birch Log top & side
  paintNoise(TILE.BIRCH_LOG_TOP, [208, 184, 136], 8, 116);
  paintTileAt(ctx, TILE.BIRCH_LOG_TOP, (ox, oy) => {
    ctx.strokeStyle = '#d8d5cc';
    ctx.strokeRect(ox + 0.5, oy + 0.5, 15, 15);
  });
  paintNoise(TILE.BIRCH_LOG_SIDE, [224, 221, 212], 8, 117);
  paintTileAt(ctx, TILE.BIRCH_LOG_SIDE, (ox, oy) => {
    const spots = [[2, 3, 4], [9, 6, 5], [4, 11, 3], [11, 13, 4], [1, 8, 3]];
    ctx.fillStyle = '#3d3f42';
    for (const [sx, sy, w] of spots) ctx.fillRect(ox + sx, oy + sy, w, 2);
  });

  // Birch Leaves
  paintNoise(TILE.BIRCH_LEAVES, [84, 142, 62], 22, 118);

  // Planks
  paintNoise(TILE.PLANKS, [182, 138, 84], 10, 119);
  paintTileAt(ctx, TILE.PLANKS, (ox, oy) => {
    ctx.fillStyle = 'rgba(98, 68, 34, 0.55)';
    for (let y = 0; y < 16; y += 4) ctx.fillRect(ox, oy + y, 16, 1);
    ctx.fillRect(ox + 7, oy, 1, 4);
    ctx.fillRect(ox + 13, oy + 4, 1, 4);
    ctx.fillRect(ox + 4, oy + 8, 1, 4);
    ctx.fillRect(ox + 10, oy + 12, 1, 4);
  });

  // Crafting Table
  paintNoise(TILE.CRAFTING_TOP, [172, 128, 76], 8, 120);
  paintTileAt(ctx, TILE.CRAFTING_TOP, (ox, oy) => {
    ctx.fillStyle = '#4e3318';
    ctx.fillRect(ox, oy, 16, 1);
    ctx.fillRect(ox, oy + 15, 16, 1);
    ctx.fillRect(ox, oy, 1, 16);
    ctx.fillRect(ox + 15, oy, 1, 16);
    for (let i = 5; i <= 10; i += 5) {
      ctx.fillRect(ox + i, oy + 2, 1, 12);
      ctx.fillRect(ox + 2, oy + i, 12, 1);
    }
  });
  paintNoise(TILE.CRAFTING_SIDE, [156, 110, 62], 10, 121);
  paintTileAt(ctx, TILE.CRAFTING_SIDE, (ox, oy) => {
    ctx.fillStyle = '#4e3318';
    ctx.fillRect(ox + 2, oy + 2, 12, 2);
    ctx.fillStyle = '#8b939c';
    ctx.fillRect(ox + 4, oy + 6, 2, 6);
    ctx.fillRect(ox + 10, oy + 6, 3, 3);
    ctx.fillStyle = '#694624';
    ctx.fillRect(ox + 11, oy + 9, 1, 4);
  });

  // Furnace
  paintNoise(TILE.FURNACE_TOP, [110, 114, 120], 14, 122);
  paintNoise(TILE.FURNACE_SIDE, [110, 114, 120], 14, 123);
  paintTileAt(ctx, TILE.FURNACE_SIDE, (ox, oy) => {
    ctx.fillStyle = 'rgba(40,42,46,0.5)';
    ctx.fillRect(ox, oy, 16, 2);
    ctx.fillRect(ox, oy + 14, 16, 2);
  });
  paintNoise(TILE.FURNACE_FRONT, [110, 114, 120], 14, 124);
  paintTileAt(ctx, TILE.FURNACE_FRONT, (ox, oy) => {
    ctx.fillStyle = '#242629';
    ctx.fillRect(ox + 3, oy + 3, 10, 4);
    ctx.fillRect(ox + 4, oy + 10, 8, 5);
  });
  paintNoise(TILE.FURNACE_FRONT_LIT, [110, 114, 120], 14, 125);
  paintTileAt(ctx, TILE.FURNACE_FRONT_LIT, (ox, oy) => {
    ctx.fillStyle = '#242629';
    ctx.fillRect(ox + 3, oy + 3, 10, 4);
    ctx.fillStyle = '#ff7b1c';
    ctx.fillRect(ox + 4, oy + 10, 8, 5);
    ctx.fillStyle = '#ffd54f';
    ctx.fillRect(ox + 6, oy + 11, 4, 3);
  });

  // Torch
  paintNoise(TILE.TORCH, [112, 76, 40], 10, 126);
  paintTileAt(ctx, TILE.TORCH, (ox, oy) => {
    ctx.fillStyle = '#ff981a';
    ctx.fillRect(ox, oy, 16, 5);
    ctx.fillStyle = '#fff080';
    ctx.fillRect(ox + 3, oy + 1, 10, 3);
  });

  // Glass
  paintTileAt(ctx, TILE.GLASS, (ox, oy) => {
    ctx.fillStyle = 'rgba(185, 232, 248, 0.25)';
    ctx.fillRect(ox, oy, 16, 16);
    ctx.fillStyle = 'rgba(225, 248, 255, 0.85)';
    ctx.fillRect(ox, oy, 16, 1);
    ctx.fillRect(ox, oy + 15, 16, 1);
    ctx.fillRect(ox, oy, 1, 16);
    ctx.fillRect(ox + 15, oy, 1, 16);
    ctx.fillRect(ox + 3, oy + 3, 3, 1);
    ctx.fillRect(ox + 3, oy + 4, 1, 2);
    ctx.fillRect(ox + 10, oy + 11, 2, 1);
  });

  // Ores
  const paintOre = (tileIdx: number, color: string, hi: string, seed: number) => {
    paintNoise(tileIdx, [122, 126, 132], 15, seed);
    paintTileAt(ctx, tileIdx, (ox, oy) => {
      const flecks = [[3, 3], [10, 2], [6, 7], [12, 8], [3, 11], [9, 12], [13, 13]];
      for (const [fx, fy] of flecks) {
        ctx.fillStyle = color;
        ctx.fillRect(ox + fx, oy + fy, 2, 2);
        ctx.fillStyle = hi;
        ctx.fillRect(ox + fx, oy + fy, 1, 1);
      }
    });
  };
  paintOre(TILE.COAL_ORE, '#1f2124', '#383b40', 130);
  paintOre(TILE.IRON_ORE, '#c99c7b', '#e8c4aa', 131);
  paintOre(TILE.GOLD_ORE, '#f0bf24', '#ffea7a', 132);
  paintOre(TILE.DIAMOND_ORE, '#32ded8', '#a3fffb', 133);

  // Bedrock
  paintNoise(TILE.BEDROCK, [48, 50, 54], 24, 134);
  // Snow
  paintNoise(TILE.SNOW, [238, 245, 250], 8, 135);
  // Gravel
  paintNoise(TILE.GRAVEL, [132, 128, 126], 22, 136);

  // Cactus
  paintNoise(TILE.CACTUS_TOP, [66, 136, 48], 12, 137);
  paintNoise(TILE.CACTUS_SIDE, [58, 124, 42], 12, 138);
  paintTileAt(ctx, TILE.CACTUS_SIDE, (ox, oy) => {
    ctx.fillStyle = '#2d6320';
    ctx.fillRect(ox + 3, oy, 1, 16);
    ctx.fillRect(ox + 8, oy, 1, 16);
    ctx.fillRect(ox + 13, oy, 1, 16);
    ctx.fillStyle = '#d4e8b5';
    ctx.fillRect(ox + 2, oy + 4, 1, 1);
    ctx.fillRect(ox + 7, oy + 10, 1, 1);
    ctx.fillRect(ox + 12, oy + 6, 1, 1);
  });

  // Lava
  paintNoise(TILE.LAVA, [242, 92, 18], 26, 139);
  paintTileAt(ctx, TILE.LAVA, (ox, oy) => {
    ctx.fillStyle = '#ffdc42';
    ctx.fillRect(ox + 3, oy + 3, 4, 2);
    ctx.fillRect(ox + 9, oy + 10, 5, 2);
  });

  // Glowstone
  paintNoise(TILE.GLOWSTONE, [242, 196, 84], 26, 140);

  // Brick
  paintNoise(TILE.BRICK, [156, 76, 62], 14, 141);
  paintTileAt(ctx, TILE.BRICK, (ox, oy) => {
    ctx.fillStyle = '#cfc9be';
    for (let y = 0; y < 16; y += 4) ctx.fillRect(ox, oy + y, 16, 1);
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let x = off; x < 16; x += 8) ctx.fillRect(ox + x, oy + row * 4, 1, 4);
    }
  });

  // Wool
  paintNoise(TILE.WOOL, [235, 237, 240], 9, 142);

  cachedAtlasCanvas = canvas;
  return canvas;
}

export function createAtlasTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const canvas = buildAtlasCanvas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

/** Generate 10 progressive pixel-art fracture overlay textures for block breaking animation */
export function createBreakStageTextures(): THREE.CanvasTexture[] {
  const textures: THREE.CanvasTexture[] = [];
  const branches: [number, number][][] = [
    [[8, 8], [7, 7], [9, 8]],
    [[7, 7], [6, 5], [10, 9]],
    [[6, 5], [4, 4], [10, 9], [12, 11]],
    [[8, 8], [9, 5], [11, 4], [6, 10], [4, 12]],
    [[4, 4], [2, 2], [12, 11], [14, 13], [5, 7], [3, 8]],
    [[11, 4], [13, 2], [4, 12], [2, 14], [10, 7], [13, 8]],
    [[7, 7], [7, 3], [8, 2], [8, 11], [8, 14], [5, 10]],
    [[3, 8], [1, 7], [13, 8], [15, 9], [6, 3], [11, 13]],
    [[2, 2], [1, 4], [14, 13], [12, 15], [13, 2], [15, 5], [2, 14], [5, 15]],
    [[4, 4], [5, 5], [10, 10], [11, 11], [4, 11], [11, 4], [7, 1], [1, 9], [14, 10]],
  ];

  for (let stage = 0; stage < 10; stage++) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, 16, 16);

    for (let s = 0; s <= stage; s++) {
      for (const [px, py] of branches[s]) {
        ctx.fillStyle = s === stage ? 'rgba(10, 14, 22, 0.85)' : 'rgba(8, 10, 16, 0.78)';
        ctx.fillRect(px, py, 1, 1);
        if (stage >= 5 && px + 1 < 16) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.fillRect(px + 1, py, 1, 1);
        }
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    textures.push(tex);
  }
  return textures;
}

const iconCache = new Map<string, string>();

function drawTileSlice(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLCanvasElement,
  tileIndex: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const tx = tileIndex % ATLAS_GRID;
  const ty = Math.floor(tileIndex / ATLAS_GRID);
  ctx.drawImage(atlas, tx * TILE_PX, ty * TILE_PX, TILE_PX, TILE_PX, dx, dy, dw, dh);
}

/** Generate crisp 32x32 voxel item/block icons for HUD and Inventory */
export function getItemIconUrl(itemId: string): string {
  const existing = iconCache.get(itemId);
  if (existing) return existing;

  const def = ITEM_DEFS[itemId];
  const atlas = buildAtlasCanvas();
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  if (!def) {
    const url = c.toDataURL();
    iconCache.set(itemId, url);
    return url;
  }

  if (def.placeBlockId !== undefined) {
    const bdef = BLOCK_DEFS[def.placeBlockId];
    if (def.placeBlockId === BlockId.Torch) {
      ctx.fillStyle = '#6b4a26';
      ctx.fillRect(14, 12, 4, 17);
      ctx.fillStyle = '#ff981a';
      ctx.fillRect(13, 6, 6, 7);
      ctx.fillStyle = '#fff080';
      ctx.fillRect(14, 7, 4, 4);
    } else {
      // Isometric cube preview using top, left(front), right tiles
      const topTile = bdef.tiles[2];
      const leftTile = bdef.tiles[4];
      const rightTile = bdef.tiles[0];

      // Top diamond
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(16, 3);
      ctx.lineTo(29, 9.5);
      ctx.lineTo(16, 16);
      ctx.lineTo(3, 9.5);
      ctx.closePath();
      ctx.clip();
      ctx.transform(0.8125, 0.40625, -0.8125, 0.40625, 16, 3);
      drawTileSlice(ctx, atlas, topTile, 0, 0, 16, 16);
      ctx.restore();

      // Left face
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(3, 9.5);
      ctx.lineTo(16, 16);
      ctx.lineTo(16, 29.5);
      ctx.lineTo(3, 23);
      ctx.closePath();
      ctx.clip();
      ctx.transform(0.8125, 0.40625, 0, 0.84375, 3, 9.5);
      drawTileSlice(ctx, atlas, leftTile, 0, 0, 16, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();

      // Right face
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(16, 16);
      ctx.lineTo(29, 9.5);
      ctx.lineTo(29, 23);
      ctx.lineTo(16, 29.5);
      ctx.closePath();
      ctx.clip();
      ctx.transform(0.8125, -0.40625, 0, 0.84375, 16, 16);
      drawTileSlice(ctx, atlas, rightTile, 0, 0, 16, 16);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, 0, 16, 16);
      ctx.restore();
    }
  } else {
    const col = def.color;
    const acc = def.accentColor ?? '#7a5832';
    if (def.toolCategory === 'pickaxe') {
      ctx.fillStyle = acc;
      for (let i = 0; i < 14; i++) ctx.fillRect(6 + i, 24 - i, 2, 2);
      ctx.fillStyle = col;
      ctx.fillRect(10, 5, 14, 3);
      ctx.fillRect(21, 7, 3, 10);
      ctx.fillRect(7, 7, 4, 3);
      ctx.fillRect(23, 16, 2, 4);
    } else if (def.toolCategory === 'axe') {
      ctx.fillStyle = acc;
      for (let i = 0; i < 14; i++) ctx.fillRect(6 + i, 24 - i, 2, 2);
      ctx.fillStyle = col;
      ctx.fillRect(14, 5, 11, 4);
      ctx.fillRect(18, 9, 8, 6);
      ctx.fillRect(15, 9, 3, 4);
    } else if (def.toolCategory === 'shovel') {
      ctx.fillStyle = acc;
      for (let i = 0; i < 14; i++) ctx.fillRect(6 + i, 24 - i, 2, 2);
      ctx.fillStyle = col;
      ctx.fillRect(18, 5, 8, 8);
      ctx.fillRect(21, 3, 5, 5);
    } else if (def.toolCategory === 'sword') {
      ctx.fillStyle = acc;
      ctx.fillRect(5, 23, 4, 4);
      ctx.fillRect(8, 20, 3, 3);
      ctx.fillRect(7, 16, 3, 3);
      ctx.fillRect(11, 20, 3, 3);
      ctx.fillStyle = col;
      for (let i = 0; i < 13; i++) ctx.fillRect(11 + i, 18 - i, 3, 3);
    } else if (def.toolCategory === 'bow') {
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(13, 16, 11, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.stroke();
      ctx.strokeStyle = acc;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(15, 5);
      ctx.lineTo(15, 27);
      ctx.stroke();
    } else if (def.id === 'arrow') {
      ctx.fillStyle = col;
      for (let i = 0; i < 14; i++) ctx.fillRect(7 + i, 22 - i, 2, 2);
      ctx.fillStyle = acc;
      ctx.fillRect(20, 6, 6, 6);
      ctx.fillStyle = '#e8ecf2';
      ctx.fillRect(5, 21, 4, 4);
    } else if (def.armorSlot === 'helmet') {
      ctx.fillStyle = col;
      ctx.fillRect(7, 8, 18, 14);
      ctx.fillRect(10, 6, 12, 3);
      ctx.clearRect(11, 16, 10, 6);
    } else if (def.armorSlot === 'chestplate') {
      ctx.fillStyle = col;
      ctx.fillRect(5, 7, 22, 7);
      ctx.fillRect(9, 10, 14, 16);
      ctx.clearRect(13, 7, 6, 4);
    } else if (def.armorSlot === 'leggings') {
      ctx.fillStyle = col;
      ctx.fillRect(8, 6, 16, 7);
      ctx.fillRect(8, 13, 6, 14);
      ctx.fillRect(18, 13, 6, 14);
    } else if (def.armorSlot === 'boots') {
      ctx.fillStyle = col;
      ctx.fillRect(6, 10, 7, 14);
      ctx.fillRect(6, 20, 10, 4);
      ctx.fillRect(19, 10, 7, 14);
      ctx.fillRect(16, 20, 10, 4);
    } else if (def.id === 'stick') {
      ctx.fillStyle = col;
      for (let i = 0; i < 16; i++) ctx.fillRect(7 + i, 23 - i, 3, 3);
    } else if (def.id === 'coal') {
      ctx.fillStyle = col;
      ctx.fillRect(8, 9, 16, 14);
      ctx.fillRect(10, 6, 12, 19);
      ctx.fillStyle = '#474b52';
      ctx.fillRect(11, 10, 4, 4);
    } else if (def.id === 'diamond') {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(16, 4);
      ctx.lineTo(27, 14);
      ctx.lineTo(16, 28);
      ctx.lineTo(5, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#bffffd';
      ctx.fillRect(12, 10, 4, 6);
    } else if (def.id === 'iron_ingot' || def.id === 'gold_ingot') {
      ctx.fillStyle = col;
      ctx.fillRect(6, 11, 20, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(8, 12, 14, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(6, 19, 20, 2);
    } else if (def.id === 'apple') {
      ctx.fillStyle = col;
      ctx.fillRect(8, 10, 16, 15);
      ctx.fillRect(10, 8, 12, 18);
      ctx.fillStyle = '#6b4a26';
      ctx.fillRect(15, 4, 2, 5);
      ctx.fillStyle = '#4f9e36';
      ctx.fillRect(17, 5, 5, 3);
    } else {
      // Raw ore, meat, bone, feather, gunpowder, leather
      ctx.fillStyle = col;
      ctx.fillRect(8, 9, 16, 14);
      ctx.fillRect(10, 7, 12, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(10, 10, 5, 4);
    }
  }

  const url = c.toDataURL();
  iconCache.set(itemId, url);
  return url;
}
