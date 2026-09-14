import { ReactNode } from "react";

export function BoundedContainer({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl w-full px-4 md:px-6">
      {children}
    </div>
  );
}
