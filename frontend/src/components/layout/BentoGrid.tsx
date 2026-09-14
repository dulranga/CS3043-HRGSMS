import { ReactNode } from "react";

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-[minmax(12rem,auto)]">
      {children}
    </div>
  );
}
