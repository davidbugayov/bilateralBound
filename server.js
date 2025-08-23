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
    // Enhanced session joining with better error handling
    if (!sessionId || typeof sessionId !== 'string') {
      socket.emit('error-message', 'Неверный ID сессии');
      return;
    }
    
    if (!role || !['controller', 'viewer'].includes(role)) {
      socket.emit('error-message', 'Неверная роль. Допустимые роли: controller, viewer');
      return;
    }
    
    // Auto-create session if it doesn't exist (supports client-side sid generation)
    if (!sessions.has(sessionId)) {
      const baseSpeed = 150; // 50% of 300 px/s
      sessions.set(sessionId, {
        controllerId: null,
        ball: { x: DEFAULT_WORLD_WIDTH/2, y: DEFAULT_WORLD_HEIGHT/2, vx: 0, vy: 0, speed: baseSpeed, radius: 20 },
        world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
        paused: true,
        lastDir: { x: 1, y: 0 },
        createdAt: Date.now(),
        lastActivity: Date.now(),
        viewerJoined: false,
        colors: { ball: '#60a5fa', bg: '#020617' }
      });
      console.log(`New session created: ${sessionId}`);
    }
    
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit('error-message', 'Ошибка создания сессии');
      return;
    }
    
    try {
      socket.join(sessionId);
      
      if (role === 'controller') {
        // Controller joining logic
        if (session.controllerId && session.controllerId !== socket.id) {
          socket.emit('error-message', 'Контроллер уже подключен к этой сессии');
          return;
        }
        
        session.controllerId = socket.id;
        session.lastActivity = Date.now();
        
        // Send current ball state to controller
        socket.emit('ball-state', { 
          ...session.ball, 
          radius: session.ball.radius,
          colorBall: session.colors?.ball,
          colorBg: session.colors?.bg,
          width: session.world?.width,
          height: session.world?.height
        });
        
        // Notify all participants about controller joining
        io.to(sessionId).emit('role-update', { 
          hasController: true,
          message: 'Контроллер подключился к сессии'
        });
        
        console.log(`Controller joined session: ${sessionId}`);
        
      } else {
        // Viewer joining logic
        socket.emit('ball-state', { 
          ...session.ball,
          colorBall: session.colors?.ball,
          colorBg: session.colors?.bg,
          width: session.world?.width,
          height: session.world?.height
        });
        
        socket.emit('role-update', { 
          hasController: !!session.controllerId,
          message: session.controllerId ? 'Контроллер активен' : 'Ожидание контроллера'
        });
        
        // Notify controller that viewer has joined
        if (session.controllerId) {
          io.to(session.controllerId).emit('viewer-joined', { 
            message: 'Зритель подключился к сессии',
            sessionId: sessionId
          });
        }
        
        // Mark that viewer has joined (reset 5-minute timer)
        session.viewerJoined = true;
        session.lastActivity = Date.now();
        
        console.log(`Viewer joined session: ${sessionId}`);
      }
      
    } catch (error) {
      console.error(`Error joining session ${sessionId}:`, error);
      socket.emit('error-message', 'Ошибка подключения к сессии');
    }
  });
  
  // Viewer reports current canvas size so server can use full-screen bounds
  socket.on('world-size', ({ sessionId, width, height }) => {
    // Enhanced validation for world-size
    if (!sessionId || typeof sessionId !== 'string') {
      socket.emit('error-message', 'Неверный ID сессии для обновления размеров');
      return;
    }
    
    if (!sessions.has(sessionId)) {
      socket.emit('error-message', 'Сессия не найдена для обновления размеров');
      return;
    }
    
    const session = sessions.get(sessionId);
    const w = Number(width);
    const h = Number(height);
    
    // Enhanced dimension validation
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      socket.emit('error-message', 'Размеры экрана должны быть числами');
      return;
    }
    
    if (w < 100 || h < 100) {
      socket.emit('error-message', 'Минимальный размер экрана: 100x100 пикселей');
      return;
    }
    
    if (w > 10000 || h > 10000) {
      socket.emit('error-message', 'Максимальный размер экрана: 10000x10000 пикселей');
      return;
    }
    
    try {
      session.world = { width: w, height: h };
      console.log('Server received world size:', w, 'x', h, 'for session:', sessionId);
      
      // Center the ball in the actual screen size (only if ball is not moving)
      if (session.paused || (Math.abs(session.ball.vx) < 1 && Math.abs(session.ball.vy) < 1)) {
        session.ball.x = w / 2;
        session.ball.y = h / 2;
        session.ball.vx = 0;
        session.ball.vy = 0;
      }
      
      // Log successful update
      console.log(`World size updated for session ${sessionId}: ${w}x${h}`);
      
    } catch (error) {
      console.error(`Error updating world size for session ${sessionId}:`, error);
      socket.emit('error-message', 'Ошибка обновления размеров экрана');
    }
  });

  socket.on('control-update', ({ sessionId, input }) => {
    // Enhanced input validation and error handling
    if (!sessionId || typeof sessionId !== 'string') {
      socket.emit('error-message', 'Неверный ID сессии');
      return;
    }
    
    if (!input || typeof input !== 'object') {
      socket.emit('error-message', 'Неверные данные управления');
      return;
    }
    
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit('error-message', 'Сессия не найдена');
      return;
    }
    
    if (session.controllerId !== socket.id) {
      socket.emit('error-message', 'Только контроллер может управлять сессией');
      return;
    }

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
    
    // Handle speed changes with validation
    const base = 120;
    const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 10) : 1;
    const clampedScalar = typeof speedScalar === 'number' ? Math.max(0, Math.min(100, speedScalar)) : undefined;
    
    // Validate speed values
    if (typeof speedMultiplier === 'number' && (!Number.isFinite(speedMultiplier) || speedMultiplier < 0)) {
      socket.emit('error-message', 'Неверный множитель скорости');
      return;
    }
    
    if (typeof speedScalar === 'number' && (!Number.isFinite(speedScalar) || speedScalar < 0 || speedScalar > 100)) {
      socket.emit('error-message', 'Скорость должна быть от 0 до 100');
      return;
    }
    
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
      // Validate direction values
      if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) {
        socket.emit('error-message', 'Неверные значения направления');
        return;
      }
      
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
      } else if (dirX === 0 && dirY === 0) {
        // Stop movement when direction is (0,0)
        session.ball.vx = 0;
        session.ball.vy = 0;
      }
    }
    
    // Handle visual changes (radius, colors) - these don't affect movement
    if (typeof radius === 'number') {
      // Validate radius value
      if (!Number.isFinite(radius) || radius < 5 || radius > 60) {
        socket.emit('error-message', 'Размер шара должен быть от 5 до 60 пикселей');
        return;
      }
      
      const r = Math.round(radius);
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
    
    // Handle color changes with validation
    if (!session.colors) session.colors = { ball:'#60a5fa', bg:'#020617' };
    let colorsChanged = false;
    
    // Validate and apply ball color
    if (typeof colorBall === 'string' && colorBall) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(colorBall)) {
        socket.emit('error-message', 'Неверный формат цвета шара (используйте #RRGGBB)');
        return;
      }
      if (session.colors.ball !== colorBall) {
        session.colors.ball = colorBall;
        colorsChanged = true;
      }
    }
    
    // Validate and apply background color
    if (typeof colorBg === 'string' && colorBg) {
      if (!/^#[0-9A-Fa-f]{6}$/.test(colorBg)) {
        socket.emit('error-message', 'Неверный формат цвета фона (используйте #RRGGBB)');
        return;
      }
      if (session.colors.bg !== colorBg) {
        session.colors.bg = colorBg;
        colorsChanged = true;
      }
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

  // Enhanced server-side tick with better error handling and performance monitoring
  const interval = setInterval(() => {
    try {
      let activeSessions = 0;
      let totalViewers = 0;
      
      for (const [sessionId, session] of sessions) {
        try {
          const ball = session.ball;
          const dt = 1 / 60; // 60 FPS for smooth movement
          const maxSpeed = ball.speed || 220;

          // Validate ball properties
          if (!ball || typeof ball.x !== 'number' || typeof ball.y !== 'number' || 
              !Number.isFinite(ball.x) || !Number.isFinite(ball.y)) {
            console.error(`Invalid ball state in session ${sessionId}, resetting`);
            const w = session.world?.width || DEFAULT_WORLD_WIDTH;
            const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
            ball.x = w / 2;
            ball.y = h / 2;
            ball.vx = 0;
            ball.vy = 0;
            continue;
          }

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
          
          // Validate world dimensions
          if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100) {
            console.error(`Invalid world dimensions in session ${sessionId}: ${width}x${height}`);
            continue;
          }
          
          // Allow ball to move across the entire screen
          // Only bounce when ball goes completely off-screen
          if (ball.x <= -radius) { 
            ball.x = -radius; 
            ball.vx = Math.abs(ball.vx) * 0.98; // Slight energy loss for realism
          }
          if (ball.x >= width + radius) { 
            ball.x = width + radius; 
            ball.vx = -Math.abs(ball.vx) * 0.98;
          }
          if (ball.y <= -radius) { 
            ball.y = -radius; 
            ball.vy = Math.abs(ball.vy) * 0.98;
          }
          if (ball.y >= height + radius) { 
            ball.y = height + radius; 
            ball.vy = -Math.abs(ball.vy) * 0.98;
          }

          // Only emit ball state if there are active viewers and ball is moving
          const room = io.sockets.adapter.rooms.get(sessionId);
          const hasViewers = room && room.size > 1; // More than just controller
          
          if (hasViewers) {
            activeSessions++;
            totalViewers += room.size - 1; // Exclude controller
            
            if (!session.paused || Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1) {
              try {
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
              } catch (emitError) {
                console.error(`Error emitting ball state for session ${sessionId}:`, emitError);
              }
            }
          }
          
        } catch (sessionError) {
          console.error(`Error processing session ${sessionId} during tick:`, sessionError);
          // Try to recover session
          try {
            const w = session.world?.width || DEFAULT_WORLD_WIDTH;
            const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
            session.ball.x = w / 2;
            session.ball.y = h / 2;
            session.ball.vx = 0;
            session.ball.vy = 0;
            session.paused = true;
            console.log(`Session ${sessionId} recovered from error`);
          } catch (recoveryError) {
            console.error(`Failed to recover session ${sessionId}:`, recoveryError);
          }
        }
      }
      
      // Log performance metrics every 100 ticks (about every 1.7 seconds)
      if (Math.random() < 0.01) { // 1% chance each tick
        console.log(`Performance: ${activeSessions} active sessions, ${totalViewers} total viewers`);
      }
      
    } catch (error) {
      console.error('Critical error in main animation loop:', error);
    }
  }, 1000 / 60);

  socket.on('disconnect', () => {
    // Enhanced disconnect handling with better error notifications
    for (const [sessionId, session] of sessions) {
      const room = io.sockets.adapter.rooms.get(sessionId);
      const wasController = session.controllerId === socket.id;
      const wasViewer = room && room.has(socket.id);
      
      if (wasController) {
        // Controller disconnected - notify all viewers
        session.controllerId = null;
        session.paused = true; // Auto-pause when controller leaves
        
        // Reset ball to center when controller leaves
        const w = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
        const h = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
        session.ball.x = w / 2;
        session.ball.y = h / 2;
        session.ball.vx = 0;
        session.ball.vy = 0;
        
        // Notify all participants about controller disconnect
        io.to(sessionId).emit('role-update', { 
          hasController: false,
          message: 'Контроллер отключился. Сессия приостановлена.'
        });
        
        // Send updated ball state
        io.to(sessionId).emit('ball-state', { 
          ...session.ball, 
          radius: session.ball.radius,
          colorBall: session.colors?.ball,
          colorBg: session.colors?.bg,
          width: w,
          height: h
        });
        
        // Send specific notification to viewers
        io.to(sessionId).emit('controller-disconnected', { 
          message: 'Контроллер отключился. Ожидание нового подключения...',
          sessionId: sessionId
        });
        
        console.log(`Controller disconnected from session ${sessionId}`);
      }
      
      if (wasViewer) {
        // Viewer disconnected
        if (room && room.size === 1 && session.controllerId) {
          // Only controller left, reset session
          const w = (session.world && session.world.width) || DEFAULT_WORLD_WIDTH;
          const h = (session.world && session.world.height) || DEFAULT_WORLD_HEIGHT;
          session.ball.x = w / 2;
          session.ball.y = h / 2;
          session.ball.vx = 0;
          session.ball.vy = 0;
          session.paused = true;
          session.viewerJoined = false;
          
          // Notify controller that viewer left
          io.to(session.controllerId).emit('viewer-left', { 
            message: 'Зритель отключился. Сессия сброшена.',
            sessionId: sessionId
          });
          
          // Send updated ball state
          io.to(sessionId).emit('ball-state', { 
            ...session.ball, 
            radius: session.ball.radius,
            colorBall: session.colors?.ball,
            colorBg: session.colors?.bg,
            width: w,
            height: h
          });
          
          console.log(`Viewer disconnected from session ${sessionId}, session reset`);
        }
      }
    }
  });
});

// Enhanced session cleanup with better error handling and logging
setInterval(() => {
  try {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000; // 1 hour for active sessions
    const tenMinutes = 10 * 60 * 1000; // 10 minutes for inactive sessions
    const fiveMinutes = 5 * 60 * 1000; // 5 minutes for sessions without viewers
    
    let cleanedCount = 0;
    let expiredCount = 0;
    
    for (const [sessionId, session] of sessions.entries()) {
      try {
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
          io.to(sessionId).emit('session-expired', { 
            message: 'Сессия истекла (1 час). Создайте новую сессию.',
            sessionId: sessionId
          });
          expiredCount++;
          console.log(`Session expired (1 hour): ${sessionId}`);
          continue;
        }
        
        // Clean up sessions without viewers quickly (5 minutes)
        if (hasController && !hasViewer && session.createdAt && (now - session.createdAt) > fiveMinutes) {
          sessions.delete(sessionId);
          io.to(sessionId).emit('session-expired', { 
            message: 'Зритель не подключился в течение 5 минут. Создайте новую сессию.',
            sessionId: sessionId
          });
          cleanedCount++;
          console.log(`Session cleaned (no viewer): ${sessionId}`);
          continue;
        }
        
        // Clean up inactive sessions (10 minutes without activity)
        if (!hasActiveUsers && session.lastActivity && (now - session.lastActivity) > tenMinutes) {
          sessions.delete(sessionId);
          io.to(sessionId).emit('session-expired', { 
            message: 'Сессия неактивна 10 минут. Создайте новую сессию.',
            sessionId: sessionId
          });
          cleanedCount++;
          console.log(`Session cleaned (inactive): ${sessionId}`);
        }
      } catch (sessionError) {
        console.error(`Error processing session ${sessionId} during cleanup:`, sessionError);
        // Remove corrupted session
        try {
          sessions.delete(sessionId);
          console.log(`Corrupted session removed: ${sessionId}`);
        } catch (deleteError) {
          console.error(`Failed to remove corrupted session ${sessionId}:`, deleteError);
        }
      }
    }
    
    // Log cleanup summary
    if (cleanedCount > 0 || expiredCount > 0) {
      console.log(`Session cleanup completed: ${cleanedCount} cleaned, ${expiredCount} expired`);
    }
    
  } catch (error) {
    console.error('Error during session cleanup:', error);
  }
}, 60000); // Check every minute

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Sessions: 1 hour max, 10 min inactive, 5 min no viewer`);
});


