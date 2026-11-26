# TerraVoxel

A 3D first-person voxel sandbox survival and block-building game built with **React**, **TypeScript**, **Three.js**, **Tailwind CSS**, and an **Express + WebSocket** multiplayer server, featuring procedural terrain, crafting, smelting, mobs, online co-op via 6-digit room codes, and one-click Windows `.exe` (`.zip`) packaging.

---

## Features

### Procedural Voxel World & Lighting
- **Infinite Chunked Terrain:** `16 × 16 × 256` chunks generated via multi-octave Simplex/Perlin noise across **Forests**, **Plains**, **Deserts**, **Mountains**, **Oceans**, and underground cave networks with ore veins.
- **Optimized Meshing & Lighting:** Face-culled/greedy chunk meshing with vertex ambient occlusion, sunlight propagation, and emissive block light (torches, lava).
- **20-Minute Day-Night Cycle:** Real-time transitions across daytime, sunset, nighttime, and sunrise with dynamic sky colors and orbiting sun/moon.
- **Animated Block Breaking:** 10-stage fracture crack overlay, material-matched chip particles, and rhythmic tool/hand swing animation.

### Game Modes
- **Survival Mode:** Start empty-handed, gather resources, manage 20 HP (10 hearts) and 20 hunger points (10 drumsticks), craft gear, and survive nighttime monsters.
- **Creative Mode:** Searchable catalog of all blocks and items, instant block breaking, invulnerability, and double-tap `Space` flight.

### Crafting, Smelting & Progression
- **Crafting Grids:** `2×2` personal inventory crafting and `3×3` **Crafting Table** supporting both shaped and shapeless recipes.
- **Furnace Smelting:** Consume fuel (coal, wood planks, logs) to smelt raw ores into ingots and cook raw food.
- **Tiered Tools, Weapons & Armor:** Wood → Stone → Iron → Diamond progression for mining speeds, durability, melee damage, plus Helmet, Chestplate, Leggings, and Boots damage reduction.

### Entities & Combat
- **Passive Mobs:** Pigs, Cows, Sheep, and Chickens that wander, flee when struck, and drop food/materials.
- **Hostile Mobs:** Zombies (melee, burn in sunlight), Skeletons (ranged bow & arrow, burn in sunlight), Creepers (silent ambush & block-destroying detonation), and Spiders (fast melee, wall climbing).
- **Combat Physics:** Attack cooldowns, falling critical hits, knockback impulses, and chargeable bow/arrow projectiles.

### Online Co-op & Persistence
- **6-Digit Room Code Multiplayer:** Host any new or saved world online (or mid-session from the pause menu) and let friends join with a 6-digit code.
- **Resilient Multi-Transport Sync:** Uses WebSockets (`/ws`), automatic HTTP polling fallback (`/api/mp/*`), and PeerJS WebRTC cross-origin bridging with synced block edits, 3D player avatars, and in-game chat (`T`).
- **World Save / Load:** Automatic IndexedDB persistence plus `.json` world save export and import.
- **Windows Desktop Package:** Built-in title screen **Download Windows .EXE (.zip)** button that packages `TerraVoxel.exe` (`TerraVoxel-Windows-x64.zip`) for standalone Windows x64 play.

---

## Controls

| Input | Action |
| :--- | :--- |
| `W` `A` `S` `D` | Move |
| `Space` | Jump / Double-tap to Fly (Creative) |
| `Shift` | Sprint / Descend (while flying) |
| `C` / `Left Ctrl` / `V` | Crouch (hold or toggle; includes HUD Crouch button & ledge edge-guard) |
| `Left Click` | Mine block / Melee attack |
| `Right Click` | Place block / Open Crafting Table or Furnace / Eat / Shoot bow |
| `1`–`9` / Mouse Wheel | Select hotbar slot |
| `E` | Open Inventory & Crafting |
| `Q` | Drop held item |
| `T` | Open Online Chat |
| `F3` | Toggle debug coordinates & biome overlay |
| `Esc` | Pause menu / World settings / Host Online |

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Three.js (`0.187`), Tailwind CSS v4, Lucide Icons
- **Backend & Multiplayer:** Express, `ws` WebSockets, PeerJS WebRTC (`1.5`), `tsx`
- **Build & Tooling:** Vite 8, Python 3 (`zipfile` packager for Windows `.zip` export)

---

## Getting Started

### Prerequisites
- **Node.js** `20+`
- **Python 3** *(optional — only needed on the server if using the in-app **Download Windows .EXE (.zip)** packager)*

### Installation & Local Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

### Production Build & Server

```bash
npm run build
npm start
```

### Type Checking

```bash
npm run lint
```

---

## Windows Standalone `.exe` Packaging

The title screen includes a **Download Windows .EXE (.zip)** action backed by `/api/prepare-windows-zip` and `/api/windows-zip-chunk`:

1. Compiles the latest production bundle (`dist/`).
2. Downloads and caches the Windows x64 Electron runtime (`v33.3.1`).
3. Assembles `TerraVoxel-Windows-x64.zip` containing `TerraVoxel.exe`, `main.cjs` (in-process static server on `127.0.0.1` preserving IndexedDB saves + PeerJS multiplayer), and the compiled game bundle.
4. On Windows, extract **all** files from the `.zip` into a folder and double-click `TerraVoxel.exe` (`F11` toggles fullscreen).

---

## Project Structure

```text
├── index.html
├── metadata.json
├── package.json
├── server.ts                  # Express server, WS + HTTP multiplayer, Windows zip endpoints
├── server/
│   └── windowsPackager.ts     # Automated Windows x64 Electron .exe zip builder
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── DeathModal.tsx
│   │   ├── HUD.tsx
│   │   ├── InventoryModal.tsx
│   │   ├── ItemIcon.tsx
│   │   ├── PauseModal.tsx
│   │   └── TitleScreen.tsx
│   ├── engine/
│   │   ├── VoxelWorld.ts      # Core 3D world loop, physics, player, breaking, crouch
│   │   ├── audio.ts           # Procedural Web Audio foley synthesizer
│   │   ├── chunkMesher.ts     # Chunk meshing & RLE serialization
│   │   ├── constants.ts       # Block/item definitions, tools, armor, textures
│   │   ├── crafting.ts        # 2x2 / 3x3 recipes & furnace smelting registry
│   │   ├── mobs.ts            # Passive & hostile mob AI + 3D models
│   │   ├── multiplayer.ts     # WebSocket + HTTP fallback + PeerJS client
│   │   ├── noise.ts           # Simplex noise & biome/cave terrain generator
│   │   ├── raycast.ts         # Voxel DDA raycaster
│   │   ├── storage.ts         # IndexedDB & JSON import/export
│   │   └── textures.ts        # Procedural pixel-art block & fracture atlas
│   └── types/
│       └── game.ts
└── vite.config.ts
```
