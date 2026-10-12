import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <div className="relative w-full">
        <select
          ref={ref}
          data-slot="native-select"
          className={cn(
            "flex h-11 w-full appearance-none rounded-xl border-2 border-border bg-card px-4 py-2 pr-10 text-sm shadow-sm transition-all duration-150 ease-[cubic-bezier(0.45,0.15,0.55,0.85)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 hover:border-border/80 aria-invalid:border-destructive",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    );
  }
);
NativeSelect.displayName = "NativeSelect";

const NativeSelectOption = React.forwardRef<HTMLOptionElement, React.OptionHTMLAttributes<HTMLOptionElement>>(
  (props, ref) => <option ref={ref} data-slot="native-select-option" {...props} />
);
NativeSelectOption.displayName = "NativeSelectOption";

export { NativeSelect, NativeSelectOption };
