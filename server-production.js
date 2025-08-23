const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Конфигурация логирования для продакшена
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn'; // error, warn, info, debug
const isProduction = process.env.NODE_ENV === 'production';

// Умное логирование
const logger = {
  error: (msg, ...args) => {
    if (LOG_LEVEL === 'error' || LOG_LEVEL === 'warn' || LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.error(`[ERROR] ${msg}`, ...args);
    }
  },
  warn: (msg, ...args) => {
    if (LOG_LEVEL === 'warn' || LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.warn(`[WARN] ${msg}`, ...args);
    }
  },
  info: (msg, ...args) => {
    if (LOG_LEVEL === 'info' || LOG_LEVEL === 'debug') {
      console.info(`[INFO] ${msg}`, ...args);
    }
  },
  debug: (msg, ...args) => {
    if (LOG_LEVEL === 'debug') {
      console.log(`[DEBUG] ${msg}`, ...args);
    }
  }
};

// Функция создания сервера для кластерного режима
function createServer() {
  const app = express();
  const server = http.createServer(app);

  // Socket.IO с оптимизациями для продакшена
  const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 25000,
    maxHttpBufferSize: 1e6,
    allowEIO3: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = process.env.PORT || 3000;
  const DEFAULT_WORLD_WIDTH = 800;
  const DEFAULT_WORLD_HEIGHT = 600;

  // Оптимизированная конфигурация для onrender.com
  const SERVER_CONFIG = {
    MAX_SESSIONS: parseInt(process.env.MAX_SESSIONS) || 30, // Уменьшено для onrender.com
    MAX_VIEWERS_PER_SESSION: parseInt(process.env.MAX_VIEWERS_PER_SESSION) || 5, // Уменьшено
    TICK_RATE: parseInt(process.env.TICK_RATE) || 20, // Еще меньше FPS
    CLEANUP_INTERVAL: parseInt(process.env.CLEANUP_INTERVAL) || 300000, // 5 минут
    SESSION_TIMEOUT: parseInt(process.env.SESSION_TIMEOUT) || 20 * 60 * 1000, // 20 минут
    INACTIVE_TIMEOUT: parseInt(process.env.INACTIVE_TIMEOUT) || 3 * 60 * 1000, // 3 минуты
    NO_VIEWER_TIMEOUT: parseInt(process.env.NO_VIEWER_TIMEOUT) || 2 * 60 * 1000, // 2 минуты
    ENABLE_LOGGING: process.env.ENABLE_LOGGING !== 'false',
    ENABLE_METRICS: process.env.ENABLE_METRICS !== 'false'
  };

  // In-memory session store с оптимизациями
  const sessions = new Map();
  const connectionCounts = new Map();
  const bannedIPs = new Set();
  const metrics = {
    totalSessions: 0,
    totalViewers: 0,
    totalConnections: 0,
    totalErrors: 0,
    startTime: Date.now()
  };

  // Адаптивные лимитеры для onrender.com
  const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 50, // Уменьшено
    message: { error: 'Rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith('/s/') || req.path.startsWith('/c/') || req.path === '/health'
  });

  const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: parseInt(process.env.API_RATE_LIMIT) || 10, // Уменьшено
    message: { error: 'API rate limit exceeded' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Middleware для безопасности
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: false // Отключаем для HTTP
  }));

  app.use(compression());
  app.use(limiter);
  app.use(express.json({ limit: '5kb' })); // Уменьшено
  app.use(express.urlencoded({ extended: true, limit: '5kb' }));
  app.use(cors({ 
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
  }));

  // Статические файлы с оптимизированным кэшированием
  app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '24h', // Увеличено для onrender.com
    etag: true,
    lastModified: true,
    immutable: true
  }));

  // Middleware для проверки IP с оптимизацией
  app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    
    if (bannedIPs.has(clientIP)) {
      return res.status(403).json({ error: 'IP banned' });
    }
    
    const currentCount = connectionCounts.get(clientIP) || 0;
    if (currentCount > 10) { // Уменьшено
      bannedIPs.add(clientIP);
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.warn(`IP ${clientIP} banned for connection limit`);
      }
      return res.status(403).json({ error: 'Connection limit exceeded' });
    }
    
    connectionCounts.set(clientIP, currentCount + 1);
    next();
  });

  // API endpoints с оптимизацией
  app.post('/api/session', apiLimiter, (req, res) => {
    if (sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
      return res.status(503).json({ error: 'Server overloaded' });
    }
    
    const sessionId = uuidv4().slice(0, 6);
    const baseSpeed = 120; // Уменьшено
    const initialBall = { 
      x: DEFAULT_WORLD_WIDTH/2, 
      y: DEFAULT_WORLD_HEIGHT/2, 
      vx: 0, 
      vy: 0, 
      speed: baseSpeed, 
      radius: 15 // Уменьшено
    };
    
    sessions.set(sessionId, {
      controllerId: null,
      ball: initialBall,
      world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
      paused: true,
      lastDir: { x: 1, y: 0 },
      createdAt: Date.now(),
      lastActivity: Date.now(),
      viewerJoined: false,
      colors: { ball: '#60a5fa', bg: '#020617' },
      viewerCount: 0,
      controllerConnected: false
    });
    
    metrics.totalSessions++;
    res.json({ sessionId });
  });

  app.get('/api/session/new', apiLimiter, (req, res) => {
    if (sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
      return res.status(503).json({ error: 'Server overloaded' });
    }
    
    const sessionId = uuidv4().slice(0, 6);
    const baseSpeed = 120;
    const initialBall = { 
      x: DEFAULT_WORLD_WIDTH/2, 
      y: DEFAULT_WORLD_HEIGHT/2, 
      vx: 0, 
      vy: 0, 
      speed: baseSpeed, 
      radius: 15
    };
    
    sessions.set(sessionId, {
      controllerId: null,
      ball: initialBall,
      world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
      paused: true,
      lastDir: { x: 1, y: 0 },
      createdAt: Date.now(),
      lastActivity: Date.now(),
      viewerJoined: false,
      colors: { ball: '#60a5fa', bg: '#020617' },
      viewerCount: 0,
      controllerConnected: false
    });
    
    metrics.totalSessions++;
    res.json({ sessionId });
  });

  // Статические страницы
  app.get('/s/:sessionId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
  });

  app.get('/c/:sessionId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'controller.html'));
  });

  app.get('/config.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 24 часа
    res.sendFile(path.join(__dirname, 'public', 'config.js'));
  });

  // Оптимизированный health check
  app.get('/health', (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    res.json({ 
      status: 'ok', 
      uptime: Math.round(uptime),
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      },
      sessions: sessions.size,
      maxSessions: SERVER_CONFIG.MAX_SESSIONS,
      connections: metrics.totalConnections
    });
  });

  // Метрики для мониторинга
  if (SERVER_CONFIG.ENABLE_METRICS) {
    app.get('/metrics', (req, res) => {
      res.setHeader('Content-Type', 'text/plain');
      res.send(`
# HELP bilateral_sessions_total Total sessions created
# TYPE bilateral_sessions_total counter
bilateral_sessions_total ${metrics.totalSessions}

# HELP bilateral_viewers_total Total viewers connected
# TYPE bilateral_viewers_total counter
bilateral_viewers_total ${metrics.totalViewers}

# HELP bilateral_connections_active Active connections
# TYPE bilateral_connections_active gauge
bilateral_connections_active ${metrics.totalConnections}

# HELP bilateral_errors_total Total errors
# TYPE bilateral_errors_total counter
bilateral_errors_total ${metrics.totalErrors}

# HELP bilateral_uptime_seconds Server uptime
# TYPE bilateral_uptime_seconds gauge
bilateral_uptime_seconds ${Math.round((Date.now() - metrics.startTime) / 1000)}
      `);
    });
  }

  // Socket.IO с защитой от DDoS
  io.use((socket, next) => {
    const clientIP = socket.handshake.address;
    
    if (bannedIPs.has(clientIP)) {
      return next(new Error('IP banned'));
    }
    
    const currentCount = connectionCounts.get(clientIP) || 0;
    if (currentCount > SERVER_CONFIG.MAX_VIEWERS_PER_SESSION) {
      bannedIPs.add(clientIP);
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.warn(`IP ${clientIP} banned for socket limit`);
      }
      return next(new Error('Connection limit exceeded'));
    }
    
    next();
  });

  io.on('connection', (socket) => {
    const clientIP = socket.handshake.address;
    metrics.totalConnections++;
    
    if (SERVER_CONFIG.ENABLE_LOGGING) {
      logger.debug(`Socket connected from ${clientIP}`);
    }
    
    socket.on('join-session', ({ sessionId, role }) => {
      try {
        if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 10) {
          socket.emit('error-message', 'Invalid session ID');
          return;
        }
        
        if (!role || !['controller', 'viewer'].includes(role)) {
          socket.emit('error-message', 'Invalid role');
          return;
        }
        
        if (!sessions.has(sessionId) && sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
          socket.emit('error-message', 'Server overloaded');
          return;
        }
        
        if (!sessions.has(sessionId)) {
          const baseSpeed = 120;
          sessions.set(sessionId, {
            controllerId: null,
            ball: { 
              x: DEFAULT_WORLD_WIDTH/2, 
              y: DEFAULT_WORLD_HEIGHT/2, 
              vx: 0, 
              vy: 0, 
              speed: baseSpeed, 
              radius: 15
            },
            world: { width: DEFAULT_WORLD_WIDTH, height: DEFAULT_WORLD_HEIGHT },
            paused: true,
            lastDir: { x: 1, y: 0 },
            createdAt: Date.now(),
            lastActivity: Date.now(),
            viewerJoined: false,
            colors: { ball: '#60a5fa', bg: '#020617' },
            viewerCount: 0,
            controllerConnected: false
          });
          
          if (SERVER_CONFIG.ENABLE_LOGGING) {
            logger.info(`New session created: ${sessionId}`);
          }
        }
        
        const session = sessions.get(sessionId);
        if (!session) {
          socket.emit('error-message', 'Session creation error');
          return;
        }
        
        socket.join(sessionId);
        session.lastActivity = Date.now();
        
        if (role === 'controller') {
          if (session.controllerId && session.controllerId !== socket.id) {
            socket.emit('error-message', 'Controller already connected');
            return;
          }
          
          session.controllerId = socket.id;
          session.controllerConnected = true;
          
          socket.emit('ball-state', { 
            ...session.ball, 
            radius: session.ball.radius,
            colorBall: session.colors?.ball,
            colorBg: session.colors?.bg,
            width: session.world?.width,
            height: session.world?.height
          });
          
          io.to(sessionId).emit('role-update', { 
            hasController: true,
            message: 'Controller connected'
          });
          
          if (SERVER_CONFIG.ENABLE_LOGGING) {
            logger.info(`Controller joined session: ${sessionId}`);
          }
          
        } else {
          if (session.viewerCount >= SERVER_CONFIG.MAX_VIEWERS_PER_SESSION) {
            socket.emit('error-message', 'Viewer limit reached');
            return;
          }
          
          session.viewerCount++;
          session.viewerJoined = true;
          metrics.totalViewers++;
          
          socket.emit('ball-state', { 
            ...session.ball,
            colorBall: session.colors?.ball,
            colorBg: session.colors?.bg,
            width: session.world?.width,
            height: session.world?.height
          });
          
          socket.emit('role-update', { 
            hasController: !!session.controllerId,
            message: session.controllerId ? 'Controller active' : 'Waiting for controller'
          });
          
          if (session.controllerId) {
            io.to(session.controllerId).emit('viewer-joined', { 
              message: 'Viewer connected',
              sessionId: sessionId
            });
          }
          
          if (SERVER_CONFIG.ENABLE_LOGGING) {
            logger.debug(`Viewer joined session: ${sessionId}, total: ${session.viewerCount}`);
          }
        }
        
      } catch (error) {
        metrics.totalErrors++;
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.error(`Error joining session:`, error);
        }
        socket.emit('error-message', 'Connection error');
      }
    });
    
    // Оптимизированная обработка world-size
    socket.on('world-size', ({ sessionId, width, height }) => {
      try {
        if (!sessionId || !sessions.has(sessionId)) return;
        
        const session = sessions.get(sessionId);
        const w = Number(width);
        const h = Number(height);
        
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100 || w > 3000 || h > 3000) {
          return; // Игнорируем некорректные размеры
        }
        
        session.world = { width: w, height: h };
        
        if (session.paused || (Math.abs(session.ball.vx) < 1 && Math.abs(session.ball.vy) < 1)) {
          session.ball.x = w / 2;
          session.ball.y = h / 2;
          session.ball.vx = 0;
          session.ball.vy = 0;
        }
        
      } catch (error) {
        metrics.totalErrors++;
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.error(`Error updating world size:`, error);
        }
      }
    });
    
    // Оптимизированная обработка control-update
    socket.on('control-update', ({ sessionId, input }) => {
      try {
        if (!sessionId || !input || typeof input !== 'object') return;
        
        const session = sessions.get(sessionId);
        if (!session || session.controllerId !== socket.id) return;
        
        session.lastActivity = Date.now();
        
        const { dirX, dirY, speedMultiplier, speedScalar, reset, pause, resume, colorBall, colorBg, radius } = input;
        
        // Обработка pause/resume/reset
        if (pause === true) {
          session.paused = true;
          return;
        }
        
        if (resume === true) {
          session.paused = false;
          if (!session.lastDir) {
            session.lastDir = { x: 1, y: 0 };
          }
          const currentSpeed = session.ball.speed || 120;
          session.ball.vx = session.lastDir.x * currentSpeed;
          session.ball.vy = session.lastDir.y * currentSpeed;
          
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
        
        if (reset) {
          const w = session.world?.width || DEFAULT_WORLD_WIDTH;
          const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
          session.ball.x = w / 2;
          session.ball.y = h / 2;
          session.ball.vx = 0;
          session.ball.vy = 0;
          session.paused = true;
          return;
        }
        
        // Обработка скорости
        const base = 120;
        const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 3) : 1; // Уменьшен лимит
        const clampedScalar = typeof speedScalar === 'number' ? Math.max(0, Math.min(100, speedScalar)) : undefined;
        const targetSpeed = typeof clampedScalar === 'number' ? Math.round((clampedScalar / 100) * 200) : base * multiplier; // Уменьшена максимальная скорость
        
        if (session.ball.speed !== targetSpeed) {
          session.ball.speed = targetSpeed;
          if (!session.paused && session.lastDir) {
            session.ball.vx = session.lastDir.x * targetSpeed;
            session.ball.vy = session.lastDir.y * targetSpeed;
          }
        }
        
        // Обработка направления
        if (typeof dirX === 'number' && typeof dirY === 'number') {
          if (!Number.isFinite(dirX) || !Number.isFinite(dirY)) return;
          
          const mag = Math.hypot(dirX, dirY);
          if (mag > 0) {
            const newDir = { x: dirX / mag, y: dirY / mag };
            if (!session.lastDir || Math.abs(session.lastDir.x - newDir.x) > 0.01 || Math.abs(session.lastDir.y - newDir.y) > 0.01) {
              session.lastDir = newDir;
              if (!session.paused) {
                session.ball.vx = session.lastDir.x * session.ball.speed;
                session.ball.vy = session.lastDir.y * session.ball.speed;
              }
            }
          } else if (dirX === 0 && dirY === 0) {
            session.ball.vx = 0;
            session.ball.vy = 0;
          }
        }
        
        // Обработка визуальных изменений
        if (typeof radius === 'number' && radius >= 5 && radius <= 40) { // Уменьшен максимальный радиус
          const r = Math.round(radius);
          if (session.ball.radius !== r) {
            session.ball.radius = r;
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
        
        // Обработка цветов
        if (!session.colors) session.colors = { ball: '#60a5fa', bg: '#020617' };
        let colorsChanged = false;
        
        if (typeof colorBall === 'string' && /^#[0-9A-Fa-f]{6}$/.test(colorBall) && session.colors.ball !== colorBall) {
          session.colors.ball = colorBall;
          colorsChanged = true;
        }
        
        if (typeof colorBg === 'string' && /^#[0-9A-Fa-f]{6}$/.test(colorBg) && session.colors.bg !== colorBg) {
          session.colors.bg = colorBg;
          colorsChanged = true;
        }
        
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
        
      } catch (error) {
        metrics.totalErrors++;
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.error(`Error in control-update:`, error);
        }
      }
    });
    
    // Обработка отключения
    socket.on('disconnect', () => {
      try {
        const clientIP = socket.handshake.address;
        const currentCount = connectionCounts.get(clientIP) || 0;
        if (currentCount > 0) {
          connectionCounts.set(clientIP, currentCount - 1);
        }
        
        for (const [sessionId, session] of sessions) {
          const room = io.sockets.adapter.rooms.get(sessionId);
          const wasController = session.controllerId === socket.id;
          const wasViewer = room && room.has(socket.id);
          
          if (wasController) {
            session.controllerId = null;
            session.controllerConnected = false;
            session.paused = true;
            
            const w = session.world?.width || DEFAULT_WORLD_WIDTH;
            const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
            session.ball.x = w / 2;
            session.ball.y = h / 2;
            session.ball.vx = 0;
            session.ball.vy = 0;
            
            io.to(sessionId).emit('role-update', { 
              hasController: false,
              message: 'Controller disconnected. Session paused.'
            });
            
            io.to(sessionId).emit('ball-state', { 
              ...session.ball, 
              radius: session.ball.radius,
              colorBall: session.colors?.ball,
              colorBg: session.colors?.bg,
              width: w,
              height: h
            });
            
            io.to(sessionId).emit('controller-disconnected', { 
              message: 'Controller disconnected. Waiting for new connection...',
              sessionId: sessionId
            });
            
            if (SERVER_CONFIG.ENABLE_LOGGING) {
              logger.info(`Controller disconnected from session ${sessionId}`);
            }
          }
          
          if (wasViewer) {
            session.viewerCount = Math.max(0, session.viewerCount - 1);
            if (room && room.size === 1 && session.controllerId) {
              const w = session.world?.width || DEFAULT_WORLD_WIDTH;
              const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
              session.ball.x = w / 2;
              session.ball.y = h / 2;
              session.ball.vx = 0;
              session.ball.vy = 0;
              session.paused = true;
              session.viewerJoined = false;
              
              io.to(session.controllerId).emit('viewer-left', { 
                message: 'Viewer disconnected. Session reset.',
                sessionId: sessionId
              });
              
              io.to(sessionId).emit('ball-state', { 
                ...session.ball, 
                radius: session.ball.radius,
                colorBall: session.colors?.ball,
                colorBg: session.colors?.bg,
                width: w,
                height: h
              });
              
              if (SERVER_CONFIG.ENABLE_LOGGING) {
                logger.debug(`Viewer disconnected from session ${sessionId}, session reset`);
              }
            }
          }
        }
        
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.debug(`Socket disconnected from ${clientIP}`);
        }
        
      } catch (error) {
        metrics.totalErrors++;
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.error(`Error handling disconnect:`, error);
        }
      }
    });
  });

  // Оптимизированный цикл анимации
  const interval = setInterval(() => {
    try {
      let activeSessions = 0;
      let totalViewers = 0;
      
      for (const [sessionId, session] of sessions) {
        try {
          const ball = session.ball;
          const dt = 1 / SERVER_CONFIG.TICK_RATE;
          const maxSpeed = ball.speed || 180; // Уменьшено

          // Валидация состояния мячика
          if (!ball || typeof ball.x !== 'number' || typeof ball.y !== 'number' || 
              !Number.isFinite(ball.x) || !Number.isFinite(ball.y)) {
            const w = session.world?.width || DEFAULT_WORLD_WIDTH;
            const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
            ball.x = w / 2;
            ball.y = h / 2;
            ball.vx = 0;
            ball.vy = 0;
            continue;
          }

          // Упрощенная физика для экономии ресурсов
          if (!session.paused) {
            ball.x += ball.vx * dt;
            ball.y += ball.vy * dt;
          }

          // Проверка границ
          const width = session.world?.width || DEFAULT_WORLD_WIDTH;
          const height = session.world?.height || DEFAULT_WORLD_HEIGHT;
          const radius = ball.radius || 15;
          
          if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100) {
            continue;
          }
          
          // Упрощенные отскоки
          if (ball.x <= radius) { 
            ball.x = radius; 
            ball.vx = Math.abs(ball.vx) * 0.95;
          }
          if (ball.x >= width - radius) { 
            ball.x = width - radius; 
            ball.vx = -Math.abs(ball.vx) * 0.95;
          }
          if (ball.y <= radius) { 
            ball.y = radius; 
            ball.vy = Math.abs(ball.vy) * 0.95;
          }
          if (ball.y >= height - radius) { 
            ball.y = height - radius; 
            ball.vy = -Math.abs(ball.vy) * 0.95;
          }

          // Отправка только при наличии зрителей и движении
          const room = io.sockets.adapter.rooms.get(sessionId);
          const hasViewers = room && room.size > 1;
          
          if (hasViewers) {
            activeSessions++;
            totalViewers += room.size - 1;
            
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
                metrics.totalErrors++;
                if (SERVER_CONFIG.ENABLE_LOGGING) {
                  logger.error(`Error emitting ball state:`, emitError);
                }
              }
            }
          }
          
        } catch (sessionError) {
          metrics.totalErrors++;
          if (SERVER_CONFIG.ENABLE_LOGGING) {
            logger.error(`Error processing session ${sessionId}:`, sessionError);
          }
          try {
            const w = session.world?.width || DEFAULT_WORLD_WIDTH;
            const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
            session.ball.x = w / 2;
            session.ball.y = h / 2;
            session.ball.vx = 0;
            session.ball.vy = 0;
            session.paused = true;
          } catch (recoveryError) {
            if (SERVER_CONFIG.ENABLE_LOGGING) {
              logger.error(`Failed to recover session ${sessionId}:`, recoveryError);
            }
          }
        }
      }
      
      // Логирование производительности только при необходимости
      if (SERVER_CONFIG.ENABLE_LOGGING && Math.random() < 0.005) { // 0.5% шанс
        logger.info(`Performance: ${activeSessions} active sessions, ${totalViewers} total viewers`);
      }
      
    } catch (error) {
      metrics.totalErrors++;
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.error('Critical error in animation loop:', error);
      }
    }
  }, 1000 / SERVER_CONFIG.TICK_RATE);

  // Оптимизированная очистка сессий
  const cleanupInterval = setInterval(() => {
    try {
      const now = Date.now();
      let cleanedCount = 0;
      let expiredCount = 0;
      
      for (const [sessionId, session] of sessions.entries()) {
        try {
          const room = io.sockets.adapter.rooms.get(sessionId);
          const hasActiveUsers = room && room.size > 0;
          const hasViewer = session.viewerJoined;
          const hasController = session.controllerId;
          
          if (hasActiveUsers) {
            session.lastActivity = now;
          }
          
          // Очистка по таймауту
          if (session.createdAt && (now - session.createdAt) > SERVER_CONFIG.SESSION_TIMEOUT) {
            sessions.delete(sessionId);
            io.to(sessionId).emit('session-expired', { 
              message: 'Session expired. Create new session.',
              sessionId: sessionId
            });
            expiredCount++;
            continue;
          }
          
          // Очистка без зрителей
          if (hasController && !hasViewer && session.createdAt && (now - session.createdAt) > SERVER_CONFIG.NO_VIEWER_TIMEOUT) {
            sessions.delete(sessionId);
            io.to(sessionId).emit('session-expired', { 
              message: 'No viewer connected. Session expired.',
              sessionId: sessionId
            });
            cleanedCount++;
            continue;
          }
          
          // Очистка неактивных
          if (!hasActiveUsers && session.lastActivity && (now - session.lastActivity) > SERVER_CONFIG.INACTIVE_TIMEOUT) {
            sessions.delete(sessionId);
            io.to(sessionId).emit('session-expired', { 
              message: 'Session inactive. Create new session.',
              sessionId: sessionId
            });
            cleanedCount++;
          }
          
        } catch (sessionError) {
          metrics.totalErrors++;
          if (SERVER_CONFIG.ENABLE_LOGGING) {
            logger.error(`Error processing session ${sessionId} during cleanup:`, sessionError);
          }
          try {
            sessions.delete(sessionId);
          } catch (deleteError) {
            if (SERVER_CONFIG.ENABLE_LOGGING) {
              logger.error(`Failed to remove corrupted session ${sessionId}:`, deleteError);
            }
          }
        }
      }
      
      if (cleanedCount > 0 || expiredCount > 0) {
        if (SERVER_CONFIG.ENABLE_LOGGING) {
          logger.info(`Session cleanup: ${cleanedCount} cleaned, ${expiredCount} expired`);
        }
      }
      
    } catch (error) {
      metrics.totalErrors++;
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.error('Error during session cleanup:', error);
      }
    }
  }, SERVER_CONFIG.CLEANUP_INTERVAL);

  // Очистка заблокированных IP каждые 15 минут
  setInterval(() => {
    bannedIPs.clear();
    if (SERVER_CONFIG.ENABLE_LOGGING) {
      logger.debug('Banned IPs cleared');
    }
  }, 15 * 60 * 1000);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    if (SERVER_CONFIG.ENABLE_LOGGING) {
      logger.info('SIGTERM received, shutting down gracefully');
    }
    clearInterval(interval);
    clearInterval(cleanupInterval);
    server.close(() => {
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.info('Server closed');
      }
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    if (SERVER_CONFIG.ENABLE_LOGGING) {
      logger.info('SIGINT received, shutting down gracefully');
    }
    clearInterval(interval);
    clearInterval(cleanupInterval);
    server.close(() => {
      if (SERVER_CONFIG.ENABLE_LOGGING) {
        logger.info('Server closed');
      }
      process.exit(0);
    });
  });

  server.listen(PORT, () => {
    logger.info(`Worker ${process.pid} listening on port ${PORT}`);
    logger.info(`Max sessions: ${SERVER_CONFIG.MAX_SESSIONS}, Tick rate: ${SERVER_CONFIG.TICK_RATE} FPS`);
    logger.info(`DDoS protection enabled, rate limiting active`);
    logger.info(`Log level: ${LOG_LEVEL}, Metrics: ${SERVER_CONFIG.ENABLE_METRICS}`);
  });
}

// Экспорт функции для кластерного режима
module.exports = { createServer };

// Запуск сервера если файл запущен напрямую
if (require.main === module) {
  createServer();
} 