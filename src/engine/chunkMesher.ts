import * as THREE from 'three';
import { BlockId } from '../types/game';
import { BLOCK_DEFS, CHUNK_HEIGHT, CHUNK_SIZE, TILE } from './constants';
import { ATLAS_GRID } from './textures';

export interface WorldChunkAccessor {
  getBlock(wx: number, wy: number, wz: number): BlockId;
  getSkyLight(wx: number, wy: number, wz: number): number;
  getBlockLight(wx: number, wy: number, wz: number): number;
}

export class ChunkData {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /** High 4 bits = skyLight (0..15), Low 4 bits = blockLight (0..15) */
  readonly light: Uint8Array;
  public dirty = true;
  public modified = false;
  public opaqueMesh: THREE.Mesh | null = null;
  public waterMesh: THREE.Mesh | null = null;

  constructor(cx: number, cz: number, blocks?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks ?? new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    this.light = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  }

  static key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  getBlockLocal(lx: number, y: number, lz: number): BlockId {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    return this.blocks[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] as BlockId;
  }

  setBlockLocal(lx: number, y: number, lz: number, id: BlockId): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = id;
  }

  getSkyLightLocal(lx: number, y: number, lz: number): number {
    if (y < 0) return 0;
    if (y >= CHUNK_HEIGHT) return 15;
    return (this.light[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] >> 4) & 0x0f;
  }

  setSkyLightLocal(lx: number, y: number, lz: number, v: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    this.light[idx] = ((v & 0x0f) << 4) | (this.light[idx] & 0x0f);
  }

  getBlockLightLocal(lx: number, y: number, lz: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.light[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] & 0x0f;
  }

  setBlockLightLocal(lx: number, y: number, lz: number, v: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
    this.light[idx] = (this.light[idx] & 0xf0) | (v & 0x0f);
  }
}

export function encodeRLE(blocks: Uint8Array): number[] {
  const out: number[] = [];
  if (blocks.length === 0) return out;
  let current = blocks[0];
  let count = 1;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i] === current) {
      count++;
    } else {
      out.push(current, count);
      current = blocks[i];
      count = 1;
    }
  }
  out.push(current, count);
  return out;
}

export function decodeRLE(rle: number[]): Uint8Array {
  const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
  let ptr = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const val = rle[i];
    const cnt = rle[i + 1];
    blocks.fill(val, ptr, ptr + cnt);
    ptr += cnt;
  }
  return blocks;
}

/**
 * Compute initial per-chunk sunlight columns + local BFS flood-fill for skyLight and blockLight.
 */
export function computeChunkLighting(chunk: ChunkData, accessor?: WorldChunkAccessor): void {
  chunk.light.fill(0);

  const skyQueue: number[] = [];
  const blockQueue: number[] = [];

  // 1. Vertical sunlight propagation & emissive seeds
  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      let sky = 15;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
        const bId = chunk.blocks[idx] as BlockId;
        const def = BLOCK_DEFS[bId];
        if (def.lightOpacity >= 15) {
          sky = 0;
        } else if (def.lightOpacity > 0) {
          sky = Math.max(0, sky - def.lightOpacity);
        }
        if (sky > 0) {
          chunk.light[idx] = (sky << 4) | (chunk.light[idx] & 0x0f);
          if (sky > 1) skyQueue.push(idx);
        }
        if (def.lightEmission > 0) {
          chunk.light[idx] = (chunk.light[idx] & 0xf0) | (def.lightEmission & 0x0f);
          blockQueue.push(idx);
        }
      }
    }
  }

  // Pull light bleeding across chunk borders if neighbors are loaded
  if (accessor) {
    const wx0 = chunk.cx * CHUNK_SIZE;
    const wz0 = chunk.cz * CHUNK_SIZE;
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const edges: [number, number, number, number][] = [
          [0, i, wx0 - 1, wz0 + i],
          [CHUNK_SIZE - 1, i, wx0 + CHUNK_SIZE, wz0 + i],
          [i, 0, wx0 + i, wz0 - 1],
          [i, CHUNK_SIZE - 1, wx0 + i, wz0 + CHUNK_SIZE],
        ];
        for (const [lx, lz, nwx, nwz] of edges) {
          const idx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
          const bId = chunk.blocks[idx] as BlockId;
          const op = Math.max(1, BLOCK_DEFS[bId].lightOpacity);
          if (op >= 15) continue;
          const nSky = accessor.getSkyLight(nwx, y, nwz) - op;
          if (nSky > ((chunk.light[idx] >> 4) & 0x0f)) {
            chunk.light[idx] = (nSky << 4) | (chunk.light[idx] & 0x0f);
            if (nSky > 1) skyQueue.push(idx);
          }
          const nBlk = accessor.getBlockLight(nwx, y, nwz) - op;
          if (nBlk > (chunk.light[idx] & 0x0f)) {
            chunk.light[idx] = (chunk.light[idx] & 0xf0) | nBlk;
            if (nBlk > 1) blockQueue.push(idx);
          }
        }
      }
    }
  }

  const DIRS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  // 2. BFS Sky Light horizontal/overhang spread
  let head = 0;
  while (head < skyQueue.length) {
    const idx = skyQueue[head++];
    const curSky = (chunk.light[idx] >> 4) & 0x0f;
    if (curSky <= 1) continue;

    const lx = idx & 15;
    const tmp = idx >> 4;
    const lz = tmp & 15;
    const y = tmp >> 4;

    for (let d = 0; d < 6; d++) {
      const nx = lx + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = lz + DIRS[d][2];
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const nIdx = (ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
      const op = BLOCK_DEFS[chunk.blocks[nIdx] as BlockId].lightOpacity;
      if (op >= 15) continue;
      const nextSky = curSky - Math.max(1, op);
      if (nextSky > ((chunk.light[nIdx] >> 4) & 0x0f)) {
        chunk.light[nIdx] = (nextSky << 4) | (chunk.light[nIdx] & 0x0f);
        if (nextSky > 1) skyQueue.push(nIdx);
      }
    }
  }

  // 3. BFS Block Light (Torches, Lava, Lit Furnace, Glowstone)
  head = 0;
  while (head < blockQueue.length) {
    const idx = blockQueue[head++];
    const curBlk = chunk.light[idx] & 0x0f;
    if (curBlk <= 1) continue;

    const lx = idx & 15;
    const tmp = idx >> 4;
    const lz = tmp & 15;
    const y = tmp >> 4;

    for (let d = 0; d < 6; d++) {
      const nx = lx + DIRS[d][0];
      const ny = y + DIRS[d][1];
      const nz = lz + DIRS[d][2];
      if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_HEIGHT) continue;
      const nIdx = (ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx;
      const op = BLOCK_DEFS[chunk.blocks[nIdx] as BlockId].lightOpacity;
      if (op >= 15) continue;
      const nextBlk = curBlk - Math.max(1, op);
      if (nextBlk > (chunk.light[nIdx] & 0x0f)) {
        chunk.light[nIdx] = (chunk.light[nIdx] & 0xf0) | nextBlk;
        if (nextBlk > 1) blockQueue.push(nIdx);
      }
    }
  }
}

interface MeshBuffers {
  positions: number[];
  normals: number[];
  tiledUvs: number[];
  tileOrigins: number[];
  lights: number[];
  aos: number[];
  indices: number[];
  vertCount: number;
}

function createBuffers(): MeshBuffers {
  return {
    positions: [],
    normals: [],
    tiledUvs: [],
    tileOrigins: [],
    lights: [],
    aos: [],
    indices: [],
    vertCount: 0,
  };
}

function toBufferGeometry(buf: MeshBuffers): THREE.BufferGeometry | null {
  if (buf.indices.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
  geo.setAttribute('aTiledUv', new THREE.Float32BufferAttribute(buf.tiledUvs, 2));
  geo.setAttribute('aTileOrigin', new THREE.Float32BufferAttribute(buf.tileOrigins, 2));
  geo.setAttribute('aVoxelLight', new THREE.Float32BufferAttribute(buf.lights, 2));
  geo.setAttribute('aVoxelAo', new THREE.Float32BufferAttribute(buf.aos, 1));
  geo.setIndex(buf.indices);
  geo.computeBoundingSphere();
  return geo;
}

const FACE_NORMALS: [number, number, number][] = [
  [1, 0, 0],  // 0: +X right
  [-1, 0, 0], // 1: -X left
  [0, 1, 0],  // 2: +Y top
  [0, -1, 0], // 3: -Y bottom
  [0, 0, 1],  // 4: +Z front
  [0, 0, -1], // 5: -Z back
];

const AO_CURVE = [0.46, 0.65, 0.83, 1.0];

/**
 * AO-and-light-aware Greedy Voxel Chunk Mesher.
 * Merges coplanar faces sharing (tileIndex, packedLight, packedAO) into maximal quads,
 * eliminating redundant triangles while preserving crisp per-vertex AO and block/sky lighting.
 */
export function buildChunkGeometry(
  chunk: ChunkData,
  accessor: WorldChunkAccessor,
): { opaque: THREE.BufferGeometry | null; water: THREE.BufferGeometry | null } {
  const opaque = createBuffers();
  const water = createBuffers();

  const wx0 = chunk.cx * CHUNK_SIZE;
  const wz0 = chunk.cz * CHUNK_SIZE;

  const isOccluder = (wx: number, wy: number, wz: number): number => {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const b = accessor.getBlock(wx, wy, wz);
    const d = BLOCK_DEFS[b];
    return d.solid && !d.transparent ? 1 : 0;
  };

  // Compute min/max non-air Y range to skip empty sky layers cleanly
  let maxY = 1;
  for (let y = CHUNK_HEIGHT - 1; y >= 1; y--) {
    let hasBlock = false;
    const base = y * CHUNK_SIZE * CHUNK_SIZE;
    for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
      if (chunk.blocks[base + i] !== BlockId.Air) {
        hasBlock = true;
        break;
      }
    }
    if (hasBlock) {
      maxY = Math.min(CHUNK_HEIGHT - 1, y + 1);
      break;
    }
  }

  // Emit non-full-cube blocks (Torches) directly as slim centered 3D posts
  for (let y = 1; y <= maxY; y++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const bId = chunk.getBlockLocal(lx, y, lz);
        if (bId === BlockId.Torch) {
          emitTorchPost(opaque, lx, y, lz);
        }
      }
    }
  }

  // 6 face directions mapped to (axis: 0=x,1=y,2=z, dir: +1/-1)
  // For each face, define uAxis and vAxis so cross(uDir, vDir) points along normal
  const FACE_SPECS = [
    { faceIdx: 0, axis: 0, dir: 1, uAxis: 2, vAxis: 1, uMax: CHUNK_SIZE, vMax: maxY + 1, flipWinding: true },  // +X
    { faceIdx: 1, axis: 0, dir: -1, uAxis: 2, vAxis: 1, uMax: CHUNK_SIZE, vMax: maxY + 1, flipWinding: false }, // -X
    { faceIdx: 2, axis: 1, dir: 1, uAxis: 0, vAxis: 2, uMax: CHUNK_SIZE, vMax: CHUNK_SIZE, flipWinding: true }, // +Y
    { faceIdx: 3, axis: 1, dir: -1, uAxis: 0, vAxis: 2, uMax: CHUNK_SIZE, vMax: CHUNK_SIZE, flipWinding: false }, // -Y
    { faceIdx: 4, axis: 2, dir: 1, uAxis: 0, vAxis: 1, uMax: CHUNK_SIZE, vMax: maxY + 1, flipWinding: false }, // +Z
    { faceIdx: 5, axis: 2, dir: -1, uAxis: 0, vAxis: 1, uMax: CHUNK_SIZE, vMax: maxY + 1, flipWinding: true }, // -Z
  ];

  // Reusable slice mask storing packed key (0 = culled)
  const maskOpaque = new Int32Array(CHUNK_SIZE * CHUNK_HEIGHT);
  const maskWater = new Int32Array(CHUNK_SIZE * CHUNK_HEIGHT);

  const pos = [0, 0, 0];
  const nPos = [0, 0, 0];

  for (const spec of FACE_SPECS) {
    const { faceIdx, axis, dir, uAxis, vAxis, uMax, vMax, flipWinding } = spec;
    const dMax = axis === 1 ? maxY + 1 : CHUNK_SIZE;
    const norm = FACE_NORMALS[faceIdx];

    for (let d = 0; d < dMax; d++) {
      const sliceLen = uMax * vMax;
      maskOpaque.fill(0, 0, sliceLen);
      maskWater.fill(0, 0, sliceLen);

      for (let v = 0; v < vMax; v++) {
        for (let u = 0; u < uMax; u++) {
          pos[axis] = d;
          pos[uAxis] = u;
          pos[vAxis] = v;

          const lx = pos[0];
          const ly = pos[1];
          const lz = pos[2];
          if (ly >= CHUNK_HEIGHT) continue;

          const bId = chunk.getBlockLocal(lx, ly, lz);
          if (bId === BlockId.Air) continue;
          const bDef = BLOCK_DEFS[bId];
          if (bDef.nonFullCube) continue;

          nPos[0] = lx + norm[0];
          nPos[1] = ly + norm[1];
          nPos[2] = lz + norm[2];

          const nwx = wx0 + nPos[0];
          const nwy = nPos[1];
          const nwz = wz0 + nPos[2];

          const nbId =
            nPos[0] >= 0 && nPos[0] < CHUNK_SIZE && nPos[2] >= 0 && nPos[2] < CHUNK_SIZE && nwy >= 0 && nwy < CHUNK_HEIGHT
              ? chunk.getBlockLocal(nPos[0], nwy, nPos[2])
              : accessor.getBlock(nwx, nwy, nwz);

          const nbDef = BLOCK_DEFS[nbId];

          // Face culling checks
          if (bDef.liquid) {
            if (nbId === bId || (!nbDef.transparent && nbDef.solid)) continue;
          } else if (bDef.transparent) {
            if (nbId === bId && bId === BlockId.Glass) continue;
            if (!nbDef.transparent && nbDef.solid) continue;
          } else {
            if (!nbDef.transparent && nbDef.solid) continue;
          }

          // Sample skyLight & blockLight from the neighbor cell outside this face
          const sky =
            nPos[0] >= 0 && nPos[0] < CHUNK_SIZE && nPos[2] >= 0 && nPos[2] < CHUNK_SIZE && nwy >= 0 && nwy < CHUNK_HEIGHT
              ? chunk.getSkyLightLocal(nPos[0], nwy, nPos[2])
              : accessor.getSkyLight(nwx, nwy, nwz);

          const blk =
            bId === BlockId.Lava || bId === BlockId.Glowstone || bId === BlockId.FurnaceLit
              ? 15
              : nPos[0] >= 0 && nPos[0] < CHUNK_SIZE && nPos[2] >= 0 && nPos[2] < CHUNK_SIZE && nwy >= 0 && nwy < CHUNK_HEIGHT
                ? chunk.getBlockLightLocal(nPos[0], nwy, nPos[2])
                : accessor.getBlockLight(nwx, nwy, nwz);

          // Sample 4 corner AO values on the plane outside this face
          let aoCode = 0;
          if (!bDef.liquid) {
            const sampleCornerAo = (du: number, dv: number): number => {
              const s1 = [nwx, nwy, nwz];
              s1[uAxis] += du;
              const s2 = [nwx, nwy, nwz];
              s2[vAxis] += dv;
              const sc = [nwx, nwy, nwz];
              sc[uAxis] += du;
              sc[vAxis] += dv;
              const side1 = isOccluder(s1[0], s1[1], s1[2]);
              const side2 = isOccluder(s2[0], s2[1], s2[2]);
              const corner = isOccluder(sc[0], sc[1], sc[2]);
              if (side1 && side2) return 0;
              return 3 - (side1 + side2 + corner);
            };
            const ao00 = sampleCornerAo(-1, -1);
            const ao10 = sampleCornerAo(1, -1);
            const ao11 = sampleCornerAo(1, 1);
            const ao01 = sampleCornerAo(-1, 1);
            aoCode = ao00 | (ao10 << 2) | (ao11 << 4) | (ao01 << 6);
          } else {
            aoCode = 0xff; // full 3 on all 4 corners
          }

          const tile = bDef.tiles[faceIdx];
          // Pack into positive 31-bit integer: [bit0=1][tile:7][sky:4][blk:4][ao:8]
          const packed = 1 | (tile << 1) | (sky << 8) | (blk << 12) | (aoCode << 16);
          const mIdx = u + v * uMax;
          if (bId === BlockId.Water) {
            maskWater[mIdx] = packed;
          } else {
            maskOpaque[mIdx] = packed;
          }
        }
      }

      // Greedy merge both opaque and water slices
      greedyEmitSlice(opaque, maskOpaque, d, axis, dir, uAxis, vAxis, uMax, vMax, norm, flipWinding, false);
      greedyEmitSlice(water, maskWater, d, axis, dir, uAxis, vAxis, uMax, vMax, norm, flipWinding, true);
    }
  }

  return {
    opaque: toBufferGeometry(opaque),
    water: toBufferGeometry(water),
  };
}

function greedyEmitSlice(
  buf: MeshBuffers,
  mask: Int32Array,
  d: number,
  axis: number,
  dir: number,
  uAxis: number,
  vAxis: number,
  uMax: number,
  vMax: number,
  norm: [number, number, number],
  flipWinding: boolean,
  isWater: boolean,
) {
  const planeOffset = dir > 0 ? d + 1 : d;
  const basePos = [0, 0, 0];

  for (let v = 0; v < vMax; v++) {
    for (let u = 0; u < uMax; ) {
      const mIdx = u + v * uMax;
      const val = mask[mIdx];
      if (val === 0) {
        u++;
        continue;
      }

      // Expand width along u
      let w = 1;
      while (u + w < uMax && mask[u + w + v * uMax] === val) {
        w++;
      }

      // Expand height along v
      let h = 1;
      outer: while (v + h < vMax) {
        for (let k = 0; k < w; k++) {
          if (mask[u + k + (v + h) * uMax] !== val) break outer;
        }
        h++;
      }

      // Clear merged region in mask
      for (let dv = 0; dv < h; dv++) {
        const rowOff = (v + dv) * uMax + u;
        for (let du = 0; du < w; du++) {
          mask[rowOff + du] = 0;
        }
      }

      // Unpack tile, light, AO
      const tile = (val >> 1) & 0x7f;
      const sky = ((val >> 8) & 0x0f) / 15;
      const blk = ((val >> 12) & 0x0f) / 15;
      const aoCode = (val >> 16) & 0xff;
      const ao00 = AO_CURVE[aoCode & 3];
      const ao10 = AO_CURVE[(aoCode >> 2) & 3];
      const ao11 = AO_CURVE[(aoCode >> 4) & 3];
      const ao01 = AO_CURVE[(aoCode >> 6) & 3];

      const tx = (tile % ATLAS_GRID) / ATLAS_GRID;
      const ty = 1 - (Math.floor(tile / ATLAS_GRID) + 1) / ATLAS_GRID;

      // Water surface drops slightly by 0.12m on +Y top face for authentic shore depth
      const ySink = isWater && axis === 1 && dir === 1 ? -0.12 : 0;

      // 4 corners: (u, v), (u+w, v), (u+w, v+h), (u, v+h)
      const corners: [number, number, number, number, number][] = [
        [u, v, 0, 0, ao00],
        [u + w, v, w, 0, ao10],
        [u + w, v + h, w, h, ao11],
        [u, v + h, 0, h, ao01],
      ];

      const baseVert = buf.vertCount;
      for (let i = 0; i < 4; i++) {
        basePos[axis] = planeOffset + (axis === 1 ? ySink : 0);
        basePos[uAxis] = corners[i][0];
        basePos[vAxis] = corners[i][1];

        // If water side face at top edge, lower top vertices slightly too
        if (isWater && axis !== 1 && corners[i][1] > d) {
          // Keep water full height unless top; slight sink on top face looks great
        }

        buf.positions.push(basePos[0], basePos[1], basePos[2]);
        buf.normals.push(norm[0], norm[1], norm[2]);
        buf.tiledUvs.push(corners[i][2], corners[i][3]);
        buf.tileOrigins.push(tx, ty);
        buf.lights.push(sky, blk);
        buf.aos.push(corners[i][4]);
      }
      buf.vertCount += 4;

      // Flip quad diagonal to avoid AO anisotropy artifacts
      const flipDiag = ao00 + ao11 > ao10 + ao01;
      if (!flipWinding) {
        if (flipDiag) {
          buf.indices.push(baseVert, baseVert + 1, baseVert + 2, baseVert, baseVert + 2, baseVert + 3);
        } else {
          buf.indices.push(baseVert + 1, baseVert + 2, baseVert + 3, baseVert + 1, baseVert + 3, baseVert);
        }
      } else {
        if (flipDiag) {
          buf.indices.push(baseVert, baseVert + 2, baseVert + 1, baseVert, baseVert + 3, baseVert + 2);
        } else {
          buf.indices.push(baseVert + 1, baseVert + 3, baseVert + 2, baseVert + 1, baseVert, baseVert + 3);
        }
      }

      u += w;
    }
  }
}

function emitTorchPost(buf: MeshBuffers, lx: number, y: number, lz: number) {
  const x0 = lx + 0.42;
  const x1 = lx + 0.58;
  const y0 = y;
  const y1 = y + 0.65;
  const z0 = lz + 0.42;
  const z1 = lz + 0.58;

  const tile = TILE.TORCH;
  const tx = (tile % ATLAS_GRID) / ATLAS_GRID;
  const ty = 1 - (Math.floor(tile / ATLAS_GRID) + 1) / ATLAS_GRID;

  const faces: { verts: [number, number, number][]; norm: [number, number, number] }[] = [
    { norm: [1, 0, 0], verts: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]] },
    { norm: [-1, 0, 0], verts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { norm: [0, 1, 0], verts: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]] },
    { norm: [0, -1, 0], verts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
    { norm: [0, 0, 1], verts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { norm: [0, 0, -1], verts: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]] },
  ];
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];

  for (const f of faces) {
    const base = buf.vertCount;
    for (let i = 0; i < 4; i++) {
      buf.positions.push(f.verts[i][0], f.verts[i][1], f.verts[i][2]);
      buf.normals.push(f.norm[0], f.norm[1], f.norm[2]);
      buf.tiledUvs.push(uvs[i][0], uvs[i][1]);
      buf.tileOrigins.push(tx, ty);
      buf.lights.push(1.0, 1.0);
      buf.aos.push(1.0);
    }
    buf.vertCount += 4;
    buf.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
