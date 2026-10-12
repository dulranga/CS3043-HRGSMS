import { ReactNode } from 'react';
import { PublicHeader } from './PublicHeader';

// Shared frame for sign-in and registration so they match the public pages.
export function AuthLayout({
  activePath,
  eyebrow,
  title,
  description,
  children,
}: {
  activePath: string;
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground antialiased">
      <PublicHeader activePath={activePath} />
      <main className="relative flex-1 overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute -left-32 top-10 size-96 rounded-full bg-secondary/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 bottom-0 size-80 rounded-full bg-muted/30 blur-3xl" />

        <div className="relative mx-auto flex w-full max-w-md flex-col px-4 py-12 md:py-16">
          <div className="mb-8 text-center">
            {eyebrow && (
              <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-secondary/60 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary" />
                {eyebrow}
              </p>
            )}
            <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
            {description && (
              <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">{description}</p>
            )}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
