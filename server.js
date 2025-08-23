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
  const baseSpeed = 150; // 50% of 300 px/s
  const initialBall = { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed, radius: 20 };
  sessions.set(sessionId, { controllerId: null, ball: initialBall, world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT }, paused: true, lastDir: { x: 1, y: 0 }, createdAt: Date.now(), lastActivity: Date.now(), viewerJoined: false, colors: { ball:'#60a5fa', bg:'#020617' } });
  res.json({ sessionId });
});

// Simple GET variant to avoid CORS preflight on some hosts
app.get('/api/session/new', (req, res) => {
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 150; // 50% of 300 px/s
  const initialBall = { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed, radius: 20 };
  sessions.set(sessionId, { controllerId: null, ball: initialBall, world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT }, paused: true, lastDir: { x: 1, y: 0 }, createdAt: Date.now(), lastActivity: Date.now(), viewerJoined: false, colors: { ball:'#60a5fa', bg:'#020617' } });
  res.json({ sessionId });
});

app.get('/s/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

app.get('/c/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'controller.html'));
});

app.get('/config.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'config.js'));
});

io.on('connection', (socket) => {
  socket.on('join-session', ({ sessionId, role }) => {
    // Auto-create session if it doesn't exist (supports client-side sid generation)
    if (!sessions.has(sessionId)) {
      const baseSpeed = 150; // 50% of 300 px/s
      sessions.set(sessionId, {
        controllerId: null,
        ball: { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed },
        world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
        paused: true,
        lastDir: { x: 1, y: 0 },
        createdAt: Date.now(),
        lastActivity: Date.now(),
        viewerJoined: false
      });
    }
  // Viewer reports current canvas size so server can use full-screen bounds
  socket.on('world-size', ({ sessionId, width, height }) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100) return;
    session.world = { width: w, height: h };
    console.log('Server received world size:', w, 'x', h, 'for session:', sessionId);
    
    // Center the ball in the actual screen size (only if ball is not moving)
    if (session.paused || (Math.abs(session.ball.vx) < 1 && Math.abs(session.ball.vy) < 1)) {
      session.ball.x = w / 2;
      session.ball.y = h / 2;
      session.ball.vx = 0;
      session.ball.vy = 0;
    }
  });

    socket.join(sessionId);
    const session = sessions.get(sessionId);

    if (role === 'controller') {
      if (session.controllerId && session.controllerId !== socket.id) {
        socket.emit('error-message', 'Controller already connected');
        return;
      }
      session.controllerId = socket.id;
      socket.emit('ball-state', { ...session.ball, radius: session.ball.radius });
      io.to(sessionId).emit('role-update', { hasController: true });
    } else {
      // viewer
      socket.emit('ball-state', session.ball);
      socket.emit('role-update', { hasController: !!session.controllerId });
      
      // Notify controller that viewer has joined
      if (session.controllerId) {
        io.to(session.controllerId).emit('viewer-joined', { message: 'Зритель подключился к сессии' });
      }
      
      // Mark that viewer has joined (reset 5-minute timer)
      session.viewerJoined = true;
    }
  });

  socket.on('control-update', ({ sessionId, input }) => {
    const session = sessions.get(sessionId);
    if (!session || session.controllerId !== socket.id) return;

    // Optimized control handling - only process direction changes and essential updates
    const { dirX, dirY, speedMultiplier, speedScalar, reset, pause, resume, colorBall, colorBg, radius } = input || {};
    
    // Handle pause/resume immediately
    if (pause === true) {
      session.paused = true;
      return; // No need to process other updates when pausing
    }
    
    if (resume === true) {
      session.paused = false;
      // Use last known direction or default to horizontal
      if (!session.lastDir) {
        session.lastDir = { x: 1, y: 0 };
      }
      // Apply current speed to last direction
      const currentSpeed = session.ball.speed || 120;
      session.ball.vx = session.lastDir.x * currentSpeed;
      session.ball.vy = session.lastDir.y * currentSpeed;
      
      // Force immediate broadcast for resume
      io.to(sessionId).emit('ball-state', {
        ...session.ball,
        radius: session.ball.radius,
        colorBall: session.colors?.ball,
        colorBg: session.colors?.bg,
        width: session.world?.width,
        height: session.world?.height
      });
      return;
    }
    
    // Handle reset
    if (reset) {
      const w = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
      const h = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
      session.ball.x = w / 2;
      session.ball.y = h / 2;
      session.ball.vx = 0;
      session.ball.vy = 0;
      session.paused = true;
      return;
    }
    
    // Handle speed changes
    const base = 120;
    const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 10) : 1;
    const clampedScalar = typeof speedScalar === 'number' ? Math.max(0, Math.min(100, speedScalar)) : undefined;
    const targetSpeed = typeof clampedScalar === 'number' ? Math.round((clampedScalar / 100) * 300) : base * multiplier;
    
    if (session.ball.speed !== targetSpeed) {
      session.ball.speed = targetSpeed;
      // Only update velocity if ball is moving
      if (!session.paused && session.lastDir) {
        session.ball.vx = session.lastDir.x * targetSpeed;
        session.ball.vy = session.lastDir.y * targetSpeed;
      }
    }
    
    // Handle direction changes (most important for smooth movement)
    if (typeof dirX === 'number' && typeof dirY === 'number') {
      const mag = Math.hypot(dirX, dirY);
      if (mag > 0) {
        const newDir = { x: dirX / mag, y: dirY / mag };
        // Only update if direction actually changed
        if (!session.lastDir || Math.abs(session.lastDir.x - newDir.x) > 0.01 || Math.abs(session.lastDir.y - newDir.y) > 0.01) {
          session.lastDir = newDir;
          if (!session.paused) {
            session.ball.vx = session.lastDir.x * session.ball.speed;
            session.ball.vy = session.lastDir.y * session.ball.speed;
          }
        }
      }
    }
    
    // Handle visual changes (radius, colors) - these don't affect movement
    if (typeof radius === 'number') {
      const r = Math.max(5, Math.min(60, Math.round(radius)));
      if (session.ball.radius !== r) {
        session.ball.radius = r;
        // Broadcast visual change immediately
        io.to(sessionId).emit('ball-state', {
          ...session.ball,
          radius: session.ball.radius,
          colorBall: session.colors?.ball,
          colorBg: session.colors?.bg,
          width: session.world?.width,
          height: session.world?.height
        });
      }
    }
    
    // Handle color changes
    if (!session.colors) session.colors = { ball:'#60a5fa', bg:'#020617' };
    let colorsChanged = false;
    if (typeof colorBall === 'string' && colorBall && session.colors.ball !== colorBall) {
      session.colors.ball = colorBall;
      colorsChanged = true;
    }
    if (typeof colorBg === 'string' && colorBg && session.colors.bg !== colorBg) {
      session.colors.bg = colorBg;
      colorsChanged = true;
    }
    
    // Only broadcast if colors changed
    if (colorsChanged) {
      io.to(sessionId).emit('ball-state', {
        ...session.ball,
        radius: session.ball.radius,
        colorBall: session.colors.ball,
        colorBg: session.colors.bg,
        width: session.world?.width,
        height: session.world?.height
      });
    }
  });

  // Optimized server-side tick with smoother physics and reduced socket traffic
  const interval = setInterval(() => {
    for (const [sessionId, session] of sessions) {
      const ball = session.ball;
      const dt = 1 / 60; // 60 FPS for smooth movement
      const maxSpeed = ball.speed || 220;

      // Smooth velocity clamping with interpolation
      const speedMag = Math.hypot(ball.vx, ball.vy);
      if (speedMag > 0 && Math.abs(speedMag - maxSpeed) > 2) {
        const targetScale = maxSpeed / speedMag;
        const currentScale = 1;
        const lerpFactor = 0.1; // Smooth interpolation
        const newScale = currentScale + (targetScale - currentScale) * lerpFactor;
        ball.vx *= newScale;
        ball.vy *= newScale;
      }

      if (!session.paused) {
        // Smooth position update with velocity
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
      }

      // Enhanced bounds checking with smooth bouncing
      const width = session.world?.width || DEFAULT_WORLD_WIDTH;
      const height = session.world?.height || DEFAULT_WORLD_HEIGHT;
      const radius = ball.radius || 20;
      
      // Smooth bounce off walls with proper edge detection
      if (ball.x <= radius) { 
        ball.x = radius; 
        ball.vx = Math.abs(ball.vx) * 0.98; // Slight energy loss for realism
      }
      if (ball.x >= width - radius) { 
        ball.x = width - radius; 
        ball.vx = -Math.abs(ball.vx) * 0.98;
      }
      if (ball.y <= radius) { 
        ball.y = radius; 
        ball.vy = Math.abs(ball.vy) * 0.98;
      }
      if (ball.y >= height - radius) { 
        ball.y = height - radius; 
        ball.vy = -Math.abs(ball.vy) * 0.98;
      }

      // Only emit ball state if there are active viewers and ball is moving
      const room = io.sockets.adapter.rooms.get(sessionId);
      const hasViewers = room && room.size > 1; // More than just controller
      
      if (hasViewers && (!session.paused || Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1)) {
        io.to(sessionId).emit('ball-state', {
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy,
          speed: ball.speed,
          radius: ball.radius,
          colorBall: session.colors?.ball,
          colorBg: session.colors?.bg,
          width,
          height
        });
      }
    }
  }, 1000 / 60);

  socket.on('disconnect', () => {
    // Clear controller role if controller disconnects
    for (const [sessionId, session] of sessions) {
      if (session.controllerId === socket.id) {
        session.controllerId = null;
        io.to(sessionId).emit('role-update', { hasController: false });
      }
      
      // Check if this was a viewer disconnecting
      const room = io.sockets.adapter.rooms.get(sessionId);
      if (room && room.size === 1 && session.controllerId) {
        // Only controller left, viewer disconnected - reset session
        const w = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
        const h = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
        session.ball.x = w / 2;
        session.ball.y = h / 2;
        session.ball.vx = 0;
        session.ball.vy = 0;
        session.paused = true;
        
        // Notify controller that viewer left and session was reset
        io.to(session.controllerId).emit('viewer-left', { message: 'Зритель отключился. Сессия сброшена.' });
        io.to(sessionId).emit('ball-state', { ...session.ball, radius: session.ball.radius });
      }
    }
  });
});

// Clean up sessions based on activity and usage
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000; // 1 hour for active sessions
  const tenMinutes = 10 * 60 * 1000; // 10 minutes for inactive sessions
  const fiveMinutes = 5 * 60 * 1000; // 5 minutes for sessions without viewers
  
  for (const [sessionId, session] of sessions.entries()) {
    const room = io.sockets.adapter.rooms.get(sessionId);
    const hasActiveUsers = room && room.size > 0;
    const hasViewer = session.viewerJoined;
    const hasController = session.controllerId;
    
    // Update last activity time when users are connected
    if (hasActiveUsers) {
      session.lastActivity = now;
    }
    
    // Clean up very old sessions (1 hour max)
    if (session.createdAt && (now - session.createdAt) > oneHour) {
      sessions.delete(sessionId);
      io.to(sessionId).emit('session-expired', { message: 'Сессия истекла (1 час). Создайте новую сессию.' });
      continue;
    }
    
    // Clean up sessions without viewers quickly (5 minutes)
    if (hasController && !hasViewer && session.createdAt && (now - session.createdAt) > fiveMinutes) {
      sessions.delete(sessionId);
      io.to(sessionId).emit('session-expired', { message: 'Зритель не подключился в течение 5 минут. Создайте новую сессию.' });
      continue;
    }
    
    // Clean up inactive sessions (10 minutes without activity)
    if (!hasActiveUsers && session.lastActivity && (now - session.lastActivity) > tenMinutes) {
      console.log(`Cleaning up inactive session (10 min): ${sessionId}`);
      sessions.delete(sessionId);
      io.to(sessionId).emit('session-expired', { message: 'Сессия неактивна 10 минут. Создайте новую сессию.' });
    }
  }
}, 60000); // Check every minute

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Sessions: 1 hour max, 10 min inactive, 5 min no viewer`);
});


