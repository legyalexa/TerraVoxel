import * as THREE from 'three';
import { BlockId, MobDrop, MobType } from '../types/game';
import { BLOCK_DEFS, GRAVITY, ITEM_DEFS } from './constants';
import { soundEngine } from './audio';

export interface MobEntity {
  id: number;
  type: MobType;
  hostile: boolean;
  group: THREE.Group;
  limbs: THREE.Object3D[];
  head: THREE.Object3D | null;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  width: number;
  height: number;
  hp: number;
  maxHp: number;
  onGround: boolean;
  walkPhase: number;
  wanderTimer: number;
  wanderYaw: number;
  fleeTimer: number;
  attackCooldown: number;
  hitFlash: number;
  burnTimer: number;
  creeperFuse: number; // 0..1.5s when armed
  creeperHissed: boolean;
  callTimer: number;
}

export interface ProjectileEntity {
  id: number;
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fromPlayer: boolean;
  damage: number;
  age: number;
  stuck: boolean;
}

export interface DroppedItemEntity {
  id: number;
  itemId: string;
  count: number;
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  spin: number;
}

export interface ParticleBurst {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
}

export const MOB_STATS: Record<
  MobType,
  {
    name: string;
    hostile: boolean;
    hp: number;
    speed: number;
    width: number;
    height: number;
    damage: number;
    drops: MobDrop[];
  }
> = {
  pig: {
    name: 'Pig',
    hostile: false,
    hp: 10,
    speed: 2.3,
    width: 0.85,
    height: 0.9,
    damage: 0,
    drops: [{ itemId: 'raw_pork', min: 1, max: 3, chance: 1 }],
  },
  cow: {
    name: 'Cow',
    hostile: false,
    hp: 10,
    speed: 2.1,
    width: 0.9,
    height: 1.35,
    damage: 0,
    drops: [
      { itemId: 'raw_beef', min: 1, max: 3, chance: 1 },
      { itemId: 'leather', min: 1, max: 2, chance: 0.85 },
    ],
  },
  sheep: {
    name: 'Sheep',
    hostile: false,
    hp: 8,
    speed: 2.2,
    width: 0.85,
    height: 1.25,
    damage: 0,
    drops: [
      { itemId: 'raw_mutton', min: 1, max: 2, chance: 1 },
      { itemId: 'block_wool', min: 1, max: 1, chance: 1 },
    ],
  },
  chicken: {
    name: 'Chicken',
    hostile: false,
    hp: 4,
    speed: 2.6,
    width: 0.55,
    height: 0.75,
    damage: 0,
    drops: [
      { itemId: 'raw_chicken', min: 1, max: 1, chance: 1 },
      { itemId: 'feather', min: 1, max: 2, chance: 0.9 },
    ],
  },
  zombie: {
    name: 'Zombie',
    hostile: true,
    hp: 20,
    speed: 2.75,
    width: 0.65,
    height: 1.9,
    damage: 3.5,
    drops: [
      { itemId: 'rotten_flesh', min: 1, max: 2, chance: 1 },
      { itemId: 'iron_ingot', min: 1, max: 1, chance: 0.15 },
    ],
  },
  skeleton: {
    name: 'Skeleton',
    hostile: true,
    hp: 20,
    speed: 2.8,
    width: 0.65,
    height: 1.9,
    damage: 3.0,
    drops: [
      { itemId: 'bone', min: 1, max: 2, chance: 1 },
      { itemId: 'arrow', min: 1, max: 3, chance: 0.9 },
    ],
  },
  creeper: {
    name: 'Creeper',
    hostile: true,
    hp: 20,
    speed: 2.85,
    width: 0.65,
    height: 1.75,
    damage: 14,
    drops: [{ itemId: 'gunpowder', min: 1, max: 2, chance: 1 }],
  },
  spider: {
    name: 'Spider',
    hostile: true,
    hp: 16,
    speed: 3.8,
    width: 1.25,
    height: 0.85,
    damage: 3.0,
    drops: [
      { itemId: 'feather', min: 1, max: 1, chance: 0.5 },
      { itemId: 'gunpowder', min: 1, max: 1, chance: 0.35 },
    ],
  },
};

function partMat(color: number, roughness = 0.78, metalness = 0.04, emissive = 0x000000): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive });
}

function makeBoxPart(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  px = 0,
  py = 0,
  pz = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(px, py, pz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Assemble 5-12 part composite procedural voxel models anchored at bottom-center (y=0).
 */
export function createMobMesh(type: MobType): { group: THREE.Group; limbs: THREE.Object3D[]; head: THREE.Object3D | null } {
  const group = new THREE.Group();
  const limbs: THREE.Object3D[] = [];
  let head: THREE.Object3D | null = null;

  const eyeMat = partMat(0x14171c, 0.25, 0.2);

  if (type === 'pig') {
    const pink = partMat(0xf09ca4, 0.82, 0.02);
    const snoutMat = partMat(0xf5b3ba, 0.65, 0.05);
    const hoofMat = partMat(0x875458, 0.9, 0.02);

    const body = makeBoxPart(0.58, 0.44, 0.88, pink, 0, 0.48, 0);
    group.add(body);

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.62, 0.52);
    headGroup.add(makeBoxPart(0.46, 0.44, 0.44, pink, 0, 0, 0));
    headGroup.add(makeBoxPart(0.24, 0.16, 0.12, snoutMat, 0, -0.06, 0.24));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, -0.14, 0.06, 0.21));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, 0.14, 0.06, 0.21));
    group.add(headGroup);
    head = headGroup;

    const legOffsets = [[-0.18, 0.28], [0.18, 0.28], [-0.18, -0.28], [0.18, -0.28]];
    for (const [lx, lz] of legOffsets) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.3, lz);
      legPivot.add(makeBoxPart(0.18, 0.26, 0.18, pink, 0, -0.13, 0));
      legPivot.add(makeBoxPart(0.18, 0.06, 0.18, hoofMat, 0, -0.27, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'cow') {
    const hide = partMat(0x5c3e2b, 0.88, 0.02);
    const patch = partMat(0xe8e4dc, 0.9, 0.02);
    const horn = partMat(0xc7c2b6, 0.45, 0.12);

    group.add(makeBoxPart(0.66, 0.58, 1.02, hide, 0, 0.72, 0));
    group.add(makeBoxPart(0.68, 0.24, 0.34, patch, 0, 0.78, 0.12));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.96, 0.62);
    headGroup.add(makeBoxPart(0.48, 0.46, 0.42, hide, 0, 0, 0));
    headGroup.add(makeBoxPart(0.32, 0.2, 0.1, patch, 0, -0.12, 0.2));
    headGroup.add(makeBoxPart(0.08, 0.18, 0.08, horn, -0.25, 0.22, 0));
    headGroup.add(makeBoxPart(0.08, 0.18, 0.08, horn, 0.25, 0.22, 0));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, -0.15, 0.06, 0.21));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, 0.15, 0.06, 0.21));
    group.add(headGroup);
    head = headGroup;

    const legOffsets = [[-0.2, 0.34], [0.2, 0.34], [-0.2, -0.34], [0.2, -0.34]];
    for (const [lx, lz] of legOffsets) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.46, lz);
      legPivot.add(makeBoxPart(0.2, 0.46, 0.2, hide, 0, -0.23, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'sheep') {
    const wool = partMat(0xf0f2f5, 0.95, 0.0);
    const skin = partMat(0xe5c4a8, 0.78, 0.04);

    group.add(makeBoxPart(0.68, 0.56, 0.94, wool, 0, 0.68, 0));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.88, 0.55);
    headGroup.add(makeBoxPart(0.42, 0.4, 0.42, wool, 0, 0.04, -0.04));
    headGroup.add(makeBoxPart(0.34, 0.3, 0.34, skin, 0, -0.02, 0.12));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, -0.11, 0.04, 0.28));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.04, eyeMat, 0.11, 0.04, 0.28));
    group.add(headGroup);
    head = headGroup;

    const legOffsets = [[-0.19, 0.3], [0.19, 0.3], [-0.19, -0.3], [0.19, -0.3]];
    for (const [lx, lz] of legOffsets) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.42, lz);
      legPivot.add(makeBoxPart(0.18, 0.42, 0.18, skin, 0, -0.21, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'chicken') {
    const white = partMat(0xf5f6f8, 0.86, 0.02);
    const beak = partMat(0xf2b129, 0.55, 0.05);
    const wattle = partMat(0xd93636, 0.65, 0.04);

    group.add(makeBoxPart(0.36, 0.32, 0.44, white, 0, 0.36, 0));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.58, 0.22);
    headGroup.add(makeBoxPart(0.24, 0.28, 0.24, white, 0, 0, 0));
    headGroup.add(makeBoxPart(0.14, 0.08, 0.12, beak, 0, -0.02, 0.15));
    headGroup.add(makeBoxPart(0.08, 0.08, 0.08, wattle, 0, -0.1, 0.12));
    headGroup.add(makeBoxPart(0.05, 0.05, 0.03, eyeMat, -0.08, 0.04, 0.12));
    headGroup.add(makeBoxPart(0.05, 0.05, 0.03, eyeMat, 0.08, 0.04, 0.12));
    group.add(headGroup);
    head = headGroup;

    const lWing = makeBoxPart(0.06, 0.22, 0.32, white, -0.21, 0.38, 0);
    const rWing = makeBoxPart(0.06, 0.22, 0.32, white, 0.21, 0.38, 0);
    group.add(lWing, rWing);

    const legOffsets = [[-0.09, 0], [0.09, 0]];
    for (const [lx, lz] of legOffsets) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.22, lz);
      legPivot.add(makeBoxPart(0.06, 0.22, 0.06, beak, 0, -0.11, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'zombie') {
    const skin = partMat(0x528044, 0.85, 0.04);
    const shirt = partMat(0x328296, 0.88, 0.02);
    const pants = partMat(0x3a3f6e, 0.9, 0.02);

    group.add(makeBoxPart(0.46, 0.68, 0.26, shirt, 0, 1.06, 0));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.62, 0);
    headGroup.add(makeBoxPart(0.44, 0.44, 0.44, skin, 0, 0, 0));
    headGroup.add(makeBoxPart(0.09, 0.06, 0.03, eyeMat, -0.11, 0.02, 0.22));
    headGroup.add(makeBoxPart(0.09, 0.06, 0.03, eyeMat, 0.11, 0.02, 0.22));
    group.add(headGroup);
    head = headGroup;

    // Outstretched zombie arms
    const armL = new THREE.Group();
    armL.position.set(-0.34, 1.32, 0);
    armL.add(makeBoxPart(0.2, 0.64, 0.2, skin, 0, 0, 0.24));
    armL.rotation.x = -Math.PI * 0.45;
    const armR = new THREE.Group();
    armR.position.set(0.34, 1.32, 0);
    armR.add(makeBoxPart(0.2, 0.64, 0.2, skin, 0, 0, 0.24));
    armR.rotation.x = -Math.PI * 0.45;
    group.add(armL, armR);

    for (const lx of [-0.12, 0.12]) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.72, 0);
      legPivot.add(makeBoxPart(0.21, 0.72, 0.22, pants, 0, -0.36, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'skeleton') {
    const boneMat = partMat(0xdcd9cf, 0.65, 0.05);
    const ribMat = partMat(0xa6a298, 0.75, 0.05);
    const bowMat = partMat(0x754e28, 0.6, 0.1);

    group.add(makeBoxPart(0.4, 0.66, 0.2, ribMat, 0, 1.05, 0));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.6, 0);
    headGroup.add(makeBoxPart(0.42, 0.42, 0.42, boneMat, 0, 0, 0));
    headGroup.add(makeBoxPart(0.1, 0.09, 0.03, eyeMat, -0.1, 0.02, 0.21));
    headGroup.add(makeBoxPart(0.1, 0.09, 0.03, eyeMat, 0.1, 0.02, 0.21));
    group.add(headGroup);
    head = headGroup;

    const armL = makeBoxPart(0.12, 0.62, 0.12, boneMat, -0.28, 1.1, 0.2);
    armL.rotation.x = -Math.PI * 0.35;
    const armR = new THREE.Group();
    armR.position.set(0.28, 1.28, 0);
    armR.add(makeBoxPart(0.12, 0.62, 0.12, boneMat, 0, -0.22, 0.22));
    armR.add(makeBoxPart(0.06, 0.62, 0.06, bowMat, 0, -0.15, 0.55));
    armR.rotation.x = -Math.PI * 0.42;
    group.add(armL, armR);

    for (const lx of [-0.12, 0.12]) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.72, 0);
      legPivot.add(makeBoxPart(0.13, 0.72, 0.13, boneMat, 0, -0.36, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'creeper') {
    const green = partMat(0x47a343, 0.85, 0.03);
    const darkGreen = partMat(0x31782e, 0.88, 0.03);

    group.add(makeBoxPart(0.44, 0.78, 0.28, green, 0, 0.78, 0));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 1.4, 0);
    headGroup.add(makeBoxPart(0.46, 0.46, 0.46, green, 0, 0, 0));
    headGroup.add(makeBoxPart(0.1, 0.1, 0.03, eyeMat, -0.11, 0.06, 0.23));
    headGroup.add(makeBoxPart(0.1, 0.1, 0.03, eyeMat, 0.11, 0.06, 0.23));
    headGroup.add(makeBoxPart(0.14, 0.12, 0.03, eyeMat, 0, -0.07, 0.23));
    headGroup.add(makeBoxPart(0.06, 0.08, 0.03, eyeMat, -0.09, -0.15, 0.23));
    headGroup.add(makeBoxPart(0.06, 0.08, 0.03, eyeMat, 0.09, -0.15, 0.23));
    group.add(headGroup);
    head = headGroup;

    const legOffsets = [[-0.14, 0.18], [0.14, 0.18], [-0.14, -0.18], [0.14, -0.18]];
    for (const [lx, lz] of legOffsets) {
      const legPivot = new THREE.Group();
      legPivot.position.set(lx, 0.39, lz);
      legPivot.add(makeBoxPart(0.2, 0.39, 0.2, darkGreen, 0, -0.195, 0));
      group.add(legPivot);
      limbs.push(legPivot);
    }
  } else if (type === 'spider') {
    const dark = partMat(0x27242b, 0.65, 0.12);
    const abdomenMat = partMat(0x36313d, 0.75, 0.08);
    const spiderEye = partMat(0xd92626, 0.2, 0.3, 0x700000);

    group.add(makeBoxPart(0.56, 0.34, 0.48, dark, 0, 0.34, 0.05));
    group.add(makeBoxPart(0.68, 0.44, 0.64, abdomenMat, 0, 0.38, -0.52));

    const headGroup = new THREE.Group();
    headGroup.position.set(0, 0.36, 0.42);
    headGroup.add(makeBoxPart(0.44, 0.32, 0.34, dark, 0, 0, 0));
    headGroup.add(makeBoxPart(0.08, 0.06, 0.03, spiderEye, -0.12, 0.03, 0.17));
    headGroup.add(makeBoxPart(0.08, 0.06, 0.03, spiderEye, 0.12, 0.03, 0.17));
    headGroup.add(makeBoxPart(0.05, 0.05, 0.03, spiderEye, -0.04, 0.07, 0.17));
    headGroup.add(makeBoxPart(0.05, 0.05, 0.03, spiderEye, 0.04, 0.07, 0.17));
    group.add(headGroup);
    head = headGroup;

    // 8 articulated spider legs (4 per side)
    for (let side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const legPivot = new THREE.Group();
        legPivot.position.set(side * 0.28, 0.34, 0.16 - i * 0.18);
        const legBar = makeBoxPart(0.68, 0.09, 0.09, dark, side * 0.32, -0.12, 0);
        legBar.rotation.z = side * -0.42;
        legPivot.add(legBar);
        group.add(legPivot);
        limbs.push(legPivot);
      }
    }
  }

  return { group, limbs, head };
}

export function createArrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = makeBoxPart(0.04, 0.04, 0.65, partMat(0x8a6236, 0.7));
  const tip = makeBoxPart(0.07, 0.07, 0.12, partMat(0xc4c9cf, 0.3, 0.8), 0, 0, 0.34);
  const fletch = makeBoxPart(0.11, 0.11, 0.12, partMat(0xeef2f6, 0.9), 0, 0, -0.28);
  g.add(shaft, tip, fletch);
  return g;
}

export function createDroppedItemMesh(itemId: string): THREE.Mesh {
  const def = ITEM_DEFS[itemId];
  const color = def ? def.color : '#ffffff';
  const isBlock = def?.placeBlockId !== undefined;
  const geo = isBlock
    ? new THREE.BoxGeometry(0.28, 0.28, 0.28)
    : new THREE.BoxGeometry(0.24, 0.24, 0.08);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export interface RemotePlayerAvatar {
  group: THREE.Group;
  bodyPivot: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  walkPhase: number;
  swingPhase: number;
}

export function createRemotePlayerMesh(name: string, colorHex: string): RemotePlayerAvatar {
  const group = new THREE.Group();
  const bodyPivot = new THREE.Group();
  group.add(bodyPivot);

  const skin = partMat(0xd9a882, 0.78, 0.02);
  const shirt = partMat(new THREE.Color(colorHex).getHex(), 0.82, 0.05);
  const pants = partMat(0x2d3748, 0.88, 0.02);
  const hair = partMat(0x2a1d14, 0.9, 0.02);
  const eye = partMat(0x14171c, 0.25, 0.2);

  // Torso
  bodyPivot.add(makeBoxPart(0.46, 0.68, 0.24, shirt, 0, 1.06, 0));

  // Head
  const head = new THREE.Group();
  head.position.set(0, 1.62, 0);
  head.add(makeBoxPart(0.44, 0.44, 0.44, skin, 0, 0, 0));
  head.add(makeBoxPart(0.46, 0.14, 0.46, hair, 0, 0.18, 0));
  head.add(makeBoxPart(0.08, 0.07, 0.03, eye, -0.1, 0.02, 0.22));
  head.add(makeBoxPart(0.08, 0.07, 0.03, eye, 0.1, 0.02, 0.22));
  bodyPivot.add(head);

  // Arms
  const armL = new THREE.Group();
  armL.position.set(-0.34, 1.36, 0);
  armL.add(makeBoxPart(0.2, 0.64, 0.2, shirt, 0, -0.26, 0));
  const armR = new THREE.Group();
  armR.position.set(0.34, 1.36, 0);
  armR.add(makeBoxPart(0.2, 0.64, 0.2, shirt, 0, -0.26, 0));
  bodyPivot.add(armL, armR);

  // Legs
  const legL = new THREE.Group();
  legL.position.set(-0.12, 0.72, 0);
  legL.add(makeBoxPart(0.21, 0.72, 0.22, pants, 0, -0.36, 0));
  const legR = new THREE.Group();
  legR.position.set(0.12, 0.72, 0);
  legR.add(makeBoxPart(0.21, 0.72, 0.22, pants, 0, -0.36, 0));
  bodyPivot.add(legL, legR);

  // Nametag Sprite above head
  const tagCanvas = document.createElement('canvas');
  tagCanvas.width = 256;
  tagCanvas.height = 48;
  const ctx = tagCanvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(10, 15, 25, 0.72)';
  ctx.fillRect(16, 6, 224, 34);
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name.slice(0, 16), 128, 24);
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  tagTex.colorSpace = THREE.SRGBColorSpace;
  const spriteMat = new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.set(0, 2.15, 0);
  sprite.scale.set(1.5, 0.3, 1);
  bodyPivot.add(sprite);

  return { group, bodyPivot, head, armL, armR, legL, legR, walkPhase: 0, swingPhase: 0 };
}

export interface MobUpdateContext {
  dt: number;
  playerPos: THREE.Vector3;
  isCreative: boolean;
  isDaytime: boolean;
  getBlock: (x: number, y: number, z: number) => BlockId;
  getSkyLight: (x: number, y: number, z: number) => number;
  damagePlayer: (amount: number, knockbackDir: THREE.Vector3) => void;
  spawnArrow: (pos: THREE.Vector3, vel: THREE.Vector3, fromPlayer: boolean, damage: number) => void;
  explodeAt: (pos: THREE.Vector3, radius: number) => void;
  spawnFlameParticle: (pos: THREE.Vector3) => void;
}

export function updateMobEntity(mob: MobEntity, ctx: MobUpdateContext): boolean {
  const stats = MOB_STATS[mob.type];
  const { dt, playerPos } = ctx;

  // Hit flash decay
  if (mob.hitFlash > 0) {
    mob.hitFlash = Math.max(0, mob.hitFlash - dt * 5);
    mob.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setRGB(mob.hitFlash * 0.7, 0, 0);
        }
      }
    });
  }

  // Sunlight burning for Zombies & Skeletons
  if ((mob.type === 'zombie' || mob.type === 'skeleton') && ctx.isDaytime) {
    const bx = Math.floor(mob.pos.x);
    const by = Math.floor(mob.pos.y + mob.height - 0.1);
    const bz = Math.floor(mob.pos.z);
    if (ctx.getSkyLight(bx, by, bz) >= 13) {
      mob.burnTimer += dt;
      if (Math.random() < dt * 8) {
        ctx.spawnFlameParticle(
          new THREE.Vector3(
            mob.pos.x + (Math.random() - 0.5) * 0.5,
            mob.pos.y + Math.random() * mob.height,
            mob.pos.z + (Math.random() - 0.5) * 0.5,
          ),
        );
      }
      if (mob.burnTimer >= 1.0) {
        mob.burnTimer = 0;
        mob.hp -= 2;
        mob.hitFlash = 1;
      }
    }
  }

  if (mob.hp <= 0) return false;

  // Ambient mob calls
  mob.callTimer -= dt;
  if (mob.callTimer <= 0) {
    mob.callTimer = 6 + Math.random() * 10;
    if (mob.pos.distanceTo(playerPos) < 18) {
      soundEngine.playMobCall(mob.type);
    }
  }

  const dx = playerPos.x - mob.pos.x;
  const dz = playerPos.z - mob.pos.z;
  const horizDist = Math.hypot(dx, dz);

  let moveSpeed = 0;
  let targetYaw = mob.yaw;

  if (mob.hostile && !ctx.isCreative && horizDist < 22) {
    targetYaw = Math.atan2(dx, dz);
    if (mob.type === 'creeper') {
      if (horizDist < 3.1) {
        mob.creeperFuse += dt;
        if (!mob.creeperHissed) {
          mob.creeperHissed = true;
          soundEngine.playCreeperHiss();
        }
        const swell = 1 + (mob.creeperFuse / 1.5) * 0.28;
        mob.group.scale.set(swell, 1 + (swell - 1) * 0.4, swell);
        if (Math.floor(mob.creeperFuse * 12) % 2 === 0) {
          mob.hitFlash = 0.9;
        }
        if (mob.creeperFuse >= 1.5) {
          ctx.explodeAt(mob.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 3.3);
          mob.hp = 0;
          return false;
        }
      } else {
        if (mob.creeperFuse > 0 && horizDist > 5.0) {
          mob.creeperFuse = Math.max(0, mob.creeperFuse - dt * 2);
          mob.creeperHissed = false;
          mob.group.scale.set(1, 1, 1);
        }
        moveSpeed = stats.speed;
      }
    } else if (mob.type === 'skeleton') {
      if (horizDist > 10) {
        moveSpeed = stats.speed;
      } else if (horizDist < 5.5) {
        moveSpeed = -stats.speed * 0.65;
      }
      mob.attackCooldown -= dt;
      if (horizDist < 18 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 2.1 + Math.random() * 0.6;
        const origin = new THREE.Vector3(mob.pos.x, mob.pos.y + 1.45, mob.pos.z);
        const aim = new THREE.Vector3(
          playerPos.x - origin.x,
          playerPos.y + 1.15 - origin.y + horizDist * 0.04,
          playerPos.z - origin.z,
        )
          .normalize()
          .multiplyScalar(22);
        ctx.spawnArrow(origin, aim, false, stats.damage);
        soundEngine.playBowShoot();
      }
    } else {
      // Zombie / Spider melee
      if (horizDist > 1.35) {
        moveSpeed = stats.speed;
      }
      mob.attackCooldown -= dt;
      if (horizDist < 1.85 && Math.abs(playerPos.y - mob.pos.y) < 2.0 && mob.attackCooldown <= 0) {
        mob.attackCooldown = 1.1;
        const kb = new THREE.Vector3(dx, 0, dz).normalize();
        ctx.damagePlayer(stats.damage, kb);
      }
    }
  } else {
    // Passive wander or panic flee
    if (mob.fleeTimer > 0) {
      mob.fleeTimer -= dt;
      targetYaw = mob.wanderYaw;
      moveSpeed = stats.speed * 1.65;
    } else {
      mob.wanderTimer -= dt;
      if (mob.wanderTimer <= 0) {
        mob.wanderTimer = 2 + Math.random() * 4;
        if (Math.random() < 0.65) {
          mob.wanderYaw = Math.random() * Math.PI * 2;
        }
      }
      targetYaw = mob.wanderYaw;
      moveSpeed = mob.wanderTimer > 1.2 ? stats.speed * 0.65 : 0;
    }
  }

  mob.yaw = targetYaw;
  mob.group.rotation.y = mob.yaw;

  const desiredVx = Math.sin(mob.yaw) * moveSpeed;
  const desiredVz = Math.cos(mob.yaw) * moveSpeed;

  // Apply knockback decay + desired movement
  mob.vel.x = THREE.MathUtils.lerp(mob.vel.x, desiredVx, Math.min(1, dt * 8));
  mob.vel.z = THREE.MathUtils.lerp(mob.vel.z, desiredVz, Math.min(1, dt * 8));

  // Gravity & water buoyancy
  const feetBlock = ctx.getBlock(Math.floor(mob.pos.x), Math.floor(mob.pos.y + 0.2), Math.floor(mob.pos.z));
  const inWater = feetBlock === BlockId.Water;
  if (inWater) {
    mob.vel.y = Math.max(mob.vel.y - GRAVITY * 0.3 * dt, -2.5);
    if (moveSpeed !== 0) mob.vel.y = Math.min(mob.vel.y + 12 * dt, 2.5);
  } else {
    mob.vel.y -= GRAVITY * dt;
  }

  // Axis-separated AABB collision against voxel world
  const halfW = mob.width * 0.5;
  const collidesAt = (px: number, py: number, pz: number): boolean => {
    const minX = Math.floor(px - halfW);
    const maxX = Math.floor(px + halfW);
    const minY = Math.floor(py + 0.01);
    const maxY = Math.floor(py + mob.height - 0.01);
    const minZ = Math.floor(pz - halfW);
    const maxZ = Math.floor(pz + halfW);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const b = ctx.getBlock(x, y, z);
          if (BLOCK_DEFS[b].solid) return true;
        }
      }
    }
    return false;
  };

  let hitWall = false;
  const nextX = mob.pos.x + mob.vel.x * dt;
  if (!collidesAt(nextX, mob.pos.y, mob.pos.z)) {
    mob.pos.x = nextX;
  } else {
    hitWall = true;
    mob.vel.x = 0;
  }

  const nextZ = mob.pos.z + mob.vel.z * dt;
  if (!collidesAt(mob.pos.x, mob.pos.y, nextZ)) {
    mob.pos.z = nextZ;
  } else {
    hitWall = true;
    mob.vel.z = 0;
  }

  // Spider wall climbing or standard 1-block jump over obstacles
  if (hitWall) {
    if (mob.type === 'spider' && mob.hostile && horizDist < 22) {
      mob.vel.y = 4.4;
    } else if (mob.onGround) {
      mob.vel.y = 8.4;
      mob.onGround = false;
    } else if (!mob.hostile) {
      mob.wanderYaw += Math.PI * 0.65;
    }
  }

  const nextY = mob.pos.y + mob.vel.y * dt;
  if (!collidesAt(mob.pos.x, nextY, mob.pos.z)) {
    mob.pos.y = nextY;
    mob.onGround = false;
  } else {
    if (mob.vel.y < 0) mob.onGround = true;
    mob.vel.y = 0;
  }

  if (mob.pos.y < -20) return false;

  mob.group.position.copy(mob.pos);

  // Limb swing animation
  const speedSq = mob.vel.x * mob.vel.x + mob.vel.z * mob.vel.z;
  if (speedSq > 0.15) {
    mob.walkPhase += dt * 10;
  } else {
    mob.walkPhase = THREE.MathUtils.lerp(mob.walkPhase, 0, dt * 8);
  }
  const swing = Math.sin(mob.walkPhase) * (speedSq > 0.15 ? 0.55 : 0);
  mob.limbs.forEach((limb, idx) => {
    const dir = idx % 2 === 0 ? 1 : -1;
    if (mob.type === 'spider') {
      limb.rotation.y = swing * 0.35 * dir;
    } else {
      limb.rotation.x = swing * dir;
    }
  });

  return true;
}
