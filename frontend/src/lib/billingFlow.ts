import { useCallback } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';

import type { StaffRole } from './roomAdministration';
import { canViewStaffPage } from './staffNavigation';

/**
 * Shared state for the front-desk billing journey. The selected booking travels
 * between the check-in, invoice, payments, checkout, cancellation and no-show
 * screens through the URL, so staff never re-search a booking when they move to
 * the next step and a link can be shared or bookmarked mid-flow.
 */
export interface BillingFlowSearch {
  booking?: string;
  label?: string;
}

/** Every screen that participates in the guided billing flow. */
export type BillingFlowPath =
  | '/dashboard/check-in'
  | '/dashboard/billing/invoice'
  | '/dashboard/billing/payments'
  | '/dashboard/billing/checkout'
  | '/dashboard/billing/cancellation'
  | '/dashboard/billing/no-show';

export interface BillingFlowStep {
  path: BillingFlowPath;
  label: string;
  description: string;
}

/**
 * The order a front-desk officer naturally works through: admit the guest,
 * review the bill, settle it, then release the room. Cancellation and no-show
 * are the alternate endings for a booking that never arrives.
 */
export const BILLING_FLOW_STEPS: readonly BillingFlowStep[] = [
  {
    path: '/dashboard/check-in',
    label: 'Check-in',
    description: 'Admit the guest and start the stay',
  },
  {
    path: '/dashboard/billing/invoice',
    label: 'Invoice',
    description: 'Review charges and the running balance',
  },
  {
    path: '/dashboard/billing/payments',
    label: 'Payments',
    description: 'Record a payment or refund a credit',
  },
  {
    path: '/dashboard/billing/checkout',
    label: 'Checkout',
    description: 'Release rooms once the balance is zero',
  },
  {
    path: '/dashboard/billing/cancellation',
    label: 'Cancellation',
    description: 'Cancel booked room lines',
  },
  {
    path: '/dashboard/billing/no-show',
    label: 'No-show',
    description: 'Charge the policy fee after the cutoff',
  },
];

/** Parses `?booking=&label=` for every billing-flow route. */
export function validateBillingFlowSearch(search: Record<string, unknown>): BillingFlowSearch {
  const booking = typeof search.booking === 'string' ? search.booking.trim() : '';
  const label = typeof search.label === 'string' ? search.label.trim() : '';
  return { booking: booking || undefined, label: label || undefined };
}

/** Builds a clean search object, omitting empty values so URLs stay tidy. */
export function billingFlowSearch(
  booking?: string | null,
  label?: string | null,
): BillingFlowSearch {
  const result: BillingFlowSearch = {};
  if (booking) result.booking = booking;
  if (label) result.label = label;
  return result;
}

/** Steps the current role is allowed to open, in workflow order. */
export function visibleBillingSteps(role: StaffRole | null | undefined): BillingFlowStep[] {
  return BILLING_FLOW_STEPS.filter((step) => canViewStaffPage(role ?? null, step.path));
}

export interface UseBillingBookingResult {
  /** Booking identifier carried in the URL, if any. */
  booking: string | undefined;
  /** Human-readable label carried in the URL, for confirmations. */
  label: string | undefined;
  /** Persist a picked booking into the URL for this page (and the next). */
  select: (booking: string, label: string) => void;
  /** Clear the carried booking from the URL. */
  clear: () => void;
}

/**
 * Reads and writes the billing-flow booking for a page. Booking selection is
 * URL state, so `useEffect(() => load(booking))` reloads exactly when the
 * carried booking changes, whether it was picked here or arrived from the
 * previous step.
 */
export function useBillingBooking(from: BillingFlowPath): UseBillingBookingResult {
  const search = useSearch({ from });
  const navigate = useNavigate();

  const select = useCallback(
    (booking: string, label: string) => {
      void navigate({ to: from, search: { booking, label }, replace: true });
    },
    [navigate, from],
  );

  const clear = useCallback(() => {
    void navigate({ to: from, search: {}, replace: true });
  }, [navigate, from]);

  return { booking: search.booking, label: search.label, select, clear };
}
