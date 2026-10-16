import assert from 'node:assert/strict';
import { verifyDatabaseEncoding } from '../src/common/db-encoding.js';

// P0-2: the boot-time DB-encoding guard must (a) treat UTF8/UTF8 as ok,
// (b) flag any non-UTF8 combination as NOT ok (the silent `?????` write-mangling
// environment), and (c) never throw — a probe failure degrades to ok:true with
// a warning so a locked-down role cannot block the clinic from booting.
{
  const fakeDb = (serverEncoding: string, clientEncoding: string) => ({
    $queryRawUnsafe: async (sql: string): Promise<Array<Record<string, string>>> => {
      if (sql.includes('server_encoding')) return [{ server_encoding: serverEncoding }];
      return [{ client_encoding: clientEncoding }];
    },
  });

  const utf8 = await verifyDatabaseEncoding(fakeDb('UTF8', 'UTF8') as never);
  assert.equal(utf8.ok, true, 'UTF8/UTF8 must be ok');
  assert.equal(utf8.serverEncoding, 'UTF8');
  assert.equal(utf8.clientEncoding, 'UTF8');

  const win1252 = await verifyDatabaseEncoding(fakeDb('WIN1252', 'WIN1252') as never);
  assert.equal(win1252.ok, false, 'WIN1252 cluster must be flagged (Arabic stored as ?????)');
  assert.equal(win1252.serverEncoding, 'WIN1252');

  const latinServer = await verifyDatabaseEncoding(fakeDb('LATIN1', 'UTF8') as never);
  assert.equal(latinServer.ok, false, 'non-UTF8 server encoding must be flagged even with UTF8 client');

  const probeFails = {
    $queryRawUnsafe: async (): Promise<never> => {
      throw new Error('permission denied');
    },
  };
  const degraded = await verifyDatabaseEncoding(probeFails as never);
  assert.equal(degraded.ok, true, 'probe failure must degrade to ok:true (never block boot)');
  assert.equal(degraded.serverEncoding, 'unknown');
}

// eslint-disable-next-line no-console
console.log('P0-2 boot encoding guard tests passed.');
