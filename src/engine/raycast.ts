import * as THREE from 'three';
import { BlockId } from '../types/game';
import { BLOCK_DEFS } from './constants';

export interface VoxelHit {
  hit: boolean;
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  blockId: BlockId;
  distance: number;
}

/**
 * Fast 3D DDA Voxel Raycast (Amanatides-Woo traversal).
 * Steps cleanly cell-by-cell from origin along direction up to maxDist meters.
 */
export function raycastVoxel(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDist: number,
  getBlock: (x: number, y: number, z: number) => BlockId,
): VoxelHit {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const dx = direction.x;
  const dy = direction.y;
  const dz = direction.z;

  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;
  const stepZ = dz >= 0 ? 1 : -1;

  const tDeltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = dy === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);

  let tMaxX = dx === 0 ? Infinity : ((dx > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX);
  let tMaxY = dy === 0 ? Infinity : ((dy > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY);
  let tMaxZ = dz === 0 ? Infinity : ((dz > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ);

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let dist = 0;

  while (dist <= maxDist) {
    const bId = getBlock(x, y, z);
    const def = BLOCK_DEFS[bId];
    if (bId !== BlockId.Air && !def.liquid) {
      return {
        hit: true,
        x,
        y,
        z,
        nx,
        ny,
        nz,
        blockId: bId,
        distance: dist,
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX;
        dist = tMaxX;
        tMaxX += tDeltaX;
        nx = -stepX;
        ny = 0;
        nz = 0;
      } else {
        z += stepZ;
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY;
        dist = tMaxY;
        tMaxY += tDeltaY;
        nx = 0;
        ny = -stepY;
        nz = 0;
      } else {
        z += stepZ;
        dist = tMaxZ;
        tMaxZ += tDeltaZ;
        nx = 0;
        ny = 0;
        nz = -stepZ;
      }
    }
  }

  return {
    hit: false,
    x: 0,
    y: 0,
    z: 0,
    nx: 0,
    ny: 0,
    nz: 0,
    blockId: BlockId.Air,
    distance: maxDist,
  };
}
