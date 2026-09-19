import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/options';

test('login destinations are explicitly composed and cannot escape the site', () => {
  assert.equal(safeNext('/rooms?room=r_123'), '/rooms?room=r_123');
  assert.equal(safeNext('/billing'), '/rooms');
  assert.equal(safeNext('/billing', ['/billing']), '/billing');
  for (const value of ['//evil.test', '/\\evil.test', 'https://evil.test', '/billing/other', '/%2f%2fevil.test', '/rooms#fragment', '/rooms/../billing'])
    assert.equal(safeNext(value, ['/billing']), '/rooms');
  assert.equal(safeNext('/connect?redirect_uri=https%3A%2F%2Fexample.test'), '/connect?redirect_uri=https%3A%2F%2Fexample.test');
});
