import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ReportChart } from '../src/components/reports/ReportChart.tsx';
import {
  colomboMonthLabel,
  guestHistorySeries,
  isChartReport,
  occupancySeries,
  revenueSeries,
  serviceUsageSeries,
} from '../src/lib/reportCharts.ts';

test('only the chartable reports are charted', () => {
  for (const report of ['occupancy', 'revenue', 'service-usage', 'preference-trends', 'guest-history'] as const) {
    assert.equal(isChartReport(report), true, report);
  }
  assert.equal(isChartReport('billing'), false);
  assert.equal(isChartReport('audit-logs'), false);
});

test('occupancy series parses view columns and ranks branches by rate', () => {
  const rows = [
    { branch_id: 'b-3', branch_name: 'Galle', total_rooms: '14', occupied_rooms: '6', occupancy_rate_percentage: '42.86' },
    { branch_id: 'b-1', branch_name: 'Colombo', total_rooms: '26', occupied_rooms: '20', occupancy_rate_percentage: '76.92' },
    { branch_id: 'b-2', branch_name: 'Kandy', total_rooms: '0', occupied_rooms: '0', occupancy_rate_percentage: null },
  ];
  assert.deepEqual(occupancySeries(rows), [
    { branch: 'Colombo', occupiedRooms: 20, totalRooms: 26, occupancyRate: 76.92 },
    { branch: 'Galle', occupiedRooms: 6, totalRooms: 14, occupancyRate: 42.86 },
    { branch: 'Kandy', occupiedRooms: 0, totalRooms: 0, occupancyRate: 0 },
  ]);
  assert.deepEqual(occupancySeries([]), []);
});

test('revenue series aggregates branches per month exactly and orders oldest first', () => {
  const rows = [
    // The view orders revenue_month DESC; two branches share October 2026.
    { branch_id: 'b-1', branch_name: 'Colombo', revenue_month: '2026-09-30T18:30:00.000Z', total_revenue_lkr: '900.75', room_revenue_lkr: '600.50', service_revenue_lkr: '200.25', other_revenue_lkr: '100.00' },
    { branch_id: 'b-2', branch_name: 'Galle', revenue_month: '2026-09-30T18:30:00.000Z', total_revenue_lkr: '99.25', room_revenue_lkr: '50.00', service_revenue_lkr: '25.25', other_revenue_lkr: '24.00' },
    { branch_id: 'b-1', branch_name: 'Colombo', revenue_month: '2026-08-31T18:30:00.000Z', total_revenue_lkr: '500.00', room_revenue_lkr: '400.00', service_revenue_lkr: '100.00', other_revenue_lkr: '0.00' },
  ];
  const series = revenueSeries(rows);
  assert.equal(series.length, 2);
  assert.deepEqual(series.map((datum) => datum.month), [
    '2026-08-31T18:30:00.000Z',
    '2026-09-30T18:30:00.000Z',
  ]);
  // September bucket: 600.50+50 room, 200.25+25.25 service, 100+24 other —
  // summed as exact text, never binary floats.
  const september = series[1];
  assert.equal(september.room, 650.5);
  assert.equal(september.service, 225.5);
  assert.equal(september.other, 124);
  assert.equal(september.total, 1000);
  assert.equal(september.roomLabel, 'LKR 650.50');
  assert.equal(september.totalLabel, 'LKR 1,000.00');
  // The view groups months in Asia/Colombo: this instant is 1 October there.
  assert.equal(september.monthLabel, 'Oct 2026');
  assert.equal(series[0].monthLabel, 'Sep 2026');
  assert.deepEqual(revenueSeries([]), []);
});

test('colombo month labels respect the view timezone at month boundaries', () => {
  // 31 Dec 2026 18:30Z is 1 January 2027 in Colombo.
  assert.equal(colomboMonthLabel('2026-12-31T18:30:00.000Z'), 'Jan 2027');
  // Unparseable input is surfaced verbatim rather than silently dropped.
  assert.equal(colomboMonthLabel('not-a-date'), 'not-a-date');
});

test('service usage series ranks by revenue or quantity with a row budget', () => {
  const rows = [
    { service_id: 's-1', service_name: 'Airport Transfer', category: 'TRANSPORT', total_orders: '9', total_quantity_consumed: '12', total_revenue_generated: '45000.00' },
    { service_id: 's-2', service_name: 'Spa Massage', category: 'WELLNESS', total_orders: '14', total_quantity_consumed: '20', total_revenue_generated: '96000.00' },
    { service_id: 's-3', service_name: 'Breakfast', category: 'DINING', total_orders: '30', total_quantity_consumed: '40', total_revenue_generated: '6000.00' },
    { service_id: 's-4', service_name: 'Laundry', category: 'HOUSEKEEPING', total_orders: '10', total_quantity_consumed: '12', total_revenue_generated: '45000.00' },
  ];
  const byRevenue = serviceUsageSeries(rows, 'revenue', 3);
  assert.deepEqual(byRevenue.map((datum) => datum.service), ['Spa Massage', 'Laundry', 'Airport Transfer']);
  assert.equal(byRevenue[0].revenueLabel, 'LKR 96,000.00');
  // Equal revenue ties are broken by orders (more orders first), then name.
  assert.equal(byRevenue[1].orders, 10);
  assert.equal(byRevenue[2].orders, 9);
  const byQuantity = serviceUsageSeries(rows, 'quantity', 3);
  assert.deepEqual(byQuantity.map((datum) => datum.service), ['Breakfast', 'Spa Massage', 'Laundry']);
  assert.equal(byQuantity.length, 3);
  assert.deepEqual(serviceUsageSeries([], 'revenue', 5), []);
});

test('guest history series ranks top guests by lifetime expenditure', () => {
  const rows = [
    { guest_id: 'g-1', full_name: 'Ann Perera', lifetime_expenditure: '15000.00', total_stays: '2' },
    { guest_id: 'g-2', full_name: 'Bin Fernando', lifetime_expenditure: '48000.50', total_stays: '5' },
    { guest_id: 'g-3', full_name: 'Cara Silva', lifetime_expenditure: '48000.50', total_stays: '8' },
    { guest_id: 'g-4', full_name: 'Dil Raj', lifetime_expenditure: '0.00', total_stays: '1' },
  ];
  const series = guestHistorySeries(rows, 3);
  assert.deepEqual(series.map((datum) => datum.guest), ['Cara Silva', 'Bin Fernando', 'Ann Perera']);
  assert.equal(series[0].expenditureLabel, 'LKR 48,000.50');
  assert.equal(series[0].stays, 8);
  assert.deepEqual(guestHistorySeries([]), []);
});

test('the chart panel renders on shadcn primitives and hides when it has nothing to show', () => {
  const occupancy = renderToStaticMarkup(
    <ReportChart
      report="occupancy"
      rows={[{ branch_name: 'Colombo', total_rooms: '26', occupied_rooms: '20', occupancy_rate_percentage: '76.92' }]}
    />,
  );
  assert.ok(occupancy.includes('Occupancy by branch'));
  assert.ok(occupancy.includes('data-slot="chart"'));
  // Category ticks paint in static markup; the numeric axis renders rounded ticks.
  assert.ok(occupancy.includes('Colombo'));

  const revenue = renderToStaticMarkup(
    <ReportChart
      report="revenue"
      rows={[{ branch_name: 'Colombo', revenue_month: '2026-09-30T18:30:00.000Z', total_revenue_lkr: '100.00', room_revenue_lkr: '60.00', service_revenue_lkr: '40.00', other_revenue_lkr: '0.00' }]}
    />,
  );
  assert.ok(revenue.includes('Monthly billed revenue'));
  assert.ok(revenue.includes('Oct 2026'));

  const trends = renderToStaticMarkup(
    <ReportChart
      report="preference-trends"
      rankBy="quantity"
      limit={5}
      rows={[{ service_name: 'Breakfast', category: 'DINING', total_orders: '30', total_quantity_consumed: '40', total_revenue_generated: '6000.00' }]}
    />,
  );
  assert.ok(trends.includes('Top guest preferences'));
  assert.ok(trends.includes('Breakfast'));

  // Billing and audit rows stay table-only; empty rows render nothing.
  assert.equal(renderToStaticMarkup(<ReportChart report="billing" rows={[{ booking_ref: 'BK-1' }]} />), '');
  assert.equal(renderToStaticMarkup(<ReportChart report="occupancy" rows={[]} />), '');
  assert.equal(renderToStaticMarkup(<ReportChart report="revenue" rows={[]} />), '');
});
