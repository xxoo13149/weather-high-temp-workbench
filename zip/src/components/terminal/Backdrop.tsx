import React from "react";

// Legacy backdrop (do not confuse with ./TerminalBackdrop).
export const LegacyBackdrop = () => (
  <div className="terminal-backdrop">
    <div className="terminal-backdrop-glow top" />
    <div className="terminal-backdrop-glow bottom" />
    <div className="terminal-backdrop-grid" />
  </div>
);
