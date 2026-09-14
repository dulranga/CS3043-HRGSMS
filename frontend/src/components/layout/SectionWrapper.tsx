import { ReactNode } from "react";

export function SectionWrapper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`py-8 md:py-12 ${className}`}>
      {children}
    </section>
  );
}
