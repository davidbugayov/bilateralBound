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
const DEFAULT_WORLD_WIDTH = 800;
const DEFAULT_WORLD_HEIGHT = 600;

// In-memory session store: { [sessionId]: { controllerId, ball, createdAt } }
const sessions = new Map();

app.use(express.json());
app.use(cors({ origin: '*'}));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/session', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 220;
  const initialBall = { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed };
  sessions.set(sessionId, { controllerId: null, ball: initialBall, world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT }, paused: true, lastDir: { x: 1, y: 0 }, createdAt: Date.now() });
  res.json({ sessionId });
});

// Simple GET variant to avoid CORS preflight on some hosts
app.get('/api/session/new', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 220;
  const initialBall = { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed };
  sessions.set(sessionId, { controllerId: null, ball: initialBall, world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT }, paused: true, lastDir: { x: 1, y: 0 }, createdAt: Date.now() });
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
        ball: { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed },
        world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
        paused: true,
        lastDir: { x: 1, y: 0 },
        createdAt: Date.now()
      });
    }
  // Viewer reports current canvas size so server can use full-screen bounds
  socket.on('world-size', ({ sessionId, width, height }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    const w = Math.max(200, Math.min(10000, Number(width)));
    const h = Math.max(200, Math.min(10000, Number(height)));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    session.world = { width: w, height: h };
  });

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

    // Directional constant-speed control with multiplier or explicit speed; optional reset/pause
    const { dirX, dirY, speedMultiplier, speedScalar, reset, pause, resume } = input || {};
    const base = 220;
    const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 10) : 1;
    const targetSpeed = typeof speedScalar === 'number' && speedScalar > 0 ? Math.min(speedScalar, 2000) : base * multiplier;

    session.ball.speed = targetSpeed;
    if (pause === true) session.paused = true;
    if (resume === true) session.paused = false;
    if (reset) {
      const w = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
      const h = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
      session.ball.x = w / 2;
      session.ball.y = h / 2;
    }

    if (typeof dirX === 'number' && typeof dirY === 'number') {
      const mag = Math.hypot(dirX, dirY);
      if (mag > 0) {
        session.lastDir = { x: dirX / mag, y: dirY / mag };
        if (!session.paused) {
          session.ball.vx = session.lastDir.x * targetSpeed;
          session.ball.vy = session.lastDir.y * targetSpeed;
        }
      }
    }
    // If only speed changed or resumed, apply along last direction
    if (!session.paused && (typeof dirX !== 'number' && typeof dirY !== 'number')) {
      if (session.lastDir) {
        session.ball.vx = (session.lastDir.x || 0) * session.ball.speed;
        session.ball.vy = (session.lastDir.y || 0) * session.ball.speed;
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

      if (!session.paused) {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
      }

      // Simple bounds within session world (updated by viewer)
      const width = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
      const height = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
      const radius = 20;
      
      // Bounce off walls with full reflection (no energy loss)
      if (ball.x < radius) { 
        ball.x = radius; 
        ball.vx = Math.abs(ball.vx); // Ensure positive velocity
      }
      if (ball.x > width - radius) { 
        ball.x = width - radius; 
        ball.vx = -Math.abs(ball.vx); // Ensure negative velocity
      }
      if (ball.y < radius) { 
        ball.y = radius; 
        ball.vy = Math.abs(ball.vy); // Ensure positive velocity
      }
      if (ball.y > height - radius) { 
        ball.y = height - radius; 
        ball.vy = -Math.abs(ball.vy); // Ensure negative velocity
      }

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

// Clean up old sessions (15 minutes)
setInterval(() => {
  const now = Date.now();
  const fifteenMinutes = 15 * 60 * 1000;
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.createdAt && (now - session.createdAt) > fifteenMinutes) {
      console.log(`Cleaning up old session: ${sessionId}`);
      sessions.delete(sessionId);
      io.to(sessionId).emit('session-expired', { message: 'Сессия истекла (15 минут). Создайте новую сессию.' });
    }
  }
}, 60000); // Check every minute

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Sessions will auto-cleanup after 15 minutes`);
});


