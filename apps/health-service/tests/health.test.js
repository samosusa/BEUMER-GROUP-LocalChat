const assert = require('node:assert/strict');
const test = require('node:test');
const { createServer } = require('../src/app');

test('GET /health returns service status', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));

  try {
    const address = server.address();
    const response = await fetch(`http://localhost:${address.port}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});