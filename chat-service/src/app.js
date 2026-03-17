const http = require('http');

const PORT = Number(process.env.PORT || 8089);

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    return sendJson(res, 200, {
      success: true,
      message: 'Chat service is running',
      timestamp: new Date().toISOString(),
    });
  }

  if (req.url.startsWith('/')) {
    return sendJson(res, 200, {
      success: true,
      message: 'Chat service placeholder is running',
      path: req.url,
    });
  }

  return sendJson(res, 404, {
    success: false,
    message: 'Not found',
  });
});

server.listen(PORT, () => {
  console.log(`chat-service running on port ${PORT}`);
});
