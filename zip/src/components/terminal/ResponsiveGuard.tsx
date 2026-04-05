import React from "react";

import { UI_TEXT } from "../../display-text";

export const ResponsiveGuard: React.FC = () => (
  <div className="terminal-responsive-guard" aria-hidden="true">
    <div className="terminal-responsive-guard__content">
      <span>{UI_TEXT.responsiveGuard.message}</span>
    </div>
  </div>
);