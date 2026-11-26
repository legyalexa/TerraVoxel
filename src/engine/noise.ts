import { BiomeType, BlockId } from '../types/game';
import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL } from './constants';

/** Fast deterministic seeded PRNG (Mulberry32) */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer hash for chunk/voxel coordinates */
export function hash3D(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1597334677) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const F3 = 1 / 3;
const G3 = 1 / 6;

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

export class SimplexNoise {
  private perm: Uint8Array;
  private permMod12: Uint8Array;

  constructor(seed: number) {
    const rng = createRng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    this.perm = new Uint8Array(512);
    this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod12[i] = this.perm[i] % 12;
    }
  }

  noise2D(xin: number, yin: number): number {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    let i1 = 0, j1 = 0;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      const gi0 = this.permMod12[ii + this.perm[jj]];
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0);
    }

    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]];
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1);
    }

    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]];
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  }

  noise3D(xin: number, yin: number, zin: number): number {
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;
    const z0 = zin - Z0;

    let i1 = 0, j1 = 0, k1 = 0;
    let i2 = 0, j2 = 0, k2 = 0;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
      } else {
        i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
      }
    } else {
      if (y0 < z0) {
        i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
      } else if (x0 < z0) {
        i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
      } else {
        i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
      }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi0 = this.permMod12[ii + this.perm[jj + this.perm[kk]]];
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0 + GRAD3[gi0][2] * z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]];
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1 + GRAD3[gi1][2] * z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi2 = this.permMod12[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]];
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2 + GRAD3[gi2][2] * z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi3 = this.permMod12[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]];
      t3 *= t3;
      n3 = t3 * t3 * (GRAD3[gi3][0] * x3 + GRAD3[gi3][1] * y3 + GRAD3[gi3][2] * z3);
    }

    return 32 * (n0 + n1 + n2 + n3);
  }

  fbm2D(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2D(x * freq, y * freq) * amp;
      maxAmp += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / maxAmp;
  }
}

export class TerrainGenerator {
  readonly seed: number;
  private continentNoise: SimplexNoise;
  private elevationNoise: SimplexNoise;
  private tempNoise: SimplexNoise;
  private moistureNoise: SimplexNoise;
  private detailNoise: SimplexNoise;
  private caveNoiseA: SimplexNoise;
  private caveNoiseB: SimplexNoise;

  constructor(seed: number) {
    this.seed = seed | 0;
    this.continentNoise = new SimplexNoise(this.seed + 11);
    this.elevationNoise = new SimplexNoise(this.seed + 29);
    this.tempNoise = new SimplexNoise(this.seed + 53);
    this.moistureNoise = new SimplexNoise(this.seed + 97);
    this.detailNoise = new SimplexNoise(this.seed + 131);
    this.caveNoiseA = new SimplexNoise(this.seed + 197);
    this.caveNoiseB = new SimplexNoise(this.seed + 251);
  }

  getBiomeAt(wx: number, wz: number): BiomeType {
    const cont = this.continentNoise.fbm2D(wx * 0.0028, wz * 0.0028, 3);
    if (cont < -0.22) return 'ocean';

    const ridge = this.elevationNoise.fbm2D(wx * 0.0045, wz * 0.0045, 4);
    if (cont > 0.25 || ridge > 0.36) return 'mountains';

    const temp = this.tempNoise.fbm2D(wx * 0.0032, wz * 0.0032, 3);
    const moist = this.moistureNoise.fbm2D(wx * 0.0032, wz * 0.0032, 3);

    if (temp > 0.2 && moist < 0.05) return 'desert';
    if (moist > 0.02) return 'forest';
    return 'plains';
  }

  getHeightAt(wx: number, wz: number): { height: number; biome: BiomeType } {
    const biome = this.getBiomeAt(wx, wz);
    const base = this.continentNoise.fbm2D(wx * 0.003, wz * 0.003, 3);
    const detail = this.detailNoise.fbm2D(wx * 0.014, wz * 0.014, 4);
    const ridgeRaw = this.elevationNoise.fbm2D(wx * 0.007, wz * 0.007, 4);
    const ridge = 1 - Math.abs(ridgeRaw);

    let h = SEA_LEVEL + 4;
    if (biome === 'ocean') {
      h = SEA_LEVEL - 14 + base * 16 + detail * 4;
    } else if (biome === 'plains') {
      h = SEA_LEVEL + 3 + detail * 6 + base * 5;
    } else if (biome === 'forest') {
      h = SEA_LEVEL + 6 + detail * 9 + base * 8;
    } else if (biome === 'desert') {
      h = SEA_LEVEL + 4 + detail * 7 + base * 4;
    } else if (biome === 'mountains') {
      h = SEA_LEVEL + 18 + ridge * ridge * 46 + detail * 12;
    }

    const clamped = Math.max(8, Math.min(CHUNK_HEIGHT - 30, Math.round(h)));
    return { height: clamped, biome };
  }

  generateChunkBlocks(cx: number, cz: number): Uint8Array {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const wx0 = cx * CHUNK_SIZE;
    const wz0 = cz * CHUNK_SIZE;

    const heights = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes: BiomeType[] = new Array(CHUNK_SIZE * CHUNK_SIZE);

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const { height, biome } = this.getHeightAt(wx0 + lx, wz0 + lz);
        const colIdx = lx + lz * CHUNK_SIZE;
        heights[colIdx] = height;
        biomes[colIdx] = biome;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
          if (y === 0) {
            blocks[idx] = BlockId.Bedrock;
            continue;
          }
          if (y <= 3 && hash3D(wx0 + lx, y, wz0 + lz, this.seed) < (4 - y) * 0.28) {
            blocks[idx] = BlockId.Bedrock;
            continue;
          }

          if (y <= height) {
            // Check 3D worm/swiss-cheese caves between y=5 and surface-2
            if (y >= 5 && y <= height - 2) {
              const wx = wx0 + lx;
              const wz = wz0 + lz;
              const c1 = this.caveNoiseA.noise3D(wx * 0.036, y * 0.048, wz * 0.036);
              const c2 = this.caveNoiseB.noise3D(wx * 0.042, y * 0.052, wz * 0.042);
              const caveDensity = c1 * c1 + c2 * c2;
              if (caveDensity < 0.022 && (y < height - 5 || caveDensity < 0.012)) {
                blocks[idx] = y <= 9 ? BlockId.Lava : BlockId.Air;
                continue;
              }
            }

            if (y === height) {
              if (y < SEA_LEVEL + 1 && biome !== 'mountains') {
                blocks[idx] = biome === 'ocean' && hash3D(wx0 + lx, y, wz0 + lz, this.seed + 7) < 0.25 ? BlockId.Gravel : BlockId.Sand;
              } else if (biome === 'desert') {
                blocks[idx] = BlockId.Sand;
              } else if (biome === 'mountains') {
                if (y >= 98) blocks[idx] = BlockId.Snow;
                else if (y >= 84) blocks[idx] = BlockId.Stone;
                else blocks[idx] = BlockId.Grass;
              } else {
                blocks[idx] = BlockId.Grass;
              }
            } else if (y >= height - 3) {
              if (biome === 'desert') {
                blocks[idx] = BlockId.Sandstone;
              } else if (biome === 'ocean' || y < SEA_LEVEL) {
                blocks[idx] = BlockId.Sand;
              } else if (biome === 'mountains' && y >= 82) {
                blocks[idx] = BlockId.Stone;
              } else {
                blocks[idx] = BlockId.Dirt;
              }
            } else {
              // Deep stone + procedural ore veins
              const wx = wx0 + lx;
              const wz = wz0 + lz;
              const hOre = hash3D(wx, y, wz, this.seed + 701);
              let block = BlockId.Stone;
              if (y <= 18 && hOre < 0.0045) {
                block = BlockId.DiamondOre;
              } else if (y <= 34 && hOre < 0.011) {
                block = BlockId.GoldOre;
              } else if (y <= 68 && hOre < 0.024) {
                block = BlockId.IronOre;
              } else if (y <= 105 && hOre < 0.042) {
                block = BlockId.CoalOre;
              } else if (y <= 55 && hOre > 0.985) {
                block = BlockId.Gravel;
              }
              blocks[idx] = block;
            }
          } else if (y <= SEA_LEVEL) {
            blocks[idx] = BlockId.Water;
          }
        }
      }
    }

    // Place deterministic trees & cacti safely inside chunk interior (margin 2)
    for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
      for (let lz = 2; lz < CHUNK_SIZE - 2; lz++) {
        const colIdx = lx + lz * CHUNK_SIZE;
        const h = heights[colIdx];
        const biome = biomes[colIdx];
        if (h <= SEA_LEVEL + 1) continue;

        const topIdx = (h * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
        const topBlock = blocks[topIdx];
        const r = hash3D(wx0 + lx, h, wz0 + lz, this.seed + 999);

        if (biome === 'desert' && topBlock === BlockId.Sand && r < 0.012) {
          const cHeight = 2 + Math.floor(hash3D(wx0 + lx, h + 1, wz0 + lz, this.seed) * 3);
          for (let cy = 1; cy <= cHeight; cy++) {
            const idx = ((h + cy) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
            blocks[idx] = BlockId.Cactus;
          }
        } else if (
          (biome === 'forest' && r < 0.034) ||
          (biome === 'plains' && r < 0.0055) ||
          (biome === 'mountains' && h < 82 && r < 0.008)
        ) {
          if (topBlock !== BlockId.Grass) continue;
          const isBirch = hash3D(wx0 + lx, h + 3, wz0 + lz, this.seed + 42) < 0.35;
          const logId = isBirch ? BlockId.BirchLog : BlockId.OakLog;
          const leafId = isBirch ? BlockId.BirchLeaves : BlockId.OakLeaves;
          const trunkH = 4 + Math.floor(hash3D(wx0 + lx, h + 5, wz0 + lz, this.seed + 77) * 3);

          for (let ty = 1; ty <= trunkH; ty++) {
            const idx = ((h + ty) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
            blocks[idx] = logId;
          }

          // Canopy
          for (let dy = trunkH - 2; dy <= trunkH + 1; dy++) {
            const radius = dy >= trunkH ? 1 : 2;
            for (let dx = -radius; dx <= radius; dx++) {
              for (let dz = -radius; dz <= radius; dz++) {
                if (dx === 0 && dz === 0 && dy <= trunkH) continue;
                if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy === trunkH - 1) continue;
                const nx = lx + dx;
                const nz = lz + dz;
                const ny = h + dy;
                if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && ny < CHUNK_HEIGHT) {
                  const lIdx = (ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
                  if (blocks[lIdx] === BlockId.Air) {
                    blocks[lIdx] = leafId;
                  }
                }
              }
            }
          }
        }
      }
    }

    return blocks;
  }
}
