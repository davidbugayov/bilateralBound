const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// In-memory session store: { [sessionId]: { controllerId, ball } }
const sessions = new Map();

app.use(express.json());
app.use(cors({ origin: '*'}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const initialBall = { x: 300, y: 200, vx: 0, vy: 0, speed: 200 };
  sessions.set(sessionId, { controllerId: null, ball: initialBall });
  res.json({ sessionId });
});

// Simple GET variant to avoid CORS preflight on some hosts
app.get('/api/session/new', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const initialBall = { x: 300, y: 200, vx: 0, vy: 0, speed: 200 };
  sessions.set(sessionId, { controllerId: null, ball: initialBall });
  res.json({ sessionId });
});

app.get('/s/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

app.get('/c/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

io.on('connection', (socket) => {
  socket.on('join-session', ({ sessionId, role }) => {
    if (!sessions.has(sessionId)) {
      socket.emit('error-message', 'Session not found');
      return;
    }

    socket.join(sessionId);
    const session = sessions.get(sessionId);

    if (role === 'controller') {
      if (session.controllerId && session.controllerId !== socket.id) {
        socket.emit('error-message', 'Controller already connected');
        return;
      }
      session.controllerId = socket.id;
      socket.emit('ball-state', session.ball);
      io.to(sessionId).emit('role-update', { hasController: true });
    } else {
      // viewer
      socket.emit('ball-state', session.ball);
      socket.emit('role-update', { hasController: !!session.controllerId });
    }
  });

  socket.on('control-update', ({ sessionId, input }) => {
    const session = sessions.get(sessionId);
    if (!session || session.controllerId !== socket.id) return;

    // Update ball physics from input
    const { up, down, left, right, speed } = input || {};
    if (typeof speed === 'number') session.ball.speed = Math.max(0, Math.min(1000, speed));

    const acceleration = 600; // pixels/s^2
    const damping = 0.9; // simple damping for friction

    if (left) session.ball.vx -= acceleration / 60;
    if (right) session.ball.vx += acceleration / 60;
    if (up) session.ball.vy -= acceleration / 60;
    if (down) session.ball.vy += acceleration / 60;

    session.ball.vx *= damping;
    session.ball.vy *= damping;
  });

  // Basic server-side tick to integrate velocity and broadcast
  // 60 Hz update
  const interval = setInterval(() => {
    for (const [sessionId, session] of sessions) {
      const ball = session.ball;
      const dt = 1 / 60;
      const maxSpeed = ball.speed;

      // Clamp velocity magnitude
      const speedMag = Math.hypot(ball.vx, ball.vy);
      if (speedMag > maxSpeed) {
        ball.vx = (ball.vx / speedMag) * maxSpeed;
        ball.vy = (ball.vy / speedMag) * maxSpeed;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Simple bounds within 800x600 canvas
      const width = 800;
      const height = 600;
      const radius = 20;
      if (ball.x < radius) { ball.x = radius; ball.vx = -ball.vx * 0.8; }
      if (ball.x > width - radius) { ball.x = width - radius; ball.vx = -ball.vx * 0.8; }
      if (ball.y < radius) { ball.y = radius; ball.vy = -ball.vy * 0.8; }
      if (ball.y > height - radius) { ball.y = height - radius; ball.vy = -ball.vy * 0.8; }

      io.to(sessionId).emit('ball-state', ball);
    }
  }, 1000 / 60);

  socket.on('disconnect', () => {
    // Clear controller role if controller disconnects
    for (const [sessionId, session] of sessions) {
      if (session.controllerId === socket.id) {
        session.controllerId = null;
        io.to(sessionId).emit('role-update', { hasController: false });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});


