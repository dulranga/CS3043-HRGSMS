import assert from 'node:assert/strict';
import test from 'node:test';
import { sendCsvResponse } from '../src/utils/csvExport';
test('CSV quotes line breaks and quotes, preserves signed amounts/dates, and neutralizes text formulas', () => {
  let body = '';
  const res = { setHeader() {}, status() { return this; }, send(value: string) { body = value; } };
  sendCsvResponse(res as never, 'test.csv', [{ name: '=HYPERLINK("evil")', description: 'A\rB,"C"', balance: '-25.00', issued_at: new Date('2026-10-01T00:00:00Z') }]);
  assert.ok(body.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(body.includes('"A\rB,""C"""'));
  assert.ok(body.includes(',-25.00,2026-10-01T00:00:00.000Z'));
});
