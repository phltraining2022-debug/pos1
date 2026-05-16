// Minimal Express hello world
const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Kubernetes!', pid: process.pid, env: process.env.NODE_ENV || 'development' });
});

app.get('/healthz', (req, res) => res.sendStatus(200));

app.listen(PORT, () => {
  console.log(`Hello app listening on port ${PORT}`);
});

module.exports = app;
