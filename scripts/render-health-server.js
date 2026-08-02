const http = require('http');

let server = null;

function startRenderHealthServer() {
  if (server) return server;
  const port = Number(process.env.PORT || 8080);
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[RenderHealth] listening on :${port}`);
  });
  return server;
}

module.exports = { startRenderHealthServer };
