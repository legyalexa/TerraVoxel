import React from 'react';

interface DeathModalProps {
  onRespawn: () => void;
  onQuitToTitle: () => void;
}

export const DeathModal: React.FC<DeathModalProps> = ({ onRespawn, onQuitToTitle }) => {
  return (
    <div className="fixed inset-0 z-30 bg-red-950/70 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-red-500/30 rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
        <h2 className="font-display text-3xl font-bold text-red-400">You Died</h2>
        <p className="mt-2 text-sm text-slate-300">
          Your world remains intact. Respawn at the surface to continue surviving.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={onRespawn}
            className="px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap cursor-pointer"
          >
            Respawn
          </button>
          <button
            onClick={onQuitToTitle}
            className="px-5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition-colors whitespace-nowrap cursor-pointer"
          >
            Quit to Title
          </button>
        </div>
      </div>
    </div>
  );
};
