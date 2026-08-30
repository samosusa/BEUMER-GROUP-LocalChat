const http = require('node:http');
const { handleHealth } = require('./routes/health');

const port = Number.parseInt(process.env.PORT || '8000', 10);

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;

    if (pathname === '/health' && handleHealth(request, response)) {
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
}

if (require.main === module) {
  createServer().listen(port, () => {
    console.log(`LocalChat service listening on port ${port}`);
  });
}

module.exports = { createServer };