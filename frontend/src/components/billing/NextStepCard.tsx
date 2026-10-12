import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import {
  type BillingFlowPath,
  type BillingFlowSearch,
  billingFlowSearch,
} from '@/lib/billingFlow';
import { canViewStaffPage } from '@/lib/staffNavigation';
import { cn } from '@/lib/utils';

export interface BillingFlowAction {
  label: string;
  to: BillingFlowPath;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
}

export interface NextStepCardProps {
  /** Visual tone: informational guidance, a blocker, or a completed step. */
  tone?: 'info' | 'warning' | 'success';
  title: string;
  description?: ReactNode;
  /** Actions are filtered to the role's permissions before rendering. */
  actions?: BillingFlowAction[];
  booking?: string | null;
  label?: string | null;
  className?: string;
}

const TONE_STYLES: Record<NonNullable<NextStepCardProps['tone']>, string> = {
  info: 'border-border',
  warning: 'border-destructive/40',
  success: 'border-border',
};

const TONE_ICON_STYLES: Record<NonNullable<NextStepCardProps['tone']>, string> = {
  info: 'text-accent',
  warning: 'text-destructive',
  success: 'text-foreground',
};

/**
 * A guided callout that turns a guarded state ("checkout blocked", "balance
 * settled", "action complete") into an obvious next move. Every action is a
 * link that carries the current booking forward, and actions the signed-in role
 * cannot open are dropped rather than shown as a misleading dead end.
 */
export function NextStepCard({
  tone = 'info',
  title,
  description,
  actions = [],
  booking,
  label,
  className,
}: NextStepCardProps) {
  const { role } = useFeatureSessions();
  const search: BillingFlowSearch = billingFlowSearch(booking, label);

  const allowed = actions.filter((action) => canViewStaffPage(role ?? null, action.to));
  // Guidance without an action for this role is noise (and can mislead, e.g. an
  // auditor told to check out), so the card only appears when it is actionable.
  if (allowed.length === 0) return null;

  const Icon = tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;

  return (
    <Card className={cn('shadow-md', TONE_STYLES[tone], className)}>
      <CardContent className="flex items-start gap-3 p-4">
        <Icon className={cn('mt-0.5 size-5 shrink-0', TONE_ICON_STYLES[tone])} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          {description ? (
            <div className="text-sm leading-relaxed text-muted-foreground">{description}</div>
          ) : null}
          {allowed.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {allowed.map((action, index) => (
                <Button
                  key={`${action.to}:${action.label}`}
                  asChild
                  size="sm"
                  variant={action.variant ?? (index === 0 ? 'default' : 'outline')}
                >
                  <Link to={action.to} search={search}>
                    {action.label}
                    {index === 0 ? <ArrowRight aria-hidden="true" /> : null}
                  </Link>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
