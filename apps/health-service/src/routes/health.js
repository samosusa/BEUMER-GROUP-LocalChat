function handleHealth(request, response) {
  if (request.method !== 'GET') {
    return false;
  }

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ status: 'ok' }));
  return true;
}

module.exports = { handleHealth };