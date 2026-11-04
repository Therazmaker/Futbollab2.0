"use client";

import React, { useState } from "react";

interface PlayerNode {
  id: string;
  name: string;
  number: number;
  pos: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  status: "FIT" | "FATIGUED" | "CAUTION";
  energy: number;
}

const FORMATION_PRESETS: Record<string, PlayerNode[]> = {
  "4-3-1-2": [
    { id: "gk", name: "Courtois", number: 1, pos: "GK", x: 50, y: 90, status: "FIT", energy: 98 },
    { id: "rb", name: "Carvajal", number: 2, pos: "RB", x: 86, y: 72, status: "FIT", energy: 88 },
    { id: "rcb", name: "Militão", number: 3, pos: "CB", x: 62, y: 76, status: "FIT", energy: 92 },
    { id: "lcb", name: "Rüdiger", number: 22, pos: "CB", x: 38, y: 76, status: "FIT", energy: 95 },
    { id: "lb", name: "Mendy", number: 23, pos: "LB", x: 14, y: 72, status: "FIT", energy: 84 },
    { id: "cdm", name: "Tchouaméni", number: 14, pos: "CDM", x: 50, y: 55, status: "FIT", energy: 91 },
    { id: "rcm", name: "Valverde", number: 8, pos: "CM", x: 74, y: 48, status: "FIT", energy: 99 },
    { id: "lcm", name: "Camavinga", number: 12, pos: "CM", x: 26, y: 48, status: "FIT", energy: 89 },
    { id: "cam", name: "Bellingham", number: 5, pos: "CAM", x: 50, y: 32, status: "FIT", energy: 94 },
    { id: "rf", name: "Rodrygo", number: 11, pos: "ST", x: 68, y: 15, status: "FIT", energy: 86 },
    { id: "lf", name: "Vinicius Jr", number: 7, pos: "ST", x: 32, y: 15, status: "FIT", energy: 93 },
  ],
  "4-3-3": [
    { id: "gk", name: "Courtois", number: 1, pos: "GK", x: 50, y: 90, status: "FIT", energy: 98 },
    { id: "rb", name: "Carvajal", number: 2, pos: "RB", x: 86, y: 72, status: "FIT", energy: 88 },
    { id: "rcb", name: "Militão", number: 3, pos: "CB", x: 62, y: 76, status: "FIT", energy: 92 },
    { id: "lcb", name: "Rüdiger", number: 22, pos: "CB", x: 38, y: 76, status: "FIT", energy: 95 },
    { id: "lb", name: "Mendy", number: 23, pos: "LB", x: 14, y: 72, status: "FIT", energy: 84 },
    { id: "cdm", name: "Tchouaméni", number: 14, pos: "CDM", x: 50, y: 56, status: "FIT", energy: 91 },
    { id: "rcm", name: "Valverde", number: 8, pos: "CM", x: 70, y: 44, status: "FIT", energy: 99 },
    { id: "lcm", name: "Bellingham", number: 5, pos: "CM", x: 30, y: 44, status: "FIT", energy: 94 },
    { id: "rw", name: "Rodrygo", number: 11, pos: "RW", x: 82, y: 18, status: "FIT", energy: 86 },
    { id: "st", name: "Mbappé", number: 9, pos: "ST", x: 50, y: 14, status: "FIT", energy: 96 },
    { id: "lw", name: "Vinicius Jr", number: 7, pos: "LW", x: 18, y: 18, status: "FIT", energy: 93 },
  ],
};

interface TacticalPitchProps {
  currentFormation: string;
  onSelectPlayer?: (player: PlayerNode) => void;
}

export function TacticalPitch({ currentFormation, onSelectPlayer }: TacticalPitchProps) {
  const [selectedNode, setSelectedNode] = useState<PlayerNode | null>(null);
  const nodes = FORMATION_PRESETS[currentFormation] || FORMATION_PRESETS["4-3-1-2"];

  const handleNodeClick = (node: PlayerNode) => {
    setSelectedNode(node);
    if (onSelectPlayer) {
      onSelectPlayer(node);
    }
  };

  return (
    <div className="relative w-full aspect-[4/5] bg-gradient-to-b from-[#0a1610] via-[#0b1b13] to-[#0a1610] rounded-2xl overflow-hidden border border-primary/30 p-2 shadow-2xl">
      {/* Pitch Markings */}
      <div className="absolute inset-2 border-2 border-primary/20 rounded-xl pointer-events-none">
        {/* Halfway line */}
        <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-primary/20"></div>
        {/* Center circle */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full border border-primary/20"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary/40"></div>
        {/* Penalty area top */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-20 border-b border-x border-primary/20"></div>
        {/* Penalty area bottom */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-20 border-t border-x border-primary/20"></div>
      </div>

      {/* Interactive Player Nodes */}
      {nodes.map((node) => {
        const isSelected = selectedNode?.id === node.id;
        return (
          <div
            key={node.id}
            onClick={() => handleNodeClick(node)}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-110 active:scale-95 group z-20"
          >
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center font-mono text-xs font-bold transition-all shadow-lg ${
                  node.pos === "GK"
                    ? "bg-amber-400 text-black border-2 border-amber-300"
                    : isSelected
                    ? "bg-secondary text-black ring-4 ring-secondary/40 shadow-[0_0_16px_#4cd7f6]"
                    : node.id === "cam" || node.id === "lcm"
                    ? "bg-primary text-black border-2 border-primary ring-2 ring-primary/30"
                    : "bg-surface-container-highest text-on-surface border border-primary/40"
                }`}
              >
                {node.number}
              </div>
              <span className="font-mono text-[9px] font-bold text-on-surface bg-surface-container-lowest/80 px-1 py-0.2 rounded mt-0.5 border border-outline-variant/30 whitespace-nowrap">
                {node.name}
              </span>
            </div>
          </div>
        );
      })}

      {/* Floating Tactical Overlay when a node is selected */}
      {selectedNode && (
        <div className="absolute bottom-3 inset-x-3 bg-surface/90 backdrop-blur-md rounded-xl p-2.5 border border-primary/40 flex items-center justify-between z-30 shadow-xl">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary font-mono text-xs font-bold flex items-center justify-center border border-primary/40">
              #{selectedNode.number}
            </span>
            <div>
              <p className="font-mono text-xs font-bold text-on-surface">{selectedNode.name}</p>
              <p className="font-mono text-[10px] text-secondary">
                {selectedNode.pos} • Energy {selectedNode.energy}%
              </p>
            </div>
          </div>

          <button
            onClick={() => setSelectedNode(null)}
            className="text-on-surface-variant hover:text-primary text-xs font-mono px-2 py-1 rounded bg-surface-container"
          >
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
