import { Link } from '@tanstack/react-router';
import { Ban, CreditCard, LogOut, ReceiptText, ShieldAlert, UserCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useFeatureSessions } from '@/components/auth/useFeatureSessions';
import {
  type BillingFlowPath,
  type BillingFlowSearch,
  billingFlowSearch,
  visibleBillingSteps,
} from '@/lib/billingFlow';
import { cn } from '@/lib/utils';

const STEP_ICONS: Record<BillingFlowPath, LucideIcon> = {
  '/dashboard/check-in': UserCheck,
  '/dashboard/billing/invoice': ReceiptText,
  '/dashboard/billing/payments': CreditCard,
  '/dashboard/billing/checkout': LogOut,
  '/dashboard/billing/cancellation': Ban,
  '/dashboard/billing/no-show': ShieldAlert,
};

export interface BillingFlowNavProps {
  current: BillingFlowPath;
  booking?: string | null;
  label?: string | null;
  className?: string;
}

/**
 * A working breadcrumb across the billing journey. Each step is a link that
 * carries the current booking, so front desk can jump from a blocked checkout
 * straight to payments and back without re-entering the booking. Steps the role
 * cannot open are hidden.
 */
export function BillingFlowNav({ current, booking, label, className }: BillingFlowNavProps) {
  const { role } = useFeatureSessions();
  const steps = visibleBillingSteps(role);
  const search: BillingFlowSearch = billingFlowSearch(booking, label);

  if (steps.length <= 1) return null;

  return (
    <nav
      aria-label="Billing workflow"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-2xl border-2 border-border bg-card p-2 shadow-sm',
        className,
      )}
    >
      <span className="px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Front desk flow
      </span>
      {steps.map((step) => {
        const Icon = STEP_ICONS[step.path];
        const active = step.path === current;
        return (
          <Button
            key={step.path}
            asChild
            size="sm"
            variant={active ? 'default' : 'ghost'}
            title={step.description}
          >
            <Link to={step.path} search={search} aria-current={active ? 'step' : undefined}>
              <Icon aria-hidden="true" />
              {step.label}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
