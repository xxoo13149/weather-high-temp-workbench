import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

const DialogPortal = ({ children }: { children: React.ReactNode }) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(3,8,14,0.76)] backdrop-blur-md" />
    {children}
  </DialogPrimitive.Portal>
);

const DialogContent = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[24px] border border-[var(--border-strong)] bg-[var(--panel)] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.48)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(56,214,180,0.26)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
));

DialogContent.displayName = "DialogContent";

export const {
  Root: Dialog,
  Trigger: DialogTrigger,
  Close: DialogClose,
  Title: DialogTitle,
  Description: DialogDescription,
} = DialogPrimitive;

export { DialogContent };
