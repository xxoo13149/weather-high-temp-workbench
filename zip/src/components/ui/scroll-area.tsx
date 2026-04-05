import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Root ref={ref} className={cn("relative overflow-hidden", className)} {...props} />
));

const ScrollViewport = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Viewport
    ref={ref}
    className={cn("h-full w-full rounded-[inherit]", className)}
    {...props}
  />
));

const ScrollBar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.Scrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors data-[orientation=vertical]:w-2",
      orientation === "vertical" ? "bg-white/5" : "h-2 bg-white/5",
      className,
    )}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb className="flex-1 rounded-full bg-[linear-gradient(180deg,rgba(56,214,180,0.38),rgba(114,229,255,0.42))]" />
  </ScrollAreaPrimitive.Scrollbar>
));

const ScrollCorner = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Corner>
>(({ className, ...props }, ref) => (
  <ScrollAreaPrimitive.Corner ref={ref} className={cn("bg-transparent", className)} {...props} />
));

ScrollArea.displayName = "ScrollArea";
ScrollViewport.displayName = "ScrollViewport";
ScrollBar.displayName = "ScrollBar";
ScrollCorner.displayName = "ScrollCorner";

export { ScrollArea, ScrollViewport, ScrollBar, ScrollCorner };
