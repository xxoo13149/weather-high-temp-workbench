import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-white/10 text-white",
        secondary: "border-white/10 bg-white/5 text-[var(--foreground)]",
        destructive: "border-[rgba(255,107,107,0.28)] bg-[rgba(255,107,107,0.15)] text-[#ffd0d0]",
        outline: "border-white/15 bg-transparent text-white/72",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => {
  return <span ref={ref} className={cn(badgeVariants({ variant, className }))} {...props} />;
});

Badge.displayName = "Badge";

export { Badge, badgeVariants };
