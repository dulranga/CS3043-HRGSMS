import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ServiceCataloguePanel } from '../src/components/catalogue/ServiceCataloguePanel.tsx';
import {
  CatalogueCapabilities,
  CatalogueRole,
  ServiceRecord,
  parseServiceList,
  resolveCatalogueCapabilities,
} from '../src/lib/serviceCatalogueViewModel.ts';

const SERVICES: ServiceRecord[] = parseServiceList([
  {
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    name: 'Room Service',
    category: 'DINING',
    current_price: '1250.50',
    active: true,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
  },
  {
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d02',
    name: 'Spa Massage',
    category: 'WELLNESS',
    current_price: '4800.00',
    active: false,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
  },
]);

function render(
  role: CatalogueRole | null,
  overrides: Partial<React.ComponentProps<typeof ServiceCataloguePanel>> = {},
): string {
  const capabilities: CatalogueCapabilities = resolveCatalogueCapabilities(role);

  return renderToStaticMarkup(
    <ServiceCataloguePanel
      services={SERVICES}
      capabilities={capabilities}
      filter="all"
      onFilterChange={() => {}}
      draft={{ name: '', category: '', price: '' }}
      draftErrors={{}}
      savingServiceId={null}
      isCreating={false}
      writeFailure={null}
      onDraftChange={() => {}}
      onCreate={() => {}}
      onToggleActive={() => {}}
      onEditPrice={() => {}}
      {...overrides}
    />,
  );
}

test('CHAIN_MANAGER sees enabled create, price and active-state controls', () => {
  const markup = render('CHAIN_MANAGER');

  assert.match(markup, /Chain Manager access/);
  assert.doesNotMatch(markup, /Chain Manager may change/);
  assert.match(markup, /type="submit">Add service<\/button>/);
  assert.doesNotMatch(markup, /type="submit"[^>]*disabled=""/);
  assert.doesNotMatch(markup, /id="price-[^"]+"[^>]*\sdisabled=""/);
  // The save button stays disabled only because the price is unchanged, not
  // because of permissions; only the input and toggle are permission-gated.
  assert.match(markup, /disabled=""[^>]*>Save price</);
  assert.doesNotMatch(markup, /disabled=""[^>]*>Deactivate</);
  assert.match(markup, />Activate</);
});

test('FRONT_DESK and SERVICE_STAFF cannot edit prices and are pointed at usage recording', () => {
  for (const role of ['FRONT_DESK', 'SERVICE_STAFF'] as CatalogueRole[]) {
    const markup = render(role);

    assert.match(markup, /Only a Chain Manager may add a service/);
    assert.match(markup, /Only a Chain Manager may change a service price/);
    assert.match(markup, /Only a Chain Manager may activate or deactivate a service/);
    assert.match(markup, /may record service usage for an active stay/);
    assert.match(markup, new RegExp(`Signed in as ${role}`));

    assert.match(markup, /type="submit"[^>]*disabled=""/);
    assert.match(markup, /id="price-[^"]+"[^>]*\sdisabled=""/);
    assert.match(markup, /disabled=""[^>]*>Save price</);
    assert.match(markup, /disabled=""[^>]*>Deactivate</);
    assert.doesNotMatch(markup, /Chain Manager access/);
  }
});

test('BRANCH_MANAGER, SYSTEM_ADMINISTRATOR and AUDITOR render the AT-24 read-only state', () => {
  for (const role of ['BRANCH_MANAGER', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as CatalogueRole[]) {
    const markup = render(role);

    assert.match(markup, /Only a Chain Manager may change the chain-wide service catalogue/);
    assert.match(markup, new RegExp(`Signed in as ${role}`));
    assert.match(markup, /type="submit"[^>]*disabled=""/);
    assert.match(markup, /disabled=""[^>]*>Save price</);
    assert.doesNotMatch(markup, /record service usage for an active stay/);
  }
});

test('an unknown actor renders read-only controls with no assumed role', () => {
  const markup = render(null);

  assert.match(markup, /not a Chain Manager/);
  assert.doesNotMatch(markup, /Signed in as/);
  assert.match(markup, /type="submit"[^>]*disabled=""/);
  assert.match(markup, /disabled=""[^>]*>Save price</);
});

test('a server 403 denial surfaces as an alert above the catalogue', () => {
  const markup = render('CHAIN_MANAGER', {
    writeFailure: {
      status: 403,
      code: 'CATALOGUE_FORBIDDEN',
      message: 'Only CHAIN_MANAGER may change the service catalogue.',
    },
  });

  assert.match(markup, /role="alert"/);
  assert.match(
    markup,
    /Only a Chain Manager may change the chain-wide service catalogue\. The server rejected this change\./,
  );
});

test('a validation failure keeps the service message and is not shown as an AT-24 denial', () => {
  const markup = render('CHAIN_MANAGER', {
    writeFailure: { status: 400, code: 'VALIDATION_ERROR', message: 'Service price must be a non-negative number.' },
  });

  assert.match(markup, /role="alert"/);
  assert.match(markup, /Service price must be a non-negative number\./);
  assert.doesNotMatch(markup, /The server rejected this change/);
});

test('the panel renders price, category and active state for every listed service', () => {
  const markup = render('CHAIN_MANAGER');

  assert.match(markup, /Room Service/);
  assert.match(markup, /Spa Massage/);
  assert.match(markup, /DINING/);
  assert.match(markup, /WELLNESS/);
  assert.match(markup, /LKR 1,250\.50/);
  assert.match(markup, /LKR 4,800\.00/);
  assert.match(markup, /ACTIVE/);
  assert.match(markup, /INACTIVE/);
  assert.match(markup, /overflow-x-auto/);
  assert.match(markup, /md:grid-cols-2/);
  assert.match(markup, /xl:grid-cols-3/);
});

test('FR-042 completeness copy reflects the loaded catalogue', () => {
  const thin = render('CHAIN_MANAGER');
  assert.match(thin, /FR-042 requires at least six/);
  assert.match(thin, /missing: laundry, minibar-related/);

  const complete = render('CHAIN_MANAGER', {
    services: parseServiceList([
      { service_id: 'a', name: 'Room Service', category: 'DINING', current_price: '1', active: true },
      { service_id: 'b', name: 'Spa Massage', category: 'WELLNESS', current_price: '1', active: true },
      { service_id: 'c', name: 'Laundry Pressing', category: 'LAUNDRY', current_price: '1', active: true },
      { service_id: 'd', name: 'Minibar Restock', category: 'DINING', current_price: '1', active: true },
      { service_id: 'e', name: 'Airport Transfer', category: 'TRANSPORT', current_price: '1', active: true },
      { service_id: 'f', name: 'Late Checkout', category: 'ROOM', current_price: '1', active: true },
    ]),
  });
  assert.match(complete, /covers every required category/);
});

test('an empty catalogue renders the filter empty state instead of service cards', () => {
  const markup = render('CHAIN_MANAGER', { services: [] });

  assert.match(markup, /No services match this filter/);
  assert.doesNotMatch(markup, /Save price/);
});

test('draft validation errors surface under the create form fields', () => {
  const markup = render('CHAIN_MANAGER', {
    draftErrors: { name: 'Service name is required.', price: 'Enter a non-negative price with at most two decimal places.' },
  });

  assert.match(markup, /Service name is required\./);
  assert.match(markup, /at most two decimal places/);
  assert.match(markup, /aria-invalid="true"/);
});