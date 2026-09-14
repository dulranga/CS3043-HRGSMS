import { ReactNode } from "react";

export function PageContainer({ children }: { children: ReactNode }) {
  return (
    <section className="w-full px-4 md:px-6 py-6 md:py-8">
      {children}
    </section>
  );
}
