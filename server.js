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
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;

// In-memory session store: { [sessionId]: { controllerId, ball } }
const sessions = new Map();

app.use(express.json());
app.use(cors({ origin: '*'}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 220;
  const initialBall = { x: WORLD_WIDTH/2, y: WORLD_HEIGHT/2, vx: baseSpeed, vy: 0, speed: baseSpeed };
  sessions.set(sessionId, { controllerId: null, ball: initialBall });
  res.json({ sessionId });
});

// Simple GET variant to avoid CORS preflight on some hosts
app.get('/api/session/new', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 220;
  const initialBall = { x: WORLD_WIDTH/2, y: WORLD_HEIGHT/2, vx: baseSpeed, vy: 0, speed: baseSpeed };
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
    // Auto-create session if it doesn't exist (supports client-side sid generation)
    if (!sessions.has(sessionId)) {
      const baseSpeed = 220;
      sessions.set(sessionId, {
        controllerId: null,
        ball: { x: WORLD_WIDTH/2, y: WORLD_HEIGHT/2, vx: baseSpeed, vy: 0, speed: baseSpeed }
      });
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

    // Directional constant-speed control with multiplier or explicit speed; optional reset to center
    const { dirX, dirY, speedMultiplier, speedScalar, reset } = input || {};
    const base = 220;
    const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 10) : 1;
    const targetSpeed = typeof speedScalar === 'number' && speedScalar > 0 ? Math.min(speedScalar, 2000) : base * multiplier;

    session.ball.speed = targetSpeed;
    if (reset) {
      session.ball.x = WORLD_WIDTH / 2;
      session.ball.y = WORLD_HEIGHT / 2;
    }

    if (typeof dirX === 'number' && typeof dirY === 'number') {
      const mag = Math.hypot(dirX, dirY);
      if (mag > 0) {
        session.ball.vx = (dirX / mag) * targetSpeed;
        session.ball.vy = (dirY / mag) * targetSpeed;
      }
    }
  });

  // Basic server-side tick to integrate velocity and broadcast
  // 60 Hz update
  const interval = setInterval(() => {
    for (const [sessionId, session] of sessions) {
      const ball = session.ball;
      const dt = 1 / 60;
      const maxSpeed = ball.speed || 220;

      // Clamp velocity magnitude to current scalar speed
      const speedMag = Math.hypot(ball.vx, ball.vy);
      if (speedMag > 0 && Math.abs(speedMag - maxSpeed) > 1) {
        ball.vx = (ball.vx / speedMag) * maxSpeed;
        ball.vy = (ball.vy / speedMag) * maxSpeed;
      }

      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;

      // Simple bounds within fixed canvas
      const width = WORLD_WIDTH;
      const height = WORLD_HEIGHT;
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


