import { useEffect, useRef, useState } from 'react';
import { DeathModal } from './components/DeathModal';
import { HUD } from './components/HUD';
import { InventoryModal } from './components/InventoryModal';
import { PauseModal } from './components/PauseModal';
import { GameSessionConfig, TitleScreen } from './components/TitleScreen';
import { MultiplayerClient } from './engine/multiplayer';
import { VoxelWorld } from './engine/VoxelWorld';
import { HudSnapshot } from './types/game';

export default function App() {
  const [activeSession, setActiveSession] = useState<GameSessionConfig | null>(null);
  const [hud, setHud] = useState<HudSnapshot | null>(null);
  const [hostingOnline, setHostingOnline] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<VoxelWorld | null>(null);

  useEffect(() => {
    if (!activeSession || !canvasContainerRef.current) return;

    const world = new VoxelWorld(
      canvasContainerRef.current,
      activeSession.saveData,
      (snapshot) => {
        setHud(snapshot);
      },
      activeSession.multiplayer,
    );
    worldRef.current = world;

    return () => {
      world.dispose();
      worldRef.current = null;
      setHud(null);
      setHostingOnline(false);
      setHostError(null);
    };
  }, [activeSession]);

  const handleQuitToTitle = async () => {
    if (worldRef.current && (!activeSession?.multiplayer || hud?.isHost)) {
      await worldRef.current.saveWorld().catch(() => {});
    }
    setActiveSession(null);
  };

  const handleHostOnlineFromPause = () => {
    const world = worldRef.current;
    if (!world || hostingOnline || hud?.roomCode) return;

    setHostingOnline(true);
    setHostError(null);
    const save = world.buildSaveData();
    const playerName = localStorage.getItem('terravoxel_player_name') || 'Host';
    const client = new MultiplayerClient();

    client.setCallbacks({
      onJoined: (payload) => {
        setHostingOnline(false);
        world.attachMultiplayer(client, undefined, payload.players);
      },
      onError: (msg) => {
        setHostingOnline(false);
        setHostError(msg);
        client.disconnect();
      },
    });

    client.hostRoom({
      playerName,
      worldName: save.meta.name,
      seed: save.meta.seed,
      mode: save.meta.mode,
      timeOfDay: save.meta.timeOfDay,
      dayCount: save.meta.dayCount,
      x: save.player.x,
      y: save.player.y,
      z: save.player.z,
      initialEdits: world.exportModifiedBlockEdits(),
    });
  };

  if (!activeSession) {
    return <TitleScreen onStartSession={(session) => setActiveSession(session)} />;
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0b0f17]">
      {/* Isolated WebGL mount container */}
      <div ref={canvasContainerRef} className="fixed inset-0 w-full h-full" />

      {/* Minimalist HUD */}
      {hud && (
        <HUD
          hud={hud}
          onResumeClick={() => worldRef.current?.requestPointerLock()}
          onOpenPause={() => worldRef.current?.openModal('pause')}
          onOpenInventory={() => worldRef.current?.openModal('inventory')}
          onToggleCrouch={() => worldRef.current?.toggleCrouch()}
          onSendChat={(text) => worldRef.current?.sendChatMessage(text)}
          onCloseChat={() => worldRef.current?.closeChat()}
        />
      )}

      {/* Inventory / Crafting Table / Furnace / Creative Catalog */}
      {hud &&
        worldRef.current &&
        (hud.activeModal === 'inventory' ||
          hud.activeModal === 'crafting' ||
          hud.activeModal === 'furnace') && (
          <InventoryModal
            world={worldRef.current}
            hud={hud}
            onClose={() => worldRef.current?.closeModal()}
          />
        )}

      {/* Pause Menu */}
      {hud && worldRef.current && hud.activeModal === 'pause' && (
        <PauseModal
          world={worldRef.current}
          hud={hud}
          onResume={() => worldRef.current?.closeModal()}
          onQuitToTitle={handleQuitToTitle}
          onHostOnline={handleHostOnlineFromPause}
          hostingOnline={hostingOnline}
          hostError={hostError}
        />
      )}

      {/* Death Screen */}
      {hud && worldRef.current && hud.activeModal === 'dead' && (
        <DeathModal
          onRespawn={() => worldRef.current?.respawnPlayer()}
          onQuitToTitle={handleQuitToTitle}
        />
      )}
    </div>
  );
}
