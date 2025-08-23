const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Функция создания сервера для кластерного режима
function createServer() {
  const app = express();
  const server = http.createServer(app);

  // Socket.IO с оптимизациями для слабого сервера
  const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'], // Приоритет WebSocket
    pingTimeout: 30000, // Уменьшенный timeout
    pingInterval: 25000, // Уменьшенный интервал
    maxHttpBufferSize: 1e6, // Ограничение размера буфера
    allowEIO3: false, // Отключение старых версий
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

const PORT = process.env.PORT || 3000;
const DEFAULT_WORLD_WIDTH = 800;
const DEFAULT_WORLD_HEIGHT = 600;

// Конфигурация для слабого сервера
const SERVER_CONFIG = {
  MAX_SESSIONS: 50, // Максимум активных сессий
  MAX_VIEWERS_PER_SESSION: 10, // Максимум зрителей на сессию
  TICK_RATE: 30, // Сниженный FPS для экономии ресурсов
  CLEANUP_INTERVAL: 120000, // Увеличенный интервал очистки (2 минуты)
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 минут вместо 1 часа
  INACTIVE_TIMEOUT: 5 * 60 * 1000, // 5 минут неактивности
  NO_VIEWER_TIMEOUT: 3 * 60 * 1000 // 3 минуты без зрителя
};

// In-memory session store с ограничениями
const sessions = new Map();
const connectionCounts = new Map(); // Подсчет подключений по IP
const bannedIPs = new Set(); // Заблокированные IP

// Защита от DDoS
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 минута
  max: 100, // Максимум 100 запросов в минуту
  message: 'Слишком много запросов, попробуйте позже',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/s/') || req.path.startsWith('/c/') // Пропуск статических страниц
});

// Дополнительный лимитер для API
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20, // Максимум 20 API запросов в минуту
  message: 'API лимит превышен',
  standardHeaders: true,
  legacyHeaders: false
});

// Лимитер для сокет-подключений
const socketLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5, // Максимум 5 подключений в минуту
  message: 'Слишком много подключений',
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware для безопасности
app.use(helmet({
  contentSecurityPolicy: false, // Отключаем для Socket.IO
  crossOriginEmbedderPolicy: false
}));

app.use(compression()); // Сжатие ответов
app.use(limiter);
app.use(express.json({ limit: '10kb' })); // Ограничение размера JSON
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cors({ 
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Статические файлы с кэшированием
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));

// Middleware для проверки IP
app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
  
  // Проверка заблокированных IP
  if (bannedIPs.has(clientIP)) {
    return res.status(403).json({ error: 'IP заблокирован' });
  }
  
  // Подсчет подключений
  const currentCount = connectionCounts.get(clientIP) || 0;
  if (currentCount > 20) { // Максимум 20 подключений с одного IP
    bannedIPs.add(clientIP);
    console.log(`IP ${clientIP} заблокирован за превышение лимита подключений`);
    return res.status(403).json({ error: 'Превышен лимит подключений' });
  }
  
  connectionCounts.set(clientIP, currentCount + 1);
  next();
});

// API endpoints с защитой
app.post('/api/session', apiLimiter, (req, res) => {
  // Проверка лимита сессий
  if (sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
    return res.status(503).json({ error: 'Сервер перегружен, попробуйте позже' });
  }
  
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 150;
  const initialBall = { 
    x: DEFAULT_WORLD_WIDTH/2, 
    y: DEFAULT_WORLD_HEIGHT/2, 
    vx: 0, 
    vy: 0, 
    speed: baseSpeed, 
    radius: 20 
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
  
  res.json({ sessionId });
});

app.get('/api/session/new', apiLimiter, (req, res) => {
  if (sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
    return res.status(503).json({ error: 'Сервер перегружен, попробуйте позже' });
  }
  
  const sessionId = uuidv4().slice(0, 6);
  const baseSpeed = 150;
  const initialBall = { 
    x: DEFAULT_WORLD_WIDTH/2, 
    y: DEFAULT_WORLD_HEIGHT/2, 
    vx: 0, 
    vy: 0, 
    speed: baseSpeed, 
    radius: 20 
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
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Кэширование на 1 час
  res.sendFile(path.join(__dirname, 'public', 'config.js'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    sessions: sessions.size,
    maxSessions: SERVER_CONFIG.MAX_SESSIONS,
    uptime: process.uptime()
  });
});

// Socket.IO с защитой от DDoS
io.use((socket, next) => {
  const clientIP = socket.handshake.address;
  
  if (bannedIPs.has(clientIP)) {
    return next(new Error('IP заблокирован'));
  }
  
  // Проверка лимита подключений
  const currentCount = connectionCounts.get(clientIP) || 0;
  if (currentCount > SERVER_CONFIG.MAX_VIEWERS_PER_SESSION) {
    bannedIPs.add(clientIP);
    console.log(`IP ${clientIP} заблокирован за превышение лимита сокет-подключений`);
    return next(new Error('Превышен лимит подключений'));
  }
  
  next();
});

io.on('connection', (socket) => {
  const clientIP = socket.handshake.address;
  console.log(`Socket connected from ${clientIP}`);
  
  socket.on('join-session', ({ sessionId, role }) => {
    try {
      // Валидация входных данных
      if (!sessionId || typeof sessionId !== 'string' || sessionId.length > 10) {
        socket.emit('error-message', 'Неверный ID сессии');
        return;
      }
      
      if (!role || !['controller', 'viewer'].includes(role)) {
        socket.emit('error-message', 'Неверная роль');
        return;
      }
      
      // Проверка лимита сессий
      if (!sessions.has(sessionId) && sessions.size >= SERVER_CONFIG.MAX_SESSIONS) {
        socket.emit('error-message', 'Сервер перегружен');
        return;
      }
      
      // Создание сессии если не существует
      if (!sessions.has(sessionId)) {
        const baseSpeed = 150;
        sessions.set(sessionId, {
          controllerId: null,
          ball: { 
            x: DEFAULT_WORLD_WIDTH/2, 
            y: DEFAULT_WORLD_HEIGHT/2, 
            vx: 0, 
            vy: 0, 
            speed: baseSpeed, 
            radius: 20 
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
        console.log(`New session created: ${sessionId}`);
      }
      
      const session = sessions.get(sessionId);
      if (!session) {
        socket.emit('error-message', 'Ошибка создания сессии');
        return;
      }
      
      // Проверка лимита зрителей
      if (role === 'viewer' && session.viewerCount >= SERVER_CONFIG.MAX_VIEWERS_PER_SESSION) {
        socket.emit('error-message', 'Достигнут лимит зрителей для этой сессии');
        return;
      }
      
      socket.join(sessionId);
      session.lastActivity = Date.now();
      
      if (role === 'controller') {
        if (session.controllerId && session.controllerId !== socket.id) {
          socket.emit('error-message', 'Контроллер уже подключен');
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
          message: 'Контроллер подключился к сессии'
        });
        
        console.log(`Controller joined session: ${sessionId}`);
        
      } else {
        session.viewerCount++;
        session.viewerJoined = true;
        
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
        
        if (session.controllerId) {
          io.to(session.controllerId).emit('viewer-joined', { 
            message: 'Зритель подключился к сессии',
            sessionId: sessionId
          });
        }
        
        console.log(`Viewer joined session: ${sessionId}, total viewers: ${session.viewerCount}`);
      }
      
    } catch (error) {
      console.error(`Error joining session:`, error);
      socket.emit('error-message', 'Ошибка подключения к сессии');
    }
  });
  
  // Оптимизированная обработка world-size
  socket.on('world-size', ({ sessionId, width, height }) => {
    try {
      if (!sessionId || !sessions.has(sessionId)) return;
      
      const session = sessions.get(sessionId);
      const w = Number(width);
      const h = Number(height);
      
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 100 || h < 100 || w > 5000 || h > 5000) {
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
      console.error(`Error updating world size:`, error);
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
      const multiplier = typeof speedMultiplier === 'number' && speedMultiplier > 0 ? Math.min(speedMultiplier, 5) : 1; // Уменьшен лимит
      const clampedScalar = typeof speedScalar === 'number' ? Math.max(0, Math.min(100, speedScalar)) : undefined;
      const targetSpeed = typeof clampedScalar === 'number' ? Math.round((clampedScalar / 100) * 300) : base * multiplier;
      
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
      if (typeof radius === 'number' && radius >= 5 && radius <= 60) {
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
      console.error(`Error in control-update:`, error);
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
            message: 'Контроллер отключился. Сессия приостановлена.'
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
            message: 'Контроллер отключился. Ожидание нового подключения...',
            sessionId: sessionId
          });
          
          console.log(`Controller disconnected from session ${sessionId}`);
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
              message: 'Зритель отключился. Сессия сброшена.',
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
            
            console.log(`Viewer disconnected from session ${sessionId}, session reset`);
          }
        }
      }
      
      console.log(`Socket disconnected from ${clientIP}`);
      
    } catch (error) {
      console.error(`Error handling disconnect:`, error);
    }
  });
});

// Оптимизированный цикл анимации с пониженной частотой
const interval = setInterval(() => {
  try {
    let activeSessions = 0;
    let totalViewers = 0;
    
    for (const [sessionId, session] of sessions) {
      try {
        const ball = session.ball;
        const dt = 1 / SERVER_CONFIG.TICK_RATE; // Пониженный FPS
        const maxSpeed = ball.speed || 220;

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
        const radius = ball.radius || 20;
        
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
              console.error(`Error emitting ball state:`, emitError);
            }
          }
        }
        
      } catch (sessionError) {
        console.error(`Error processing session ${sessionId}:`, sessionError);
        try {
          const w = session.world?.width || DEFAULT_WORLD_WIDTH;
          const h = session.world?.height || DEFAULT_WORLD_HEIGHT;
          session.ball.x = w / 2;
          session.ball.y = h / 2;
          session.ball.vx = 0;
          session.ball.vy = 0;
          session.paused = true;
        } catch (recoveryError) {
          console.error(`Failed to recover session ${sessionId}:`, recoveryError);
        }
      }
    }
    
    // Логирование каждые 100 тиков
    if (Math.random() < 0.01) {
      console.log(`Performance: ${activeSessions} active sessions, ${totalViewers} total viewers`);
    }
    
  } catch (error) {
    console.error('Critical error in animation loop:', error);
  }
}, 1000 / SERVER_CONFIG.TICK_RATE);

// Оптимизированная очистка сессий
setInterval(() => {
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
            message: 'Сессия истекла (30 минут). Создайте новую сессию.',
            sessionId: sessionId
          });
          expiredCount++;
          continue;
        }
        
        // Очистка без зрителей
        if (hasController && !hasViewer && session.createdAt && (now - session.createdAt) > SERVER_CONFIG.NO_VIEWER_TIMEOUT) {
          sessions.delete(sessionId);
          io.to(sessionId).emit('session-expired', { 
            message: 'Зритель не подключился в течение 3 минут. Создайте новую сессию.',
            sessionId: sessionId
          });
          cleanedCount++;
          continue;
        }
        
        // Очистка неактивных
        if (!hasActiveUsers && session.lastActivity && (now - session.lastActivity) > SERVER_CONFIG.INACTIVE_TIMEOUT) {
          sessions.delete(sessionId);
          io.to(sessionId).emit('session-expired', { 
            message: 'Сессия неактивна 5 минут. Создайте новую сессию.',
            sessionId: sessionId
          });
          cleanedCount++;
        }
        
      } catch (sessionError) {
        console.error(`Error processing session ${sessionId} during cleanup:`, sessionError);
        try {
          sessions.delete(sessionId);
        } catch (deleteError) {
          console.error(`Failed to remove corrupted session ${sessionId}:`, deleteError);
        }
      }
    }
    
    if (cleanedCount > 0 || expiredCount > 0) {
      console.log(`Session cleanup: ${cleanedCount} cleaned, ${expiredCount} expired`);
    }
    
  } catch (error) {
    console.error('Error during session cleanup:', error);
  }
}, SERVER_CONFIG.CLEANUP_INTERVAL);

// Очистка заблокированных IP каждые 10 минут
setInterval(() => {
  bannedIPs.clear();
  console.log('Banned IPs cleared');
}, 10 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  clearInterval(interval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  clearInterval(interval);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

  server.listen(PORT, () => {
    console.log(`Worker ${process.pid} listening on http://localhost:${PORT}`);
    console.log(`Max sessions: ${SERVER_CONFIG.MAX_SESSIONS}, Tick rate: ${SERVER_CONFIG.TICK_RATE} FPS`);
    console.log(`DDoS protection enabled, rate limiting active`);
  });
}

// Экспорт функции для кластерного режима
module.exports = { createServer };

// Запуск сервера если файл запущен напрямую
if (require.main === module) {
  createServer();
} 