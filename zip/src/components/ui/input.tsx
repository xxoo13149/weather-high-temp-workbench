import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, ...props }, ref) => {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-[14px] border border-[var(--border)] bg-[rgba(12,18,27,0.9)] px-3.5 py-2 text-sm text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition-all placeholder:text-[var(--muted-foreground)] focus-visible:border-[rgba(107,231,255,0.65)] focus-visible:ring-2 focus-visible:ring-[rgba(107,231,255,0.18)]",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
