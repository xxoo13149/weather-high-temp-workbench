import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium tracking-[0.01em] transition-all duration-200 disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(107,231,255,0.34)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[rgba(107,231,255,0.4)] bg-[linear-gradient(180deg,rgba(107,231,255,0.18),rgba(107,231,255,0.08))] text-[var(--foreground)] shadow-[0_0_0_1px_rgba(107,231,255,0.18),0_12px_32px_rgba(6,24,34,0.45)] hover:border-[rgba(107,231,255,0.56)] hover:bg-[linear-gradient(180deg,rgba(107,231,255,0.24),rgba(107,231,255,0.12))]",
        secondary:
          "border border-[var(--border-strong)] bg-[rgba(14,19,28,0.9)] text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] hover:border-white/22 hover:bg-[rgba(18,24,34,0.95)]",
        ghost:
          "border border-transparent bg-transparent text-[var(--muted-foreground)] hover:border-white/12 hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--foreground)]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-white/22 hover:bg-[rgba(255,255,255,0.03)]",
        danger:
          "border border-[rgba(255,107,107,0.34)] bg-[rgba(255,107,107,0.12)] text-[var(--danger)] shadow-[0_8px_24px_rgba(42,14,14,0.38)] hover:bg-[rgba(255,107,107,0.2)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8.5 px-3 text-[13px]",
        lg: "h-12 px-5 text-[15px]",
        icon: "h-9.5 w-9.5 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
