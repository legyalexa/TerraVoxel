import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ActiveModal,
  BiomeType,
  BlockId,
  FurnaceState,
  GameMode,
  HudSnapshot,
  InventorySlot,
  MobType,
  SerializedChunk,
  WorldMetadata,
  WorldSaveData,
} from '../types/game';
import {
  ALL_ITEM_IDS,
  BLOCK_DEFS,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  DAY_CYCLE_SECONDS,
  DAY_DURATION,
  FLY_SPEED,
  GRAVITY,
  ITEM_DEFS,
  JUMP_VELOCITY,
  NIGHT_DURATION,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPRINT_SPEED,
  SUNRISE_DURATION,
  SUNSET_DURATION,
  WALK_SPEED,
  getSkyBrightness,
  isNightTime,
} from './constants';
import { soundEngine } from './audio';
import {
  ChunkData,
  WorldChunkAccessor,
  buildChunkGeometry,
  computeChunkLighting,
  decodeRLE,
  encodeRLE,
} from './chunkMesher';
import { getFuelBurnTime, SMELTING_RECIPES } from './crafting';
import {
  DroppedItemEntity,
  MOB_STATS,
  MobEntity,
  ParticleBurst,
  ProjectileEntity,
  createArrowMesh,
  createDroppedItemMesh,
  createMobMesh,
  updateMobEntity,
} from './mobs';
import { TerrainGenerator } from './noise';
import { VoxelHit, raycastVoxel } from './raycast';
import { saveWorldToDb } from './storage';
import { createAtlasTexture, createBreakStageTextures } from './textures';
import { ChatMessage, MultiplayerClient, RemotePlayerState } from './multiplayer';
import { RemotePlayerAvatar, createRemotePlayerMesh } from './mobs';

// Pre-allocated math helpers (zero GC inside tick loop)
const _vec3 = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _skyDay = new THREE.Color(0x78b8ff);
const _skySunset = new THREE.Color(0xe67a45);
const _skyNight = new THREE.Color(0x090e1c);
const _skySunrise = new THREE.Color(0xe88f68);
const _skyCurrent = new THREE.Color();
const _fogUnderwater = new THREE.Color(0x164a7a);

export class VoxelWorld implements WorldChunkAccessor {
  private container: HTMLElement;
  private onHudUpdate: (hud: HudSnapshot) => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private isSoftwareGl = false;

  private atlasTexture!: THREE.CanvasTexture;
  private opaqueMaterial!: THREE.MeshStandardMaterial;
  private waterMaterial!: THREE.MeshStandardMaterial;
  private skyUniforms = {
    uSkyBrightness: { value: 1.0 },
    uTorchColor: { value: new THREE.Color(1.0, 0.76, 0.44) },
    uTime: { value: 0 },
  };

  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunMesh!: THREE.Mesh;
  private moonMesh!: THREE.Mesh;
  private starPoints!: THREE.Points;

  private targetOutline!: THREE.LineSegments;
  private breakOverlayMesh!: THREE.Mesh;
  private breakStageTextures: THREE.CanvasTexture[] = [];
  private lastBreakStage = -1;
  private breakChipTimer = 0;
  private viewModelGroup!: THREE.Group;
  private viewModelMesh!: THREE.Mesh;

  private terrain!: TerrainGenerator;
  private chunks = new Map<string, ChunkData>();
  private renderDistance = 4;

  // World metadata & state
  public meta: WorldMetadata;
  public mode: GameMode;
  private timeOfDay = 150;
  private dayCount = 1;
  private furnaces = new Map<string, FurnaceState>();

  // Player state
  private pos = new THREE.Vector3(0, 80, 0);
  private vel = new THREE.Vector3(0, 0, 0);
  private yaw = 0;
  private pitch = 0;
  private onGround = false;
  private isFlying = false;
  private crouchToggle = false;
  private isCrouching = false;
  private currentEyeHeight = PLAYER_EYE_HEIGHT;
  private lastSpacePress = 0;
  private fallPeakY = 0;

  private health = 20;
  private maxHealth = 20;
  private hunger = 20;
  private maxHunger = 20;
  private saturation = 5;
  private hungerTimer = 0;
  private regenTimer = 0;
  private oxygen = 20;
  private maxOxygen = 20;
  private drownTimer = 0;
  private damageFlash = 0;
  private invulnTimer = 0;
  private stepDist = 0;
  private caveAmbienceTimer = 18;

  // Inventory & equipment
  private activeSlot = 0;
  private hotbar: (InventorySlot | null)[] = new Array(9).fill(null);
  private inventory: (InventorySlot | null)[] = new Array(27).fill(null);
  private armor: (InventorySlot | null)[] = new Array(4).fill(null); // 0:helmet, 1:chest, 2:legs, 3:boots

  // Interaction & Combat
  private keys: Record<string, boolean> = {};
  private pointerLocked = false;
  private lastPointerLockExit = 0;
  private pointerLockRetryTimer: number | null = null;
  private leftMouseDown = false;
  private rightMouseDown = false;
  private activeModal: ActiveModal = 'none';
  private openFurnaceKey: string | null = null;
  private showDebug = false;

  private currentTarget: VoxelHit | null = null;
  private targetEntity: MobEntity | null = null;
  private breakProgress = 0;
  private breakSoundTimer = 0;
  private attackCooldown = 0;
  private swingAnim = 0;
  private bowCharge = 0;
  private eatCooldown = 0;

  // Entities
  private nextEntityId = 1;
  private mobs: MobEntity[] = [];
  private projectiles: ProjectileEntity[] = [];
  private drops: DroppedItemEntity[] = [];
  private particles: ParticleBurst[] = [];
  private mobSpawnTimer = 2.0;

  // Loop & lifecycle
  private disposed = false;
  private frameId = 0;
  private lastTime = performance.now();
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private hudSyncTimer = 0;
  private autoSaveTimer = 0;
  private saveStatusText: string | null = null;
  private saveStatusTimer = 0;

  // Multiplayer state
  private mpClient: MultiplayerClient | null = null;
  private remotePlayers = new Map<string, { state: RemotePlayerState; targetPos: THREE.Vector3; avatar: RemotePlayerAvatar }>();
  private chatMessages: ChatMessage[] = [];
  private chatOpen = false;
  private moveSyncTimer = 0;
  private isRemoteUpdate = false;
  private modifiedBlockEdits = new Map<string, number>();

  constructor(
    container: HTMLElement,
    saveData: WorldSaveData,
    onHudUpdate: (hud: HudSnapshot) => void,
    multiplayer?: {
      client: MultiplayerClient;
      initialEdits?: [string, number][];
      initialPlayers?: RemotePlayerState[];
    },
  ) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;
    this.meta = { ...saveData.meta };
    this.mode = saveData.meta.mode;
    this.timeOfDay = saveData.meta.timeOfDay;
    this.dayCount = saveData.meta.dayCount;
    this.terrain = new TerrainGenerator(saveData.meta.seed);

    this.initThree();
    this.loadSaveData(saveData);
    this.bindEvents();

    if (multiplayer) {
      this.attachMultiplayer(multiplayer.client, multiplayer.initialEdits, multiplayer.initialPlayers);
    }

    // Generate immediate spawn chunks synchronously so player stands on solid ground immediately
    this.ensureImmediateChunks();
    if (saveData.player.y <= 0) {
      this.placePlayerSafely();
    }

    this.pushHudSnapshot();
    this.startLoop();
  }

  private initThree() {
    // 1. Software WebGL detection
    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x78b8ff);
    this.scene.fog = new THREE.Fog(0x78b8ff, 34, 72);

    const aspect = (this.container.clientWidth || window.innerWidth) / (this.container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(75, aspect, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Studio environment reflection for PBR depth
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Warm sun + cool hemisphere fill
    this.hemiLight = new THREE.HemisphereLight(0xaad4ff, 0x3b3830, 0.55);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 1.35);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 1024;
    this.sunLight.shadow.mapSize.height = 1024;
    const d = 32;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 140;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Sun, Moon, and Night Stars
    this.sunMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff3b0, side: THREE.DoubleSide, fog: false }),
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({ color: 0xdbe6ff, side: THREE.DoubleSide, fog: false }),
    );
    this.scene.add(this.sunMesh, this.moonMesh);

    const starCount = 260;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.85 + 0.1);
      const r = 145;
      starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i * 3 + 1] = r * Math.cos(phi);
      starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starPoints = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xe6efff, size: 1.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }),
    );
    this.scene.add(this.starPoints);

    // Procedural Voxel Atlas + Custom Voxel PBR Shader Materials
    this.atlasTexture = createAtlasTexture(this.renderer);
    this.opaqueMaterial = this.createVoxelMaterial(false);
    this.waterMaterial = this.createVoxelMaterial(true);

    // Block Target Outline & Break Progress Overlay
    const boxEdges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006));
    this.targetOutline = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.75 }),
    );
    this.targetOutline.visible = false;
    this.scene.add(this.targetOutline);

    this.breakStageTextures = createBreakStageTextures();
    this.breakOverlayMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.008, 1.008, 1.008),
      new THREE.MeshBasicMaterial({
        map: this.breakStageTextures[0],
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.breakOverlayMesh.renderOrder = 3;
    this.breakOverlayMesh.visible = false;
    this.scene.add(this.breakOverlayMesh);

    // First-person Held Item / Hand Viewmodel
    this.viewModelGroup = new THREE.Group();
    this.viewModelMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.36),
      new THREE.MeshStandardMaterial({ color: 0xd9a882, roughness: 0.75 }),
    );
    this.viewModelMesh.position.set(0.36, -0.3, -0.52);
    this.viewModelMesh.rotation.set(0.18, -0.35, 0.1);
    this.viewModelGroup.add(this.viewModelMesh);
    this.camera.add(this.viewModelGroup);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private createVoxelMaterial(isWater: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      roughness: isWater ? 0.14 : 0.88,
      metalness: isWater ? 0.1 : 0.02,
      transparent: isWater,
      opacity: isWater ? 0.78 : 1.0,
      depthWrite: !isWater,
      side: isWater ? THREE.DoubleSide : THREE.FrontSide,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uAtlas = { value: this.atlasTexture };
      shader.uniforms.uSkyBrightness = this.skyUniforms.uSkyBrightness;
      shader.uniforms.uTorchColor = this.skyUniforms.uTorchColor;
      shader.uniforms.uTime = this.skyUniforms.uTime;

      shader.vertexShader =
        `
        attribute vec2 aTiledUv;
        attribute vec2 aTileOrigin;
        attribute vec2 aVoxelLight;
        attribute float aVoxelAo;
        uniform float uTime;
        varying vec2 vTiledUv;
        varying vec2 vTileOrigin;
        varying vec2 vVoxelLight;
        varying float vVoxelAo;
        ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        vTiledUv = aTiledUv;
        vTileOrigin = aTileOrigin;
        vVoxelLight = aVoxelLight;
        vVoxelAo = aVoxelAo;
        ${
          isWater
            ? `transformed.y += sin(position.x * 1.4 + uTime * 2.2) * 0.035 + cos(position.z * 1.4 + uTime * 1.8) * 0.035;`
            : ''
        }
        `,
      );

      shader.fragmentShader =
        `
        uniform sampler2D uAtlas;
        uniform float uSkyBrightness;
        uniform vec3 uTorchColor;
        varying vec2 vTiledUv;
        varying vec2 vTileOrigin;
        varying vec2 vVoxelLight;
        varying float vVoxelAo;
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        vec2 cellUv = fract(vTiledUv);
        vec2 tileSpan = vec2(1.0 / 8.0);
        vec2 texelInset = vec2(0.5 / 128.0);
        vec2 atlasUv = vTileOrigin + texelInset + cellUv * (tileSpan - 2.0 * texelInset);
        vec4 texSample = texture2D(uAtlas, atlasUv);
        if (texSample.a < 0.1) discard;
        float skyLit = vVoxelLight.x * uSkyBrightness;
        float blkLit = vVoxelLight.y;
        vec3 voxelShade = max(vec3(skyLit), blkLit * uTorchColor) * vVoxelAo;
        voxelShade = max(voxelShade, vec3(0.06));
        diffuseColor *= vec4(texSample.rgb * voxelShade, texSample.a);
        `,
      );
    };

    mat.customProgramCacheKey = () => (isWater ? 'voxel-water-v1' : 'voxel-opaque-v1');
    return mat;
  }

  private loadSaveData(save: WorldSaveData) {
    const p = save.player;
    this.pos.set(p.x, p.y, p.z);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.health = p.health;
    this.hunger = p.hunger;
    this.saturation = p.saturation;
    this.oxygen = p.oxygen;
    this.isFlying = p.isFlying;
    this.activeSlot = p.activeSlot;
    this.hotbar = p.hotbar.map((s) => (s ? { ...s } : null));
    this.inventory = p.inventory.map((s) => (s ? { ...s } : null));
    this.armor = p.armor.map((s) => (s ? { ...s } : null));

    for (const sc of save.modifiedChunks) {
      const blocks = decodeRLE(sc.rle);
      const chunk = new ChunkData(sc.cx, sc.cz, blocks);
      chunk.modified = true;
      chunk.dirty = true;
      this.chunks.set(ChunkData.key(sc.cx, sc.cz), chunk);
    }

    for (const f of save.furnaces) {
      this.furnaces.set(f.key, {
        ...f,
        input: f.input ? { ...f.input } : null,
        fuel: f.fuel ? { ...f.fuel } : null,
        output: f.output ? { ...f.output } : null,
      });
    }
  }

  private ensureImmediateChunks() {
    const pcx = Math.floor(this.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(this.pos.z / CHUNK_SIZE);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        this.getOrCreateChunk(pcx + dx, pcz + dz);
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const ch = this.chunks.get(ChunkData.key(pcx + dx, pcz + dz));
        if (ch) {
          computeChunkLighting(ch, this);
          this.rebuildChunkMesh(ch);
        }
      }
    }
  }

  private placePlayerSafely() {
    const sx = Math.floor(this.pos.x);
    const sz = Math.floor(this.pos.z);
    for (let y = CHUNK_HEIGHT - 4; y >= 10; y--) {
      const b = this.getBlock(sx, y, sz);
      if (BLOCK_DEFS[b].solid || b === BlockId.Water) {
        this.pos.set(sx + 0.5, y + 1.2, sz + 0.5);
        this.fallPeakY = this.pos.y;
        return;
      }
    }
  }

  private getOrCreateChunk(cx: number, cz: number): ChunkData {
    const key = ChunkData.key(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      const blocks = this.terrain.generateChunkBlocks(cx, cz);
      chunk = new ChunkData(cx, cz, blocks);
      chunk.dirty = true;
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  public getBlock(wx: number, wy: number, wz: number): BlockId {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BlockId.Air;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const ch = this.chunks.get(ChunkData.key(cx, cz));
    if (!ch) return BlockId.Air;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return ch.getBlockLocal(lx, Math.floor(wy), lz);
  }

  public getSkyLight(wx: number, wy: number, wz: number): number {
    if (wy < 0) return 0;
    if (wy >= CHUNK_HEIGHT) return 15;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const ch = this.chunks.get(ChunkData.key(cx, cz));
    if (!ch) return 15;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return ch.getSkyLightLocal(lx, Math.floor(wy), lz);
  }

  public getBlockLight(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return 0;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const ch = this.chunks.get(ChunkData.key(cx, cz));
    if (!ch) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return ch.getBlockLightLocal(lx, Math.floor(wy), lz);
  }

  public setBlock(wx: number, wy: number, wz: number, id: BlockId, markModified = true) {
    if (wy < 1 || wy >= CHUNK_HEIGHT - 1) return;
    const fx = Math.floor(wx);
    const fy = Math.floor(wy);
    const fz = Math.floor(wz);
    const cx = Math.floor(fx / CHUNK_SIZE);
    const cz = Math.floor(fz / CHUNK_SIZE);
    const ch = this.getOrCreateChunk(cx, cz);
    const lx = ((fx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((fz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    const prev = ch.getBlockLocal(lx, fy, lz);
    if (prev === id) return;
    ch.setBlockLocal(lx, fy, lz, id);
    if (markModified) {
      ch.modified = true;
      this.modifiedBlockEdits.set(`${fx},${fy},${fz}`, id);
      if (!this.isRemoteUpdate && this.mpClient?.connected) {
        this.mpClient.sendBlockSet(fx, fy, fz, id);
      }
    }

    // Recompute lighting & mark chunk + neighbors dirty
    computeChunkLighting(ch, this);
    ch.dirty = true;

    const markNeighbor = (nx: number, nz: number) => {
      const nch = this.chunks.get(ChunkData.key(nx, nz));
      if (nch) {
        computeChunkLighting(nch, this);
        nch.dirty = true;
      }
    };
    if (lx === 0) markNeighbor(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) markNeighbor(cx + 1, cz);
    if (lz === 0) markNeighbor(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) markNeighbor(cx, cz + 1);
  }

  public attachMultiplayer(
    client: MultiplayerClient,
    initialEdits?: [string, number][],
    initialPlayers?: RemotePlayerState[],
  ) {
    this.mpClient = client;

    if (initialEdits && initialEdits.length > 0) {
      this.isRemoteUpdate = true;
      for (const [key, blockId] of initialEdits) {
        const parts = key.split(',').map(Number);
        if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
          this.setBlock(parts[0], parts[1], parts[2], blockId as BlockId, true);
        }
      }
      this.isRemoteUpdate = false;
    }

    if (initialPlayers) {
      for (const p of initialPlayers) {
        if (p.id !== client.playerId) {
          this.upsertRemotePlayer(p);
        }
      }
    }

    client.setCallbacks({
      onPlayerJoined: (player) => {
        if (player.id === client.playerId) return;
        this.upsertRemotePlayer(player);
        this.pushSystemChat(`${player.name} joined the game`, player.color);
        this.pushHudSnapshot();
      },
      onPlayerMoved: (player) => {
        if (player.id === client.playerId) return;
        this.upsertRemotePlayer(player);
      },
      onPlayerLeft: (playerId, name) => {
        this.removeRemotePlayer(playerId);
        this.pushSystemChat(`${name} left the game`, '#94a3b8');
        this.pushHudSnapshot();
      },
      onBlockUpdated: (x, y, z, blockId) => {
        this.isRemoteUpdate = true;
        this.setBlock(x, y, z, blockId as BlockId, true);
        this.isRemoteUpdate = false;
      },
      onChat: (msg) => {
        this.chatMessages = [...this.chatMessages.slice(-24), msg];
        this.pushHudSnapshot();
      },
      onWorldSynced: (mode, timeOfDay, dayCount) => {
        this.mode = mode;
        this.timeOfDay = timeOfDay;
        this.dayCount = dayCount;
        if (mode === 'survival') this.isFlying = false;
        this.pushHudSnapshot();
      },
      onDisconnected: () => {
        this.pushSystemChat('Disconnected from multiplayer room', '#ef4444');
        this.pushHudSnapshot();
      },
    });

    if (client.code) {
      this.pushSystemChat(`Connected to room ${client.code}`, '#f59e0b');
    }
    this.pushHudSnapshot();
  }

  private pushSystemChat(text: string, color = '#94a3b8') {
    this.chatMessages = [
      ...this.chatMessages.slice(-24),
      {
        id: `sys_${Date.now()}_${Math.random()}`,
        sender: 'System',
        color,
        text,
        timestamp: Date.now(),
      },
    ];
  }

  private upsertRemotePlayer(state: RemotePlayerState) {
    const existing = this.remotePlayers.get(state.id);
    if (existing) {
      existing.state = state;
      existing.targetPos.set(state.x, state.y, state.z);
    } else {
      const avatar = createRemotePlayerMesh(state.name, state.color);
      const startY = state.y > 0 ? state.y : this.pos.y;
      avatar.group.position.set(state.x, startY, state.z);
      this.scene.add(avatar.group);
      this.remotePlayers.set(state.id, {
        state,
        targetPos: new THREE.Vector3(state.x, startY, state.z),
        avatar,
      });
    }
  }

  private removeRemotePlayer(playerId: string) {
    const entry = this.remotePlayers.get(playerId);
    if (!entry) return;
    this.scene.remove(entry.avatar.group);
    entry.avatar.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).geometry.dispose();
        ((c as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    this.remotePlayers.delete(playerId);
  }

  public exportModifiedBlockEdits(): [string, number][] {
    const edits = new Map<string, number>(this.modifiedBlockEdits);
    for (const ch of this.chunks.values()) {
      if (!ch.modified) continue;
      const base = this.terrain.generateChunkBlocks(ch.cx, ch.cz);
      const ox = ch.cx * CHUNK_SIZE;
      const oz = ch.cz * CHUNK_SIZE;
      for (let i = 0; i < ch.blocks.length; i++) {
        if (ch.blocks[i] !== base[i]) {
          const wy = Math.floor(i / (CHUNK_SIZE * CHUNK_SIZE));
          const rem = i % (CHUNK_SIZE * CHUNK_SIZE);
          const lz = Math.floor(rem / CHUNK_SIZE);
          const lx = rem % CHUNK_SIZE;
          edits.set(`${ox + lx},${wy},${oz + lz}`, ch.blocks[i]);
        }
      }
    }
    return Array.from(edits.entries());
  }

  public toggleCrouch() {
    if (this.isFlying) return;
    this.crouchToggle = !this.crouchToggle;
    this.pushHudSnapshot();
  }

  public setCrouchToggle(active: boolean) {
    if (this.isFlying && active) return;
    this.crouchToggle = active;
    this.pushHudSnapshot();
  }

  public openChat() {
    if (!this.mpClient?.connected || this.activeModal !== 'none') return;
    if (this.pointerLockRetryTimer !== null) {
      clearTimeout(this.pointerLockRetryTimer);
      this.pointerLockRetryTimer = null;
    }
    this.chatOpen = true;
    this.keys = {};
    this.leftMouseDown = false;
    this.rightMouseDown = false;
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.pushHudSnapshot();
  }

  public closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.requestPointerLock();
    this.pushHudSnapshot();
  }

  public sendChatMessage(text: string) {
    const clean = text.trim();
    if (clean && this.mpClient?.connected) {
      this.mpClient.sendChat(clean);
    }
    this.closeChat();
  }

  private rebuildChunkMesh(chunk: ChunkData) {
    chunk.dirty = false;
    if (chunk.opaqueMesh) {
      this.scene.remove(chunk.opaqueMesh);
      chunk.opaqueMesh.geometry.dispose();
      chunk.opaqueMesh = null;
    }
    if (chunk.waterMesh) {
      this.scene.remove(chunk.waterMesh);
      chunk.waterMesh.geometry.dispose();
      chunk.waterMesh = null;
    }

    const { opaque, water } = buildChunkGeometry(chunk, this);
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;

    if (opaque) {
      const mesh = new THREE.Mesh(opaque, this.opaqueMaterial);
      mesh.position.set(ox, 0, oz);
      mesh.castShadow = !this.isSoftwareGl;
      mesh.receiveShadow = !this.isSoftwareGl;
      this.scene.add(mesh);
      chunk.opaqueMesh = mesh;
    }
    if (water) {
      const wmesh = new THREE.Mesh(water, this.waterMaterial);
      wmesh.position.set(ox, 0, oz);
      wmesh.receiveShadow = !this.isSoftwareGl;
      wmesh.renderOrder = 2;
      this.scene.add(wmesh);
      chunk.waterMesh = wmesh;
    }
  }

  // ==================== INPUT & POINTER LOCK ====================
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.disposed) return;

    if (this.chatOpen) {
      if (e.code === 'Escape') {
        e.preventDefault();
        this.closeChat();
      }
      return;
    }

    if (e.code === 'F3') {
      e.preventDefault();
      this.showDebug = !this.showDebug;
      this.pushHudSnapshot();
      return;
    }

    if (e.code === 'KeyT' && this.mpClient?.connected && this.activeModal === 'none') {
      e.preventDefault();
      this.openChat();
      return;
    }

    if (e.code === 'KeyE') {
      if (this.activeModal === 'none') {
        this.openModal('inventory');
      } else if (this.activeModal === 'inventory' || this.activeModal === 'crafting' || this.activeModal === 'furnace') {
        this.closeModal();
      }
      return;
    }

    if (e.code === 'Escape') {
      if (this.activeModal !== 'none' && this.activeModal !== 'dead') {
        this.closeModal();
      } else if (this.activeModal === 'none') {
        this.openModal('pause');
      }
      return;
    }

    if (this.activeModal !== 'none') return;

    // Toggle Crouch (V)
    if (e.code === 'KeyV' && !e.repeat) {
      this.toggleCrouch();
      return;
    }

    // Hotbar 1-9
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= 9) {
        this.activeSlot = n - 1;
        this.updateViewModelAppearance();
        this.pushHudSnapshot();
      }
    }

    // Q to drop 1 item
    if (e.code === 'KeyQ') {
      this.dropActiveItem();
      return;
    }

    // Double-tap Spacebar flight in Creative mode
    if (e.code === 'Space' && !e.repeat) {
      const now = performance.now();
      if (this.mode === 'creative' && now - this.lastSpacePress < 280) {
        this.isFlying = !this.isFlying;
        if (this.isFlying) {
          this.vel.y = 0;
          this.crouchToggle = false;
        }
        this.lastSpacePress = 0;
        this.pushHudSnapshot();
      } else {
        this.lastSpacePress = now;
      }
    }

    this.keys[e.code] = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.pointerLocked || this.activeModal !== 'none') return;
    const sens = 0.0022;
    this.yaw -= e.movementX * sens;
    this.pitch -= e.movementY * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.49, Math.PI * 0.49);
  };

  private onMouseDown = (e: MouseEvent) => {
    soundEngine.unlock();
    if (this.activeModal !== 'none') return;

    if (!this.pointerLocked) {
      this.requestPointerLock();
      return;
    }

    if (e.button === 0) {
      this.leftMouseDown = true;
      this.handlePrimaryClick();
    } else if (e.button === 2) {
      this.rightMouseDown = true;
      this.handleSecondaryClick();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.leftMouseDown = false;
      this.breakProgress = 0;
    } else if (e.button === 2) {
      if (this.bowCharge > 0.15) {
        this.releaseBowArrow();
      }
      this.bowCharge = 0;
      this.rightMouseDown = false;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.activeModal !== 'none') return;
    const dir = e.deltaY > 0 ? 1 : -1;
    this.activeSlot = (this.activeSlot + dir + 9) % 9;
    this.updateViewModelAppearance();
    this.pushHudSnapshot();
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private onPointerLockChange = () => {
    this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!this.pointerLocked) {
      this.lastPointerLockExit = performance.now();
      this.leftMouseDown = false;
      this.rightMouseDown = false;
      this.keys = {};
    }
    this.pushHudSnapshot();
  };

  private onPointerLockError = () => {
    this.pointerLocked = false;
    this.lastPointerLockExit = performance.now();
    this.pushHudSnapshot();
  };

  private onResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private bindEvents() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private tryAcquirePointerLockNow() {
    if (this.disposed || this.activeModal !== 'none' || this.chatOpen) return;
    if (document.pointerLockElement === this.renderer.domElement) return;
    try {
      const maybePromise = this.renderer.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch(() => {
          this.lastPointerLockExit = performance.now();
        });
      }
    } catch {
      this.lastPointerLockExit = performance.now();
    }
  }

  public requestPointerLock() {
    soundEngine.unlock();
    if (this.disposed || this.activeModal !== 'none' || this.chatOpen) return;
    if (document.pointerLockElement === this.renderer.domElement) return;

    if (this.pointerLockRetryTimer !== null) {
      clearTimeout(this.pointerLockRetryTimer);
      this.pointerLockRetryTimer = null;
    }

    const sinceExit = performance.now() - this.lastPointerLockExit;
    if (sinceExit < 1300) {
      this.pointerLockRetryTimer = window.setTimeout(() => {
        this.pointerLockRetryTimer = null;
        this.tryAcquirePointerLockNow();
      }, Math.max(50, 1320 - sinceExit));
      return;
    }

    this.tryAcquirePointerLockNow();
  }

  public openModal(modal: ActiveModal) {
    if (this.pointerLockRetryTimer !== null) {
      clearTimeout(this.pointerLockRetryTimer);
      this.pointerLockRetryTimer = null;
    }
    this.activeModal = modal;
    this.leftMouseDown = false;
    this.rightMouseDown = false;
    this.keys = {};
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }
    this.pushHudSnapshot();
  }

  public closeModal() {
    this.activeModal = 'none';
    this.openFurnaceKey = null;
    this.requestPointerLock();
    this.pushHudSnapshot();
  }

  // ==================== INVENTORY HELPERS ====================
  public getHeldSlot(): InventorySlot | null {
    return this.hotbar[this.activeSlot];
  }

  public addItemToInventory(itemId: string, count: number, durability?: number): number {
    const def = ITEM_DEFS[itemId];
    if (!def) return count;
    let remaining = count;

    // 1. Stack into existing slots (hotbar then main inventory)
    if (def.maxStack > 1) {
      for (const arr of [this.hotbar, this.inventory]) {
        for (let i = 0; i < arr.length && remaining > 0; i++) {
          const s = arr[i];
          if (s && s.itemId === itemId && s.count < def.maxStack) {
            const add = Math.min(remaining, def.maxStack - s.count);
            s.count += add;
            remaining -= add;
          }
        }
      }
    }

    // 2. Empty slots
    for (const arr of [this.hotbar, this.inventory]) {
      for (let i = 0; i < arr.length && remaining > 0; i++) {
        if (!arr[i]) {
          const add = Math.min(remaining, def.maxStack);
          arr[i] = {
            itemId,
            count: add,
            durability: durability ?? def.maxDurability,
          };
          remaining -= add;
        }
      }
    }

    this.updateViewModelAppearance();
    this.pushHudSnapshot();
    return remaining;
  }

  public countItem(itemId: string): number {
    let total = 0;
    for (const s of [...this.hotbar, ...this.inventory]) {
      if (s && s.itemId === itemId) total += s.count;
    }
    return total;
  }

  public consumeItem(itemId: string, amount: number): boolean {
    if (this.countItem(itemId) < amount) return false;
    let rem = amount;
    for (const arr of [this.hotbar, this.inventory]) {
      for (let i = 0; i < arr.length && rem > 0; i++) {
        const s = arr[i];
        if (s && s.itemId === itemId) {
          const take = Math.min(rem, s.count);
          s.count -= take;
          rem -= take;
          if (s.count <= 0) arr[i] = null;
        }
      }
    }
    this.updateViewModelAppearance();
    this.pushHudSnapshot();
    return true;
  }

  private damageHeldTool() {
    if (this.mode === 'creative') return;
    const held = this.hotbar[this.activeSlot];
    if (!held || held.durability === undefined) return;
    held.durability -= 1;
    if (held.durability <= 0) {
      this.hotbar[this.activeSlot] = null;
      soundEngine.playBlockBreak('wood');
    }
    this.updateViewModelAppearance();
  }

  private dropActiveItem() {
    const held = this.hotbar[this.activeSlot];
    if (!held) return;
    const itemId = held.itemId;
    if (this.mode !== 'creative') {
      held.count -= 1;
      if (held.count <= 0) this.hotbar[this.activeSlot] = null;
    }
    this.camera.getWorldDirection(_dir);
    this.spawnDrop(
      itemId,
      1,
      this.camera.position.clone().addScaledVector(_dir, 0.8),
      _dir.clone().multiplyScalar(5).add(new THREE.Vector3(0, 2.5, 0)),
    );
    this.updateViewModelAppearance();
    this.pushHudSnapshot();
  }

  public setInventorySlot(zone: 'hotbar' | 'inventory' | 'armor', idx: number, slot: InventorySlot | null) {
    const target = zone === 'hotbar' ? this.hotbar : zone === 'inventory' ? this.inventory : this.armor;
    target[idx] = slot ? { ...slot } : null;
    this.updateViewModelAppearance();
    this.pushHudSnapshot();
  }

  public updateFurnaceState(key: string, next: FurnaceState) {
    this.furnaces.set(key, next);
    this.pushHudSnapshot();
  }

  public giveCreativeItem(itemId: string, fullStack = true) {
    const def = ITEM_DEFS[itemId];
    if (!def) return;
    const count = fullStack ? def.maxStack : 1;
    // Place in active hotbar slot if empty, otherwise add to inventory
    if (!this.hotbar[this.activeSlot]) {
      this.hotbar[this.activeSlot] = { itemId, count, durability: def.maxDurability };
    } else {
      this.addItemToInventory(itemId, count);
    }
    this.updateViewModelAppearance();
    this.pushHudSnapshot();
  }

  public setGameMode(mode: GameMode) {
    this.mode = mode;
    if (mode === 'survival') {
      this.isFlying = false;
    }
    this.mpClient?.sendWorldSync(this.mode, this.timeOfDay, this.dayCount);
    this.pushHudSnapshot();
  }

  public setRenderDistance(dist: number) {
    this.renderDistance = THREE.MathUtils.clamp(dist, 2, 6);
  }

  public setTimeOfDay(sec: number) {
    this.timeOfDay = ((sec % DAY_CYCLE_SECONDS) + DAY_CYCLE_SECONDS) % DAY_CYCLE_SECONDS;
    this.mpClient?.sendWorldSync(this.mode, this.timeOfDay, this.dayCount);
    this.pushHudSnapshot();
  }

  public respawnPlayer() {
    this.health = this.maxHealth;
    this.hunger = this.maxHunger;
    this.saturation = 5;
    this.oxygen = this.maxOxygen;
    this.vel.set(0, 0, 0);
    this.pos.set(0.5, 90, 0.5);
    this.placePlayerSafely();
    this.activeModal = 'none';
    this.requestPointerLock();
    this.pushHudSnapshot();
  }

  // ==================== INTERACTION, MINING & COMBAT ====================
  private updateViewModelAppearance() {
    const held = this.hotbar[this.activeSlot];
    const mat = this.viewModelMesh.material as THREE.MeshStandardMaterial;
    if (!held) {
      this.viewModelMesh.scale.set(1, 1, 1);
      mat.color.setHex(0xd9a882);
      return;
    }
    const def = ITEM_DEFS[held.itemId];
    mat.color.set(def ? def.color : '#ffffff');
    if (def?.placeBlockId !== undefined) {
      this.viewModelMesh.scale.set(1.25, 1.25, 0.65);
    } else if (def?.toolCategory && def.toolCategory !== 'none') {
      this.viewModelMesh.scale.set(0.5, 1.35, 1.35);
    } else {
      this.viewModelMesh.scale.set(0.8, 0.8, 0.5);
    }
  }

  private getArmorDefense(): number {
    let def = 0;
    for (const s of this.armor) {
      if (s) def += ITEM_DEFS[s.itemId]?.armorDefense ?? 0;
    }
    return def;
  }

  private handlePrimaryClick() {
    this.swingAnim = 1.0;

    // 1. Check mob hit first
    if (this.targetEntity) {
      if (this.attackCooldown > 0) return;
      const held = this.getHeldSlot();
      const heldDef = held ? ITEM_DEFS[held.itemId] : undefined;
      let dmg = heldDef?.attackDamage ?? 1.5;
      const isCrit = !this.onGround && this.vel.y < -0.5;
      if (isCrit) dmg *= 1.5;

      this.damageMob(this.targetEntity, dmg, isCrit);
      this.attackCooldown = heldDef?.toolCategory === 'sword' ? 0.42 : 0.6;
      this.damageHeldTool();
      return;
    }

    // 2. Creative instant break
    if (this.mode === 'creative' && this.currentTarget) {
      const { x, y, z, blockId } = this.currentTarget;
      const def = BLOCK_DEFS[blockId];
      if (def.hardness >= 0) {
        soundEngine.playBlockBreak(def.sound);
        this.spawnBlockParticles(x + 0.5, y + 0.5, z + 0.5, blockId);
        this.setBlock(x, y, z, BlockId.Air);
        this.removeFurnaceIfBroken(x, y, z);
      }
      return;
    }

    soundEngine.playSwing();
  }

  private handleSecondaryClick() {
    const held = this.getHeldSlot();

    // 1. Interact with Crafting Table or Furnace
    if (this.currentTarget) {
      const { x, y, z, blockId } = this.currentTarget;
      if (blockId === BlockId.CraftingTable) {
        this.openModal('crafting');
        return;
      }
      if (blockId === BlockId.Furnace || blockId === BlockId.FurnaceLit) {
        const key = `${x},${y},${z}`;
        if (!this.furnaces.has(key)) {
          this.furnaces.set(key, {
            key,
            x,
            y,
            z,
            input: null,
            fuel: null,
            output: null,
            burnTime: 0,
            maxBurnTime: 0,
            cookProgress: 0,
            cookTime: 8,
          });
        }
        this.openFurnaceKey = key;
        this.openModal('furnace');
        return;
      }
    }

    if (!held) return;
    const def = ITEM_DEFS[held.itemId];
    if (!def) return;

    // 2. Eat Food in Survival
    if (def.category === 'food' && this.mode === 'survival' && this.hunger < this.maxHunger && this.eatCooldown <= 0) {
      this.hunger = Math.min(this.maxHunger, this.hunger + (def.hungerRestore ?? 2));
      this.saturation = Math.min(this.hunger, this.saturation + (def.saturationRestore ?? 1));
      this.eatCooldown = 0.45;
      soundEngine.playEat();
      held.count -= 1;
      if (held.count <= 0) this.hotbar[this.activeSlot] = null;
      this.updateViewModelAppearance();
      this.pushHudSnapshot();
      return;
    }

    // 3. Place Block on Adjacent Face
    if (def.placeBlockId !== undefined && this.currentTarget) {
      const px = this.currentTarget.x + this.currentTarget.nx;
      const py = this.currentTarget.y + this.currentTarget.ny;
      const pz = this.currentTarget.z + this.currentTarget.nz;
      if (py < 1 || py >= CHUNK_HEIGHT - 1) return;

      const existing = this.getBlock(px, py, pz);
      if (existing !== BlockId.Air && existing !== BlockId.Water) return;

      // Prevent placing solid block inside player AABB
      const bdef = BLOCK_DEFS[def.placeBlockId];
      if (bdef.solid) {
        const activeHeight = this.isCrouching ? 1.42 : PLAYER_HEIGHT;
        const minX = this.pos.x - PLAYER_WIDTH * 0.48;
        const maxX = this.pos.x + PLAYER_WIDTH * 0.48;
        const minY = this.pos.y;
        const maxY = this.pos.y + activeHeight;
        const minZ = this.pos.z - PLAYER_WIDTH * 0.48;
        const maxZ = this.pos.z + PLAYER_WIDTH * 0.48;
        if (px + 1 > minX && px < maxX && py + 1 > minY && py < maxY && pz + 1 > minZ && pz < maxZ) {
          return;
        }
      }

      this.setBlock(px, py, pz, def.placeBlockId);
      soundEngine.playBlockPlace(bdef.sound);
      this.swingAnim = 0.8;

      if (this.mode === 'survival') {
        held.count -= 1;
        if (held.count <= 0) this.hotbar[this.activeSlot] = null;
        this.updateViewModelAppearance();
      }
      this.pushHudSnapshot();
    }
  }

  private releaseBowArrow() {
    const held = this.getHeldSlot();
    if (!held || held.itemId !== 'bow') return;
    if (this.mode === 'survival' && !this.consumeItem('arrow', 1)) return;

    const power = Math.min(1, this.bowCharge / 0.85);
    this.camera.getWorldDirection(_dir);
    const origin = this.camera.position.clone().addScaledVector(_dir, 0.6);
    const speed = 16 + power * 24;
    const dmg = 3 + power * 6;
    this.spawnArrow(origin, _dir.clone().multiplyScalar(speed), true, dmg);
    soundEngine.playBowShoot();
    this.damageHeldTool();
  }

  private removeFurnaceIfBroken(x: number, y: number, z: number) {
    const key = `${x},${y},${z}`;
    const f = this.furnaces.get(key);
    if (!f) return;
    for (const slot of [f.input, f.fuel, f.output]) {
      if (slot) {
        this.spawnDrop(slot.itemId, slot.count, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
      }
    }
    this.furnaces.delete(key);
    if (this.openFurnaceKey === key) {
      this.openFurnaceKey = null;
      if (this.activeModal === 'furnace') this.closeModal();
    }
  }

  // ==================== ENTITIES & COMBAT ====================
  private spawnMob(type: MobType, pos: THREE.Vector3) {
    const stats = MOB_STATS[type];
    const { group, limbs, head } = createMobMesh(type);
    group.position.copy(pos);
    this.scene.add(group);
    this.mobs.push({
      id: this.nextEntityId++,
      type,
      hostile: stats.hostile,
      group,
      limbs,
      head,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      width: stats.width,
      height: stats.height,
      hp: stats.hp,
      maxHp: stats.hp,
      onGround: false,
      walkPhase: 0,
      wanderTimer: Math.random() * 3,
      wanderYaw: Math.random() * Math.PI * 2,
      fleeTimer: 0,
      attackCooldown: 0.5,
      hitFlash: 0,
      burnTimer: 0,
      creeperFuse: 0,
      creeperHissed: false,
      callTimer: 4 + Math.random() * 8,
    });
  }

  private damageMob(mob: MobEntity, dmg: number, isCrit: boolean) {
    mob.hp -= dmg;
    mob.hitFlash = 1.0;
    this.camera.getWorldDirection(_dir);
    mob.vel.x += _dir.x * 7.5;
    mob.vel.z += _dir.z * 7.5;
    mob.vel.y = Math.max(mob.vel.y, 4.2);

    if (!mob.hostile) {
      mob.fleeTimer = 4.5;
      mob.wanderYaw = Math.atan2(_dir.x, _dir.z);
    }

    soundEngine.playHit(isCrit);
    this.spawnHitParticles(mob.pos.x, mob.pos.y + mob.height * 0.6, mob.pos.z, isCrit ? 0xffd54f : 0xef4444);

    if (mob.hp <= 0) {
      const stats = MOB_STATS[mob.type];
      for (const drop of stats.drops) {
        if (Math.random() <= drop.chance) {
          const cnt = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
          this.spawnDrop(drop.itemId, cnt, mob.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
        }
      }
      this.removeMob(mob);
    }
  }

  private removeMob(mob: MobEntity) {
    this.scene.remove(mob.group);
    mob.group.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        (c as THREE.Mesh).geometry.dispose();
        ((c as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    this.mobs = this.mobs.filter((m) => m.id !== mob.id);
  }

  private damagePlayer(amount: number, knockbackDir?: THREE.Vector3) {
    if (this.mode === 'creative' || this.activeModal === 'dead' || this.invulnTimer > 0) return;

    const armorDef = this.getArmorDefense();
    // Flat reduction scaled cleanly up to ~70% at full diamond
    const reduced = Math.max(0.5, amount * (1 - Math.min(0.75, armorDef * 0.036)));
    this.health = Math.max(0, this.health - reduced);
    this.damageFlash = 1.0;
    this.invulnTimer = 0.45;
    soundEngine.playPlayerHurt();

    // Damage armor durability
    for (let i = 0; i < this.armor.length; i++) {
      const s = this.armor[i];
      if (s && s.durability !== undefined) {
        s.durability -= 1;
        if (s.durability <= 0) this.armor[i] = null;
      }
    }

    if (knockbackDir) {
      this.vel.x += knockbackDir.x * 6.5;
      this.vel.z += knockbackDir.z * 6.5;
      this.vel.y = Math.max(this.vel.y, 4.5);
    }

    if (this.health <= 0) {
      this.openModal('dead');
    } else {
      this.pushHudSnapshot();
    }
  }

  private spawnArrow = (origin: THREE.Vector3, vel: THREE.Vector3, fromPlayer: boolean, damage: number) => {
    const mesh = createArrowMesh();
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      id: this.nextEntityId++,
      mesh,
      pos: origin.clone(),
      vel: vel.clone(),
      fromPlayer,
      damage,
      age: 0,
      stuck: false,
    });
  };

  private spawnDrop(itemId: string, count: number, pos: THREE.Vector3, vel?: THREE.Vector3) {
    const mesh = createDroppedItemMesh(itemId);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.drops.push({
      id: this.nextEntityId++,
      itemId,
      count,
      mesh,
      pos: pos.clone(),
      vel: vel ?? new THREE.Vector3((Math.random() - 0.5) * 2.5, 3.6, (Math.random() - 0.5) * 2.5),
      age: 0,
      spin: Math.random() * Math.PI * 2,
    });
  }

  private spawnBlockParticles(x: number, y: number, z: number, blockId: BlockId) {
    const itemId = BLOCK_DEFS[blockId]?.dropItemId;
    const colHex = (itemId && ITEM_DEFS[itemId]?.color) || '#8a8f96';
    const col = new THREE.Color(colHex);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.11, 0.11),
        new THREE.MeshBasicMaterial({ color: col }),
      );
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.6);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4),
        life: 0,
        maxLife: 0.45 + Math.random() * 0.25,
      });
    }
  }

  private spawnHitParticles(x: number, y: number, z: number, colorHex: number) {
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshBasicMaterial({ color: colorHex }),
      );
      m.position.set(x, y, z);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 5),
        life: 0,
        maxLife: 0.4,
      });
    }
  }

  private spawnFlameParticle = (pos: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? 0xff7b1c : 0xffd54f }),
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.particles.push({
      mesh: m,
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8),
      life: 0,
      maxLife: 0.4,
    });
  };

  private explodeAt = (center: THREE.Vector3, radius: number) => {
    soundEngine.playExplosion();
    const r = Math.ceil(radius);
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const dist = Math.hypot(dx, dy, dz);
          if (dist <= radius * (0.75 + Math.random() * 0.35)) {
            const b = this.getBlock(cx + dx, cy + dy, cz + dz);
            if (b !== BlockId.Air && b !== BlockId.Bedrock && b !== BlockId.Water && b !== BlockId.Lava) {
              this.setBlock(cx + dx, cy + dy, cz + dz, BlockId.Air);
              this.removeFurnaceIfBroken(cx + dx, cy + dy, cz + dz);
            }
          }
        }
      }
    }

    // Blast particles
    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.24, 0.24),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xf97316 : 0x94a3b8 }),
      );
      m.position.copy(center);
      this.scene.add(m);
      this.particles.push({
        mesh: m,
        vel: new THREE.Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 6, (Math.random() - 0.5) * 10),
        life: 0,
        maxLife: 0.65,
      });
    }

    // Blast damage to player
    const pDist = this.pos.distanceTo(center);
    if (pDist < radius * 2.1) {
      const factor = 1 - pDist / (radius * 2.1);
      const kb = this.pos.clone().sub(center).normalize();
      this.damagePlayer(14 * factor, kb.multiplyScalar(1.4));
    }
  };

  // ==================== TICK & PHYSICS ====================
  private startLoop() {
    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;

      this.fpsAccum += dt;
      this.fpsFrames += 1;
      if (this.fpsAccum >= 0.5) {
        this.fps = Math.round(this.fpsFrames / this.fpsAccum);
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }

      this.update(dt);
      this.renderer.render(this.scene, this.camera);

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private update(dt: number) {
    this.skyUniforms.uTime.value += dt;

    // 1. Advance 20-minute day-night cycle
    this.timeOfDay += dt;
    if (this.timeOfDay >= DAY_CYCLE_SECONDS) {
      this.timeOfDay -= DAY_CYCLE_SECONDS;
      this.dayCount += 1;
    }
    this.updateSkyAndSun();

    // 2. Stream & mesh chunks around player
    this.streamChunks();

    // 3. Tick Furnaces continuously
    this.tickFurnaces(dt);

    // 4. Player physics, survival vitals, raycast, mining & bow
    if (this.activeModal !== 'dead') {
      this.updatePlayer(dt);
      this.updateTargetingAndMining(dt);
    }

    // 5. Entities (Mobs, Projectiles, Drops, Particles, Remote Players)
    this.updateEntities(dt);

    // 6. Multiplayer 20Hz position sync
    if (this.mpClient?.connected) {
      this.moveSyncTimer += dt;
      if (this.moveSyncTimer >= 0.05) {
        this.moveSyncTimer = 0;
        const held = this.getHeldSlot();
        this.mpClient.sendMove({
          x: this.pos.x,
          y: this.pos.y,
          z: this.pos.z,
          yaw: this.yaw,
          pitch: this.pitch,
          crouching: this.isCrouching,
          swinging: this.swingAnim > 0.1 || (this.leftMouseDown && this.breakProgress > 0),
          heldItemId: held ? held.itemId : null,
        });
      }
    }

    // 7. Auto-save every 15s (only host or solo worlds)
    if (!this.mpClient || this.mpClient.isHost) {
      this.autoSaveTimer += dt;
      if (this.autoSaveTimer >= 15) {
        this.autoSaveTimer = 0;
        this.saveWorld().catch(() => {});
      }
    }
    if (this.saveStatusTimer > 0) {
      this.saveStatusTimer -= dt;
      if (this.saveStatusTimer <= 0) this.saveStatusText = null;
    }

    // 8. Throttled HUD sync
    this.hudSyncTimer += dt;
    if (this.hudSyncTimer >= 0.08) {
      this.hudSyncTimer = 0;
      this.pushHudSnapshot();
    }
  }

  private updateSkyAndSun() {
    const t = this.timeOfDay;
    const skyBright = getSkyBrightness(t);
    this.skyUniforms.uSkyBrightness.value = skyBright;

    // Sun angle: 0 = sunrise horizon, 300 = noon zenith, 600..690 = sunset horizon, 900 = midnight nadir
    const angle = ((t - 15) / DAY_CYCLE_SECONDS) * Math.PI * 2;
    const sunDirX = Math.cos(angle);
    const sunDirY = Math.sin(angle);

    this.sunMesh.position.set(this.pos.x + sunDirX * 110, this.pos.y + sunDirY * 110, this.pos.z - 25);
    this.sunMesh.lookAt(this.camera.position);

    this.moonMesh.position.set(this.pos.x - sunDirX * 110, this.pos.y - sunDirY * 110, this.pos.z - 25);
    this.moonMesh.lookAt(this.camera.position);

    // Light tracks sun during day, soft moonlight at night
    if (sunDirY >= -0.05) {
      this.sunLight.position.set(this.pos.x + sunDirX * 48, this.pos.y + Math.max(8, sunDirY * 58), this.pos.z - 14);
      this.sunLight.intensity = THREE.MathUtils.lerp(0.25, 1.4, skyBright);
      this.sunLight.color.setHex(t > DAY_DURATION - 30 ? 0xffa86a : 0xfff1d6);
    } else {
      this.sunLight.position.set(this.pos.x - sunDirX * 48, this.pos.y + Math.max(8, -sunDirY * 50), this.pos.z - 14);
      this.sunLight.intensity = 0.25;
      this.sunLight.color.setHex(0x88a8e6);
    }
    this.sunLight.target.position.copy(this.pos);
    this.sunLight.target.updateMatrixWorld();

    this.hemiLight.intensity = THREE.MathUtils.lerp(0.18, 0.62, skyBright);

    // Sky color across 4 phases
    if (t < DAY_DURATION) {
      _skyCurrent.copy(_skyDay);
    } else if (t < DAY_DURATION + SUNSET_DURATION) {
      const p = (t - DAY_DURATION) / SUNSET_DURATION;
      if (p < 0.5) _skyCurrent.lerpColors(_skyDay, _skySunset, p * 2);
      else _skyCurrent.lerpColors(_skySunset, _skyNight, (p - 0.5) * 2);
    } else if (t < DAY_DURATION + SUNSET_DURATION + NIGHT_DURATION) {
      _skyCurrent.copy(_skyNight);
    } else {
      const p = (t - (DAY_DURATION + SUNSET_DURATION + NIGHT_DURATION)) / SUNRISE_DURATION;
      if (p < 0.5) _skyCurrent.lerpColors(_skyNight, _skySunrise, p * 2);
      else _skyCurrent.lerpColors(_skySunrise, _skyDay, (p - 0.5) * 2);
    }

    const headBlock = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.currentEyeHeight), Math.floor(this.pos.z));
    const underwater = headBlock === BlockId.Water;
    const bgCol = underwater ? _fogUnderwater : _skyCurrent;
    (this.scene.background as THREE.Color).copy(bgCol);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(bgCol);
      this.scene.fog.near = underwater ? 4 : Math.max(24, this.renderDistance * 16 - 24);
      this.scene.fog.far = underwater ? 22 : this.renderDistance * 16 - 2;
    }

    // Stars visibility at night
    this.starPoints.position.copy(this.pos);
    (this.starPoints.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp((0.45 - skyBright) * 2.2, 0, 0.95);
  }

  private streamChunks() {
    const pcx = Math.floor(this.pos.x / CHUNK_SIZE);
    const pcz = Math.floor(this.pos.z / CHUNK_SIZE);

    // Generate & build up to 2 chunks per frame closest to player
    let built = 0;
    const candidates: { cx: number; cz: number; distSq: number }[] = [];
    for (let dx = -this.renderDistance; dx <= this.renderDistance; dx++) {
      for (let dz = -this.renderDistance; dz <= this.renderDistance; dz++) {
        candidates.push({ cx: pcx + dx, cz: pcz + dz, distSq: dx * dx + dz * dz });
      }
    }
    candidates.sort((a, b) => a.distSq - b.distSq);

    for (const c of candidates) {
      const key = ChunkData.key(c.cx, c.cz);
      let ch = this.chunks.get(key);
      if (!ch) {
        ch = this.getOrCreateChunk(c.cx, c.cz);
        computeChunkLighting(ch, this);
        this.rebuildChunkMesh(ch);
        built++;
      } else if (ch.dirty) {
        this.rebuildChunkMesh(ch);
        built++;
      }
      if (built >= 2) break;
    }

    // Unload distant unmodified chunks (keep modified chunks in memory so edits persist)
    const unloadDist = this.renderDistance + 3;
    for (const [key, ch] of this.chunks.entries()) {
      if (Math.abs(ch.cx - pcx) > unloadDist || Math.abs(ch.cz - pcz) > unloadDist) {
        if (ch.opaqueMesh) {
          this.scene.remove(ch.opaqueMesh);
          ch.opaqueMesh.geometry.dispose();
          ch.opaqueMesh = null;
        }
        if (ch.waterMesh) {
          this.scene.remove(ch.waterMesh);
          ch.waterMesh.geometry.dispose();
          ch.waterMesh = null;
        }
        if (!ch.modified) {
          this.chunks.delete(key);
        } else {
          ch.dirty = true;
        }
      }
    }
  }

  private tickFurnaces(dt: number) {
    for (const f of this.furnaces.values()) {
      const canSmelt =
        f.input &&
        SMELTING_RECIPES[f.input.itemId] &&
        (!f.output ||
          (f.output.itemId === SMELTING_RECIPES[f.input.itemId] &&
            f.output.count < (ITEM_DEFS[f.output.itemId]?.maxStack ?? 64)));

      const wasLit = f.burnTime > 0;
      if (f.burnTime > 0) {
        f.burnTime = Math.max(0, f.burnTime - dt);
      }

      if (f.burnTime <= 0 && canSmelt && f.fuel) {
        const fuelTime = getFuelBurnTime(f.fuel.itemId);
        if (fuelTime > 0) {
          f.burnTime = fuelTime;
          f.maxBurnTime = fuelTime;
          f.fuel.count -= 1;
          if (f.fuel.count <= 0) f.fuel = null;
        }
      }

      const isLit = f.burnTime > 0;
      if (wasLit !== isLit) {
        const curBlock = this.getBlock(f.x, f.y, f.z);
        if (curBlock === BlockId.Furnace || curBlock === BlockId.FurnaceLit) {
          this.setBlock(f.x, f.y, f.z, isLit ? BlockId.FurnaceLit : BlockId.Furnace);
        }
      }

      if (isLit && canSmelt && f.input) {
        f.cookProgress += dt;
        if (f.cookProgress >= f.cookTime) {
          f.cookProgress = 0;
          const outId = SMELTING_RECIPES[f.input.itemId];
          f.input.count -= 1;
          if (f.input.count <= 0) f.input = null;
          if (!f.output) {
            f.output = { itemId: outId, count: 1 };
          } else {
            f.output.count += 1;
          }
        }
      } else {
        f.cookProgress = Math.max(0, f.cookProgress - dt * 2);
      }
    }
  }

  private updatePlayer(dt: number) {
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    if (this.attackCooldown > 0) this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    if (this.eatCooldown > 0) this.eatCooldown = Math.max(0, this.eatCooldown - dt);

    const CROUCH_HEIGHT = 1.42;
    const CROUCH_EYE_HEIGHT = 1.24;
    const halfW = PLAYER_WIDTH * 0.5;
    const collidesAtHeight = (px: number, py: number, pz: number, height: number): boolean => {
      const minX = Math.floor(px - halfW);
      const maxX = Math.floor(px + halfW);
      const minY = Math.floor(py + 0.01);
      const maxY = Math.floor(py + height - 0.01);
      const minZ = Math.floor(pz - halfW);
      const maxZ = Math.floor(pz + halfW);
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            if (BLOCK_DEFS[this.getBlock(x, y, z)].solid) return true;
          }
        }
      }
      return false;
    };

    const wantsCrouch = Boolean(this.keys['KeyC'] || this.keys['ControlLeft'] || this.crouchToggle) && !this.isFlying;
    if (wantsCrouch) {
      this.isCrouching = true;
    } else if (this.isCrouching) {
      // Only stand up if full standing headroom is clear
      if (!collidesAtHeight(this.pos.x, this.pos.y, this.pos.z, PLAYER_HEIGHT)) {
        this.isCrouching = false;
      }
    }

    const targetEyeHeight = this.isCrouching ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
    this.currentEyeHeight = THREE.MathUtils.damp(this.currentEyeHeight, targetEyeHeight, 16, dt);

    // Input direction
    const forward = (this.keys['KeyW'] ? 1 : 0) - (this.keys['KeyS'] ? 1 : 0);
    const strafe = (this.keys['KeyD'] ? 1 : 0) - (this.keys['KeyA'] ? 1 : 0);
    const sprinting = Boolean(this.keys['ShiftLeft']) && !this.isFlying && !this.isCrouching && forward > 0;

    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    // Forward in Three.js camera looks down -Z when yaw=0
    const moveX = -sinY * forward + cosY * strafe;
    const moveZ = -cosY * forward - sinY * strafe;
    const moveLen = Math.hypot(moveX, moveZ);
    const nx = moveLen > 0 ? moveX / moveLen : 0;
    const nz = moveLen > 0 ? moveZ / moveLen : 0;

    const feetBlock = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.1), Math.floor(this.pos.z));
    const headBlock = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.currentEyeHeight), Math.floor(this.pos.z));
    const inWater = feetBlock === BlockId.Water;
    const underwater = headBlock === BlockId.Water;

    if (this.isFlying) {
      this.vel.x = THREE.MathUtils.lerp(this.vel.x, nx * FLY_SPEED, Math.min(1, dt * 10));
      this.vel.z = THREE.MathUtils.lerp(this.vel.z, nz * FLY_SPEED, Math.min(1, dt * 10));
      const flyY = (this.keys['Space'] ? 1 : 0) - (this.keys['ShiftLeft'] ? 1 : 0);
      this.vel.y = THREE.MathUtils.lerp(this.vel.y, flyY * FLY_SPEED * 0.85, Math.min(1, dt * 10));
      this.fallPeakY = this.pos.y;
    } else {
      const targetSpeed = inWater
        ? WALK_SPEED * 0.65
        : this.isCrouching
          ? WALK_SPEED * 0.52
          : sprinting
            ? SPRINT_SPEED
            : WALK_SPEED;
      const accel = this.onGround ? 14 : 6;
      this.vel.x = THREE.MathUtils.lerp(this.vel.x, nx * targetSpeed, Math.min(1, dt * accel));
      this.vel.z = THREE.MathUtils.lerp(this.vel.z, nz * targetSpeed, Math.min(1, dt * accel));

      if (inWater) {
        this.vel.y = Math.max(this.vel.y - GRAVITY * 0.25 * dt, -3.0);
        if (this.keys['Space']) {
          this.vel.y = Math.min(this.vel.y + 18 * dt, 4.2);
        }
        this.fallPeakY = this.pos.y;
      } else {
        this.vel.y -= GRAVITY * dt;
        if (this.keys['Space'] && this.onGround) {
          this.vel.y = JUMP_VELOCITY;
          this.onGround = false;
        }
      }
    }

    const activeHeight = this.isCrouching ? CROUCH_HEIGHT : PLAYER_HEIGHT;
    const collides = (px: number, py: number, pz: number): boolean => collidesAtHeight(px, py, pz, activeHeight);

    const hasGroundSupport = (px: number, py: number, pz: number): boolean => {
      const gy = Math.floor(py - 0.15);
      const r = halfW * 0.85;
      const corners = [
        [px - r, pz - r],
        [px + r, pz - r],
        [px - r, pz + r],
        [px + r, pz + r],
      ];
      for (const [cx, cz] of corners) {
        if (BLOCK_DEFS[this.getBlock(Math.floor(cx), gy, Math.floor(cz))].solid) return true;
      }
      return false;
    };

    const currentlySupported = this.onGround && hasGroundSupport(this.pos.x, this.pos.y, this.pos.z);

    const nextX = this.pos.x + this.vel.x * dt;
    const ledgeBlockedX =
      this.isCrouching && this.onGround && !this.isFlying && currentlySupported && !hasGroundSupport(nextX, this.pos.y, this.pos.z);
    if (!collides(nextX, this.pos.y, this.pos.z) && !ledgeBlockedX) {
      this.pos.x = nextX;
    } else {
      this.vel.x = 0;
    }

    const nextZ = this.pos.z + this.vel.z * dt;
    const ledgeBlockedZ =
      this.isCrouching && this.onGround && !this.isFlying && currentlySupported && !hasGroundSupport(this.pos.x, this.pos.y, nextZ);
    if (!collides(this.pos.x, this.pos.y, nextZ) && !ledgeBlockedZ) {
      this.pos.z = nextZ;
    } else {
      this.vel.z = 0;
    }

    const wasOnGround = this.onGround;
    const nextY = this.pos.y + this.vel.y * dt;
    if (!collides(this.pos.x, nextY, this.pos.z)) {
      this.pos.y = nextY;
      this.onGround = false;
      if (this.pos.y > this.fallPeakY) this.fallPeakY = this.pos.y;
    } else {
      if (this.vel.y < 0) {
        this.onGround = true;
        if (!wasOnGround && !this.isFlying && !inWater) {
          const fallDist = this.fallPeakY - this.pos.y;
          if (fallDist > 3.6) {
            this.damagePlayer(Math.floor(fallDist - 3.0));
          }
        }
        this.fallPeakY = this.pos.y;
      }
      this.vel.y = 0;
    }

    if (this.pos.y < -15) {
      this.damagePlayer(4);
      if (this.pos.y < -35 && this.mode === 'creative') this.pos.y = 85;
    }

    // Footstep audio & camera bob
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 0.5 && !this.isFlying && !this.isCrouching) {
      this.stepDist += hSpeed * dt;
      if (this.stepDist >= 1.9) {
        this.stepDist = 0;
        const under = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
        soundEngine.playFootstep(inWater ? 'water' : BLOCK_DEFS[under].sound);
      }
    }

    // Survival vitals: Hunger, Regen, Drowning, Lava/Cactus, Cave ambience
    if (this.mode === 'survival') {
      // Lava / Cactus hazard
      if (feetBlock === BlockId.Lava) {
        this.damagePlayer(4);
      }
      const torsoBlock = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.8), Math.floor(this.pos.z));
      if (torsoBlock === BlockId.Cactus) {
        this.damagePlayer(1);
      }

      // Oxygen underwater
      if (underwater) {
        this.oxygen = Math.max(0, this.oxygen - dt * 1.4);
        if (this.oxygen <= 0) {
          this.drownTimer += dt;
          if (this.drownTimer >= 1.0) {
            this.drownTimer = 0;
            this.damagePlayer(2);
          }
        }
      } else {
        this.oxygen = Math.min(this.maxOxygen, this.oxygen + dt * 6);
      }

      // Hunger drain
      const drainRate = sprinting ? 0.16 : hSpeed > 0.5 ? 0.05 : 0.012;
      this.hungerTimer += dt * drainRate;
      if (this.hungerTimer >= 1.0) {
        this.hungerTimer = 0;
        if (this.saturation > 0) {
          this.saturation = Math.max(0, this.saturation - 0.5);
        } else if (this.hunger > 0) {
          this.hunger = Math.max(0, this.hunger - 0.5);
        }
      }

      // Natural health regen vs starvation
      if (this.hunger >= 18 && this.health < this.maxHealth) {
        this.regenTimer += dt;
        if (this.regenTimer >= 2.2) {
          this.regenTimer = 0;
          this.health = Math.min(this.maxHealth, this.health + 1);
        }
      } else if (this.hunger <= 0) {
        this.regenTimer += dt;
        if (this.regenTimer >= 3.0 && this.health > 1) {
          this.regenTimer = 0;
          this.damagePlayer(1);
        }
      }
    }

    // Underground cave ambience
    const skyAtEye = this.getSkyLight(Math.floor(this.pos.x), Math.floor(this.pos.y + this.currentEyeHeight), Math.floor(this.pos.z));
    if (skyAtEye <= 2 && this.pos.y < 54) {
      this.caveAmbienceTimer -= dt;
      if (this.caveAmbienceTimer <= 0) {
        this.caveAmbienceTimer = 18 + Math.random() * 20;
        soundEngine.playCaveAmbience();
      }
    }

    // Update Camera & Viewmodel Bob/Swing
    const bobAmp = this.isCrouching ? 0.018 : 0.045;
    const bob = this.onGround && hSpeed > 0.5 && !this.isFlying ? Math.sin(this.skyUniforms.uTime.value * 11) * bobAmp : 0;
    this.camera.position.set(this.pos.x, this.pos.y + this.currentEyeHeight + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // Viewmodel swing & bow charge pullback
    if (this.swingAnim > 0) {
      this.swingAnim = Math.max(0, this.swingAnim - dt * 5.2);
    }
    const sw = Math.sin(this.swingAnim * Math.PI);
    this.viewModelGroup.position.set(0, bob * 0.3, this.bowCharge * 0.14);
    this.viewModelGroup.rotation.set(-sw * 0.85, sw * 0.35, sw * 0.25);
  }

  private updateTargetingAndMining(dt: number) {
    this.camera.getWorldDirection(_dir);
    const reach = this.mode === 'creative' ? 7.0 : 4.8;

    // 1. Check mob target ray intersection first
    let bestMob: MobEntity | null = null;
    let bestMobDist = 3.6;
    for (const mob of this.mobs) {
      const mCenter = _vec3.set(mob.pos.x, mob.pos.y + mob.height * 0.5, mob.pos.z);
      const toMob = _vec3B.copy(mCenter).sub(this.camera.position);
      const proj = toMob.dot(_dir);
      if (proj > 0 && proj < bestMobDist) {
        const perpSq = toMob.lengthSq() - proj * proj;
        const hitR = mob.width * 0.72;
        if (perpSq <= hitR * hitR) {
          bestMob = mob;
          bestMobDist = proj;
        }
      }
    }
    this.targetEntity = bestMob;

    // 2. Voxel DDA Raycast
    const hit = raycastVoxel(this.camera.position, _dir, reach, (x, y, z) => this.getBlock(x, y, z));
    if (hit.hit && (!bestMob || hit.distance < bestMobDist)) {
      if (
        !this.currentTarget ||
        this.currentTarget.x !== hit.x ||
        this.currentTarget.y !== hit.y ||
        this.currentTarget.z !== hit.z
      ) {
        this.breakProgress = 0;
      }
      this.currentTarget = hit;
      this.targetEntity = null;
      this.targetOutline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.targetOutline.visible = true;
    } else {
      this.currentTarget = null;
      this.targetOutline.visible = false;
      this.breakProgress = 0;
    }

    // 3. Survival hold-to-mine
    if (this.leftMouseDown && this.activeModal === 'none' && this.pointerLocked && this.currentTarget && this.mode === 'survival') {
      const { x, y, z, blockId } = this.currentTarget;
      const bdef = BLOCK_DEFS[blockId];
      if (bdef.hardness >= 0) {
        const held = this.getHeldSlot();
        const heldDef = held ? ITEM_DEFS[held.itemId] : undefined;
        let speedMult = 1.0;
        if (heldDef?.toolCategory === bdef.preferredTool) {
          speedMult = heldDef.miningSpeed ?? 1.0;
        } else if (bdef.minTier > 0) {
          speedMult = 0.35; // Wrong tool penalty
        }

        const breakTime = Math.max(0.06, bdef.hardness / speedMult);
        this.breakProgress += dt / breakTime;
        this.swingAnim = Math.max(this.swingAnim, 0.25 + Math.abs(Math.sin(this.skyUniforms.uTime.value * 14)) * 0.55);

        this.breakSoundTimer -= dt;
        if (this.breakSoundTimer <= 0) {
          this.breakSoundTimer = 0.22;
          soundEngine.playMineTick(bdef.sound);
        }

        // Progressive crack texture animation + mining chip particles
        const stage = Math.min(9, Math.max(0, Math.floor(this.breakProgress * 10)));
        this.breakOverlayMesh.visible = true;
        this.breakOverlayMesh.position.set(x + 0.5, y + 0.5, z + 0.5);
        if (stage !== this.lastBreakStage && this.breakStageTextures[stage]) {
          const mat = this.breakOverlayMesh.material as THREE.MeshBasicMaterial;
          mat.map = this.breakStageTextures[stage];
          mat.needsUpdate = true;
          this.lastBreakStage = stage;
        }

        this.breakChipTimer -= dt;
        if (this.breakChipTimer <= 0) {
          this.breakChipTimer = 0.16;
          const itemId = bdef.dropItemId;
          const col = new THREE.Color((itemId && ITEM_DEFS[itemId]?.color) || '#9aa0a6');
          for (let c = 0; c < 3; c++) {
            const m = new THREE.Mesh(
              new THREE.BoxGeometry(0.075, 0.075, 0.075),
              new THREE.MeshBasicMaterial({ color: col }),
            );
            m.position.set(
              x + 0.5 + this.currentTarget.nx * 0.52 + (Math.random() - 0.5) * 0.38,
              y + 0.5 + this.currentTarget.ny * 0.52 + (Math.random() - 0.5) * 0.38,
              z + 0.5 + this.currentTarget.nz * 0.52 + (Math.random() - 0.5) * 0.38,
            );
            this.scene.add(m);
            this.particles.push({
              mesh: m,
              vel: new THREE.Vector3(
                this.currentTarget.nx * 1.8 + (Math.random() - 0.5) * 2.4,
                1.4 + Math.random() * 2.0,
                this.currentTarget.nz * 1.8 + (Math.random() - 0.5) * 2.4,
              ),
              life: 0,
              maxLife: 0.32 + Math.random() * 0.18,
            });
          }
        }

        if (this.breakProgress >= 1.0) {
          this.breakProgress = 0;
          this.lastBreakStage = -1;
          this.breakOverlayMesh.visible = false;
          soundEngine.playBlockBreak(bdef.sound);
          this.spawnBlockParticles(x + 0.5, y + 0.5, z + 0.5, blockId);

          const toolTier = heldDef?.toolCategory === bdef.preferredTool ? (heldDef.toolTier ?? 0) : 0;
          const canHarvest = bdef.minTier === 0 || toolTier >= bdef.minTier;
          if (canHarvest && bdef.dropItemId) {
            this.spawnDrop(bdef.dropItemId, bdef.dropCount ?? 1, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
          }
          // Oak/Birch leaves occasional apple drop
          if ((blockId === BlockId.OakLeaves || blockId === BlockId.BirchLeaves) && Math.random() < 0.08) {
            this.spawnDrop('apple', 1, new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
          }

          this.setBlock(x, y, z, BlockId.Air);
          this.removeFurnaceIfBroken(x, y, z);
          this.damageHeldTool();
        }
      }
    } else {
      this.breakOverlayMesh.visible = false;
      this.lastBreakStage = -1;
    }

    // 4. Bow charging on hold Right-Click
    if (this.rightMouseDown && this.activeModal === 'none' && this.pointerLocked) {
      const held = this.getHeldSlot();
      if (held?.itemId === 'bow' && (this.mode === 'creative' || this.countItem('arrow') > 0)) {
        this.bowCharge = Math.min(1.0, this.bowCharge + dt * 1.15);
      }
    }
  }

  private updateEntities(dt: number) {
    const night = isNightTime(this.timeOfDay);

    // 1. Mob Spawner (up to 14 passive + 10 hostile nearby)
    this.mobSpawnTimer -= dt;
    if (this.mobSpawnTimer <= 0) {
      this.mobSpawnTimer = 2.8;
      const passiveCount = this.mobs.filter((m) => !m.hostile).length;
      const hostileCount = this.mobs.filter((m) => m.hostile).length;

      const trySpawn = (hostile: boolean) => {
        const angle = Math.random() * Math.PI * 2;
        const dist = hostile ? 14 + Math.random() * 14 : 12 + Math.random() * 18;
        const sx = Math.floor(this.pos.x + Math.cos(angle) * dist);
        const sz = Math.floor(this.pos.z + Math.sin(angle) * dist);
        // Find surface block near player height
        for (let y = Math.min(CHUNK_HEIGHT - 3, Math.floor(this.pos.y + 18)); y >= 15; y--) {
          const b = this.getBlock(sx, y, sz);
          const above1 = this.getBlock(sx, y + 1, sz);
          const above2 = this.getBlock(sx, y + 2, sz);
          if (BLOCK_DEFS[b].solid && above1 === BlockId.Air && above2 === BlockId.Air) {
            if (hostile) {
              const sky = this.getSkyLight(sx, y + 1, sz) * getSkyBrightness(this.timeOfDay);
              const blk = this.getBlockLight(sx, y + 1, sz);
              if (Math.max(sky, blk) <= 6.5) {
                const types: MobType[] = ['zombie', 'skeleton', 'creeper', 'spider'];
                this.spawnMob(types[Math.floor(Math.random() * types.length)], new THREE.Vector3(sx + 0.5, y + 1.05, sz + 0.5));
              }
            } else if (b === BlockId.Grass || b === BlockId.Snow) {
              const types: MobType[] = ['pig', 'cow', 'sheep', 'chicken'];
              this.spawnMob(types[Math.floor(Math.random() * types.length)], new THREE.Vector3(sx + 0.5, y + 1.05, sz + 0.5));
            }
            break;
          }
        }
      };

      if (passiveCount < 10) trySpawn(false);
      if (night && hostileCount < 9) trySpawn(true);
      else if (!night && hostileCount < 3) trySpawn(true); // Dark caves
    }

    // 2. Update Mobs & Despawn far ones
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (m.pos.distanceTo(this.pos) > 58) {
        this.removeMob(m);
        continue;
      }
      const alive = updateMobEntity(m, {
        dt,
        playerPos: this.pos,
        isCreative: this.mode === 'creative',
        isDaytime: !night,
        getBlock: (x, y, z) => this.getBlock(x, y, z),
        getSkyLight: (x, y, z) => this.getSkyLight(x, y, z),
        damagePlayer: (amt, kb) => this.damagePlayer(amt, kb),
        spawnArrow: this.spawnArrow,
        explodeAt: this.explodeAt,
        spawnFlameParticle: this.spawnFlameParticle,
      });
      if (!alive) {
        this.removeMob(m);
      }
    }

    // 3. Projectiles (Arrows)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.age > 12) {
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (!p.stuck) {
        p.vel.y -= GRAVITY * 0.55 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.mesh.position.copy(p.pos);
        if (p.vel.lengthSq() > 0.1) {
          p.mesh.lookAt(_vec3.copy(p.pos).add(p.vel));
        }

        // Hit block
        const b = this.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z));
        if (BLOCK_DEFS[b].solid) {
          p.stuck = true;
          p.age = 8; // Despawn shortly
          continue;
        }

        // Hit mob or player
        if (p.fromPlayer) {
          for (const m of this.mobs) {
            if (
              Math.abs(p.pos.x - m.pos.x) < m.width * 0.65 &&
              Math.abs(p.pos.z - m.pos.z) < m.width * 0.65 &&
              p.pos.y >= m.pos.y &&
              p.pos.y <= m.pos.y + m.height
            ) {
              this.damageMob(m, p.damage, false);
              this.scene.remove(p.mesh);
              this.projectiles.splice(i, 1);
              break;
            }
          }
        } else {
          if (
            Math.abs(p.pos.x - this.pos.x) < PLAYER_WIDTH * 0.65 &&
            Math.abs(p.pos.z - this.pos.z) < PLAYER_WIDTH * 0.65 &&
            p.pos.y >= this.pos.y &&
            p.pos.y <= this.pos.y + PLAYER_HEIGHT
          ) {
            this.damagePlayer(p.damage, p.vel.clone().setY(0).normalize());
            this.scene.remove(p.mesh);
            this.projectiles.splice(i, 1);
          }
        }
      }
    }

    // 4. Dropped Items (physics + magnetic pickup)
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.spin += dt * 2.5;
      if (d.age > 120) {
        this.scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.drops.splice(i, 1);
        continue;
      }

      d.vel.y -= GRAVITY * 0.8 * dt;
      const ny = d.pos.y + d.vel.y * dt;
      const bBelow = this.getBlock(Math.floor(d.pos.x), Math.floor(ny - 0.14), Math.floor(d.pos.z));
      if (BLOCK_DEFS[bBelow].solid) {
        d.vel.y = 0;
        d.vel.x *= 0.85;
        d.vel.z *= 0.85;
      } else {
        d.pos.x += d.vel.x * dt;
        d.pos.y = ny;
        d.pos.z += d.vel.z * dt;
      }

      // Magnetic pickup after 0.35s
      const pTarget = _vec3.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
      const dist = d.pos.distanceTo(pTarget);
      if (d.age > 0.35 && dist < 2.2) {
        d.pos.lerp(pTarget, Math.min(1, dt * 10));
        if (dist < 0.75) {
          const leftover = this.addItemToInventory(d.itemId, d.count);
          if (leftover < d.count) {
            soundEngine.playPickup();
          }
          if (leftover <= 0) {
            this.scene.remove(d.mesh);
            d.mesh.geometry.dispose();
            (d.mesh.material as THREE.Material).dispose();
            this.drops.splice(i, 1);
            continue;
          } else {
            d.count = leftover;
          }
        }
      }

      d.mesh.position.set(d.pos.x, d.pos.y + Math.sin(d.spin) * 0.08 + 0.15, d.pos.z);
      d.mesh.rotation.y = d.spin;
    }

    // 5. Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life += dt;
      if (pt.life >= pt.maxLife) {
        this.scene.remove(pt.mesh);
        pt.mesh.geometry.dispose();
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.vel.y -= GRAVITY * 0.6 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      const s = 1 - pt.life / pt.maxLife;
      pt.mesh.scale.setScalar(s);
    }

    // 6. Remote Multiplayer Avatars
    for (const entry of this.remotePlayers.values()) {
      const { state, targetPos, avatar } = entry;
      const dist = avatar.group.position.distanceTo(targetPos);
      if (dist > 24) {
        avatar.group.position.copy(targetPos);
      } else {
        avatar.group.position.lerp(targetPos, Math.min(1, dt * 14));
      }

      // Smooth yaw facing (avatar mesh faces +Z locally; player yaw=0 faces -Z)
      const targetRotY = state.yaw + Math.PI;
      let diff = targetRotY - avatar.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      avatar.group.rotation.y += diff * Math.min(1, dt * 15);
      avatar.head.rotation.x = -state.pitch;

      // Crouch drop
      const targetBodyY = state.crouching ? -0.26 : 0;
      avatar.bodyPivot.position.y = THREE.MathUtils.lerp(avatar.bodyPivot.position.y, targetBodyY, Math.min(1, dt * 16));

      // Walking & swinging limbs
      const moving = dist > 0.04;
      if (moving) {
        avatar.walkPhase += dt * 11;
      } else {
        avatar.walkPhase = THREE.MathUtils.lerp(avatar.walkPhase, Math.round(avatar.walkPhase / Math.PI) * Math.PI, Math.min(1, dt * 8));
      }
      const legSwing = moving ? Math.sin(avatar.walkPhase) * 0.65 : 0;
      avatar.legL.rotation.x = legSwing;
      avatar.legR.rotation.x = -legSwing;
      avatar.armL.rotation.x = -legSwing * 0.8;

      if (state.swinging) {
        avatar.swingPhase += dt * 16;
        avatar.armR.rotation.x = -0.7 - Math.abs(Math.sin(avatar.swingPhase)) * 1.1;
      } else {
        avatar.swingPhase = 0;
        avatar.armR.rotation.x = legSwing * 0.8;
      }
    }
  }

  // ==================== PERSISTENCE & HUD ====================
  public buildSaveData(): WorldSaveData {
    const modifiedChunks: SerializedChunk[] = [];
    for (const ch of this.chunks.values()) {
      if (ch.modified) {
        modifiedChunks.push({
          cx: ch.cx,
          cz: ch.cz,
          rle: encodeRLE(ch.blocks),
        });
      }
    }
    this.meta.mode = this.mode;
    this.meta.timeOfDay = this.timeOfDay;
    this.meta.dayCount = this.dayCount;
    this.meta.updatedAt = Date.now();

    return {
      meta: { ...this.meta },
      player: {
        x: this.pos.x,
        y: this.pos.y,
        z: this.pos.z,
        yaw: this.yaw,
        pitch: this.pitch,
        health: this.health,
        hunger: this.hunger,
        saturation: this.saturation,
        oxygen: this.oxygen,
        isFlying: this.isFlying,
        activeSlot: this.activeSlot,
        hotbar: this.hotbar.map((s) => (s ? { ...s } : null)),
        inventory: this.inventory.map((s) => (s ? { ...s } : null)),
        armor: this.armor.map((s) => (s ? { ...s } : null)),
      },
      modifiedChunks,
      furnaces: Array.from(this.furnaces.values()).map((f) => ({
        ...f,
        input: f.input ? { ...f.input } : null,
        fuel: f.fuel ? { ...f.fuel } : null,
        output: f.output ? { ...f.output } : null,
      })),
    };
  }

  public async saveWorld(): Promise<void> {
    const data = this.buildSaveData();
    await saveWorldToDb(data);
    this.saveStatusText = 'World saved';
    this.saveStatusTimer = 2.0;
    this.pushHudSnapshot();
  }

  private pushHudSnapshot() {
    const held = this.hotbar[this.activeSlot];
    const heldName = held ? ITEM_DEFS[held.itemId]?.name ?? '' : '';
    const headBlock = this.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + this.currentEyeHeight), Math.floor(this.pos.z));
    const biome: BiomeType = this.terrain.getBiomeAt(Math.floor(this.pos.x), Math.floor(this.pos.z));

    this.onHudUpdate({
      health: this.health,
      maxHealth: this.maxHealth,
      hunger: this.hunger,
      maxHunger: this.maxHunger,
      armorDefense: this.getArmorDefense(),
      oxygen: this.oxygen,
      maxOxygen: this.maxOxygen,
      mode: this.mode,
      isFlying: this.isFlying,
      isCrouching: this.isCrouching,
      activeSlot: this.activeSlot,
      hotbar: this.hotbar.map((s) => (s ? { ...s } : null)),
      inventory: this.inventory.map((s) => (s ? { ...s } : null)),
      armor: this.armor.map((s) => (s ? { ...s } : null)),
      heldItemName: heldName,
      timeOfDay: this.timeOfDay,
      dayCount: this.dayCount,
      biome,
      coords: { x: Math.floor(this.pos.x), y: Math.floor(this.pos.y), z: Math.floor(this.pos.z) },
      fps: this.fps,
      attackCooldown: this.attackCooldown > 0 ? 1 - this.attackCooldown / 0.6 : 1,
      breakProgress: this.breakProgress,
      bowCharge: this.bowCharge,
      isUnderwater: headBlock === BlockId.Water,
      damageFlash: this.damageFlash,
      activeModal: this.activeModal,
      openFurnace: this.openFurnaceKey ? this.furnaces.get(this.openFurnaceKey) ?? null : null,
      pointerLocked: this.pointerLocked,
      showDebug: this.showDebug,
      targetBlockName: this.currentTarget ? BLOCK_DEFS[this.currentTarget.blockId].name : null,
      targetEntityName: this.targetEntity ? `${MOB_STATS[this.targetEntity.type].name} (${Math.ceil(this.targetEntity.hp)} HP)` : null,
      saveStatusText: this.saveStatusText,
      roomCode: this.mpClient?.code ?? null,
      isHost: this.mpClient?.isHost ?? false,
      onlinePlayers: Array.from(this.remotePlayers.values()).map((p) => ({
        id: p.state.id,
        name: p.state.name,
        color: p.state.color,
      })),
      chatOpen: this.chatOpen,
      chatMessages: this.chatMessages,
    });
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    if (this.pointerLockRetryTimer !== null) {
      clearTimeout(this.pointerLockRetryTimer);
      this.pointerLockRetryTimer = null;
    }

    this.mpClient?.disconnect();
    this.mpClient = null;
    for (const id of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(id);
    }

    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock?.();
    }

    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('mousedown', this.onMouseDown);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.onContextMenu);

    for (const ch of this.chunks.values()) {
      ch.opaqueMesh?.geometry.dispose();
      ch.waterMesh?.geometry.dispose();
    }
    this.chunks.clear();
    for (const tex of this.breakStageTextures) {
      tex.dispose();
    }
    this.breakOverlayMesh.geometry.dispose();
    (this.breakOverlayMesh.material as THREE.Material).dispose();
    this.targetOutline.geometry.dispose();
    (this.targetOutline.material as THREE.Material).dispose();
    this.opaqueMaterial.dispose();
    this.waterMaterial.dispose();
    this.atlasTexture.dispose();
    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}

export function createNewWorldSave(name: string, seed: number, mode: GameMode): WorldSaveData {
  const id = `world_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const hotbar: (InventorySlot | null)[] = new Array(9).fill(null);

  if (mode === 'creative') {
    const starterIds = [
      'block_grass',
      'block_stone',
      'block_planks',
      'block_oak_log',
      'block_glass',
      'block_torch',
      'block_brick',
      'diamond_pickaxe',
      'diamond_sword',
    ];
    starterIds.forEach((itemId, i) => {
      hotbar[i] = { itemId, count: ITEM_DEFS[itemId]?.maxStack ?? 64, durability: ITEM_DEFS[itemId]?.maxDurability };
    });
  }

  return {
    meta: {
      id,
      name: name.trim() || 'New World',
      seed,
      mode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      dayCount: 1,
      timeOfDay: 150,
    },
    player: {
      x: 0.5,
      y: -1, // triggers safe surface spawn
      z: 0.5,
      yaw: 0,
      pitch: 0,
      health: 20,
      hunger: 20,
      saturation: 5,
      oxygen: 20,
      isFlying: false,
      activeSlot: 0,
      hotbar,
      inventory: new Array(27).fill(null),
      armor: new Array(4).fill(null),
    },
    modifiedChunks: [],
    furnaces: [],
  };
}

export { ALL_ITEM_IDS };
