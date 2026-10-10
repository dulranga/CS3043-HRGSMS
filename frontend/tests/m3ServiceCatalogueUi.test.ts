import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AT24_FORBIDDEN_ROLES,
  ActiveFilter,
  CHAIN_MANAGER,
  CatalogueRole,
  SEEDED_CATALOGUE_ROLES,
  ServiceRecord,
  USAGE_RECORDING_ROLES,
  activeFilterQuery,
  applyCreatedService,
  applyUpdatedService,
  catalogueCompleteness,
  describeCatalogueDenial,
  describeCatalogueFailure,
  filterByActive,
  formatLkr,
  isChainManagerDenial,
  parseCatalogueFailure,
  parseServiceList,
  resolveCatalogueCapabilities,
  serviceCollectionPath,
  serviceWritePath,
  toMoneyString,
  validatePrice,
  validateServiceDraft,
} from '../src/lib/serviceCatalogueViewModel.ts';

const FORBIDDEN_ROLES = ['BRANCH_MANAGER', 'FRONT_DESK', 'SERVICE_STAFF', 'SYSTEM_ADMINISTRATOR', 'AUDITOR'] as const;

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    service_id: '0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01',
    name: 'Room Service',
    category: 'DINING',
    current_price: '1250.50',
    active: true,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

test('only CHAIN_MANAGER gains catalogue write capability, matching AT-24', () => {
  const chainManager = resolveCatalogueCapabilities(CHAIN_MANAGER);
  assert.equal(chainManager.isChainManager, true);
  assert.equal(chainManager.canCreate, true);
  assert.equal(chainManager.canEditPrice, true);
  assert.equal(chainManager.canEditActiveState, true);
  assert.equal(chainManager.denial, null);

  for (const role of FORBIDDEN_ROLES) {
    const capabilities = resolveCatalogueCapabilities(role);
    assert.equal(capabilities.isChainManager, false, `${role} must not be a chain manager`);
    assert.equal(capabilities.canCreate, false, `${role} must not create services`);
    assert.equal(capabilities.canEditPrice, false, `${role} must not edit prices`);
    assert.equal(capabilities.canEditActiveState, false, `${role} must not change active state`);
    assert.match(String(capabilities.denial), /Chain Manager/);
  }
});

test('AT-24 forbidden roles cover every seeded role except CHAIN_MANAGER', () => {
  assert.equal(SEEDED_CATALOGUE_ROLES.length, 6);
  assert.equal(CHAIN_MANAGER, 'CHAIN_MANAGER');
  assert.deepEqual([...AT24_FORBIDDEN_ROLES].sort(), [...FORBIDDEN_ROLES].sort());
  assert.equal(AT24_FORBIDDEN_ROLES.includes(CHAIN_MANAGER), false);
});

test('an unknown actor stays read-only instead of defaulting to write access', () => {
  const unknown = resolveCatalogueCapabilities(null);
  assert.equal(unknown.role, null);
  assert.equal(unknown.isChainManager, false);
  assert.equal(unknown.canCreate, false);
  assert.equal(unknown.canEditPrice, false);
  assert.equal(unknown.canEditActiveState, false);
  assert.equal(unknown.isUsageRecordingRole, false);
  assert.match(String(unknown.denial), /not a Chain Manager/);
});

test('usage-recording roles are flagged so the UI points at usage recording, not pricing', () => {
  for (const role of USAGE_RECORDING_ROLES) {
    const capabilities = resolveCatalogueCapabilities(role);
    assert.equal(capabilities.isUsageRecordingRole, true, `${role} records usage`);
    assert.equal(capabilities.canEditPrice, false, `${role} cannot edit prices`);
  }
  assert.equal(resolveCatalogueCapabilities('AUDITOR').isUsageRecordingRole, false);
});

test('catalogue denial copy names the action and the signed-in role', () => {
  assert.match(describeCatalogueDenial('FRONT_DESK', 'price'), /Chain Manager/);
  assert.match(describeCatalogueDenial('FRONT_DESK', 'price'), /Signed in as FRONT_DESK/);
  assert.match(describeCatalogueDenial('AUDITOR', 'create'), /add a service/);
  assert.match(describeCatalogueDenial(null, 'active'), /activate or deactivate/);
});

test('numeric(12,2) prices keep two decimals and thousands separators', () => {
  assert.equal(toMoneyString('1250.50'), '1250.50');
  assert.equal(toMoneyString('1250.5'), '1250.50');
  assert.equal(toMoneyString('1250'), '1250.00');
  assert.equal(toMoneyString(0), '0.00');
  assert.equal(toMoneyString(null), '0.00');
  assert.equal(formatLkr('1250.5'), 'LKR 1,250.50');
  assert.equal(formatLkr('1234567.891'), 'LKR 1,234,567.89');
});

test('price validation rejects blanks, negatives and scale beyond numeric(12,2)', () => {
  assert.equal(validatePrice('1250.50').valid, true);
  assert.equal(validatePrice('0').valid, true);
  assert.equal(validatePrice('').valid, false);
  assert.match(String(validatePrice('').error), /required/);
  assert.equal(validatePrice('-5').valid, false);
  assert.match(String(validatePrice('-5').error), /non-negative/);
  assert.equal(validatePrice('12.345').valid, false);
  assert.match(String(validatePrice('12.345').error), /two decimal places/);
  assert.equal(validatePrice('abc').valid, false);
});

test('create payloads mirror M3-S05 field names and reject incomplete drafts', () => {
  const invalid = validateServiceDraft({ name: '  ', category: '', price: '' });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors.name, 'Service name is required.');
  assert.equal(invalid.errors.category, 'Service category is required.');
  assert.equal(invalid.errors.price, 'Service price is required.');

  const valid = validateServiceDraft({ name: '  Spa Massage  ', category: ' WELLNESS ', price: ' 4800 ' });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.payload, { name: 'Spa Massage', category: 'WELLNESS', current_price: '4800' });
});

test('the bare array and { services } envelopes both normalise into records', () => {
  const fromArray = parseServiceList([row(), row({ service_id: 'x', name: 'Laundry', current_price: '350' })]);
  assert.equal(fromArray.length, 2);
  assert.equal(fromArray[0].currentPrice, '1250.50');
  assert.equal(fromArray[0].active, true);
  assert.equal(fromArray[1].currentPrice, '350.00');

  const wrapped = parseServiceList({ services: [row()] });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].category, 'DINING');

  assert.deepEqual(parseServiceList(null), []);
  assert.deepEqual(parseServiceList({ services: [{ name: 'missing id' }] }), []);
  assert.equal(parseServiceList([{ service_id: 'y', name: 'Minibar', active: 'false' }])[0].active, false);
});

test('active filtering mirrors the M3-S05 active query parameter', () => {
  const services = parseServiceList([
    row({ service_id: 'a', name: 'Room Service', active: true }),
    row({ service_id: 'b', name: 'Spa Massage', active: false }),
  ]);

  assert.equal(filterByActive(services, 'all').length, 2);
  assert.deepEqual(filterByActive(services, 'active').map((s) => s.name), ['Room Service']);
  assert.deepEqual(filterByActive(services, 'inactive').map((s) => s.name), ['Spa Massage']);

  const queries: Record<ActiveFilter, string> = {
    all: activeFilterQuery('all'),
    active: activeFilterQuery('active'),
    inactive: activeFilterQuery('inactive'),
  };
  assert.equal(queries.all, '');
  assert.equal(queries.active, '?active=true');
  assert.equal(queries.inactive, '?active=false');
});

test('create and update results merge into the list without duplicating or mutating rows', () => {
  const existing = parseServiceList([row({ service_id: 'a', name: 'Room Service' })]);
  const created = parseServiceList([row({ service_id: 'b', name: 'Spa Massage', current_price: '4800.00' })])[0];

  const afterCreate = applyCreatedService(existing, created);
  assert.deepEqual(afterCreate.map((s) => s.name), ['Room Service', 'Spa Massage']);
  assert.equal(existing.length, 1, 'the previous array is untouched');

  const updated: ServiceRecord = { ...afterCreate[0], currentPrice: '1400.00', active: false };
  const afterUpdate = applyUpdatedService(afterCreate, updated);
  assert.equal(afterUpdate.length, 2);
  assert.equal(afterUpdate[0].currentPrice, '1400.00');
  assert.equal(afterUpdate[0].active, false);
  assert.equal(afterCreate[0].currentPrice, '1250.50', 'the previous array is untouched');
});

test('FR-042 completeness reports missing required service categories', () => {
  const thin = parseServiceList([row({ service_id: 'a', name: 'Room Service' })]);
  const thinResult = catalogueCompleteness(thin);
  assert.equal(thinResult.complete, false);
  assert.equal(thinResult.count, 1);
  assert.deepEqual(thinResult.missing, ['spa', 'laundry', 'minibar-related']);

  const complete = parseServiceList([
    row({ service_id: 'a', name: 'Room Service' }),
    row({ service_id: 'b', name: 'Spa Massage' }),
    row({ service_id: 'c', name: 'Laundry Pressing' }),
    row({ service_id: 'd', name: 'Minibar Restock' }),
    row({ service_id: 'e', name: 'Airport Transfer' }),
    row({ service_id: 'f', name: 'Late Checkout' }),
  ]);
  assert.deepEqual(catalogueCompleteness(complete), { count: 6, missing: [], complete: true });
});

test('flat and structured error envelopes both resolve to the AT-24 denial', () => {
  const flat = parseCatalogueFailure(403, {
    error: 'Only CHAIN_MANAGER may change the service catalogue.',
  });
  assert.equal(flat.code, 'CATALOGUE_FORBIDDEN');
  assert.equal(flat.status, 403);
  assert.match(flat.message, /CHAIN_MANAGER/);
  assert.equal(isChainManagerDenial(flat), true);
  assert.match(describeCatalogueFailure(flat), /Only a Chain Manager/);

  const structured = parseCatalogueFailure(403, {
    error: { code: 'CATALOGUE_FORBIDDEN', message: 'Chain Manager only.' },
  });
  assert.equal(structured.code, 'CATALOGUE_FORBIDDEN');
  assert.equal(structured.message, 'Chain Manager only.');
  assert.equal(isChainManagerDenial(structured), true);

  assert.equal(parseCatalogueFailure(404, { error: 'Service not found.' }).code, 'SERVICE_NOT_FOUND');
  assert.equal(parseCatalogueFailure(401, { error: 'Sign in required.' }).code, 'UNAUTHENTICATED');
  assert.match(
    describeCatalogueFailure({ status: 401, code: 'UNAUTHENTICATED', message: 'Sign in required.' }),
    /active staff account/,
  );
  assert.equal(isChainManagerDenial(parseCatalogueFailure(400, { error: 'bad price' })), false);
  assert.equal(
    describeCatalogueFailure({ status: 400, code: 'VALIDATION_ERROR', message: 'Service price must be a non-negative number.' }),
    'Service price must be a non-negative number.',
  );

  const unknownCode = parseCatalogueFailure(500, { error: 'boom' });
  assert.equal(unknownCode.code, 'CATALOGUE_READ_FAILED');
  assert.match(describeCatalogueFailure(unknownCode), /could not be loaded/);
});

test('catalogue paths stay under the provisional shared services prefix', () => {
  assert.equal(serviceCollectionPath(), '/services');
  assert.equal(serviceWritePath(), '/services');
  assert.equal(serviceWritePath('0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01'), '/services/0193f1c2-4d5e-7a8b-9c0d-1e2f3a4b5d01');
  assert.equal(serviceWritePath('a b/c'), '/services/a%20b%2Fc');
});

test('the capability model only recognises the six seeded role names', () => {
  const seeded = new Set<CatalogueRole>(SEEDED_CATALOGUE_ROLES);
  for (const role of FORBIDDEN_ROLES) {
    assert.equal(seeded.has(role), true, `${role} is a seeded role`);
  }
  assert.equal(seeded.has('OWNER' as CatalogueRole), false);
});