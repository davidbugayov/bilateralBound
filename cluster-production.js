const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { createServer } = require('./server-production');

// Конфигурация для продакшена
const PRODUCTION_CONFIG = {
  MAX_WORKERS: Math.min(numCPUs, 2), // Максимум 2 воркера для onrender.com
  WORKER_RESTART_DELAY: 5000, // 5 секунд задержка перезапуска
  HEALTH_CHECK_INTERVAL: 60000, // Проверка здоровья каждую минуту
  ENABLE_LOGGING: process.env.ENABLE_LOGGING !== 'false'
};

// Умное логирование
const logger = {
  info: (msg) => {
    if (PRODUCTION_CONFIG.ENABLE_LOGGING) {
      console.log(`[CLUSTER] ${msg}`);
    }
  },
  warn: (msg) => {
    if (PRODUCTION_CONFIG.ENABLE_LOGGING) {
      console.warn(`[CLUSTER] ${msg}`);
    }
  },
  error: (msg) => {
    console.error(`[CLUSTER] ${msg}`);
  }
};

if (cluster.isMaster) {
  logger.info(`Master ${process.pid} is running`);
  logger.info(`Starting ${PRODUCTION_CONFIG.MAX_WORKERS} workers...`);
  
  // Создание воркеров
  for (let i = 0; i < PRODUCTION_CONFIG.MAX_WORKERS; i++) {
    cluster.fork();
  }
  
  // Мониторинг воркеров
  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    
    // Задержка перед перезапуском
    setTimeout(() => {
      cluster.fork();
    }, PRODUCTION_CONFIG.WORKER_RESTART_DELAY);
  });
  
  // Мониторинг производительности
  let totalConnections = 0;
  let workerStats = new Map();
  
  setInterval(() => {
    const activeWorkers = Object.keys(cluster.workers).length;
    const totalMemory = Array.from(cluster.workers.values())
      .reduce((sum, worker) => sum + (workerStats.get(worker.id)?.memory || 0), 0);
    
    logger.info(`Status: ${activeWorkers} workers, ${totalConnections} connections, ${Math.round(totalMemory)}MB RAM`);
  }, PRODUCTION_CONFIG.HEALTH_CHECK_INTERVAL);
  
  // Обработка сигналов
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down cluster...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down cluster...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
  // Обработка сообщений от воркеров
  cluster.on('message', (worker, message) => {
    if (message.type === 'stats') {
      workerStats.set(worker.id, message.data);
    } else if (message.type === 'connections') {
      totalConnections = message.count;
    }
  });
  
} else {
  // Воркер процесс
  logger.info(`Worker ${process.pid} started`);
  
  // Отправка статистики мастеру
  setInterval(() => {
    const memUsage = process.memoryUsage();
    process.send({
      type: 'stats',
      data: {
        memory: Math.round(memUsage.heapUsed / 1024 / 1024),
        uptime: process.uptime()
      }
    });
  }, 30000);
  
  // Обработка ошибок воркера
  process.on('uncaughtException', (error) => {
    logger.error(`Worker ${process.pid} uncaught exception: ${error.message}`);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Worker ${process.pid} unhandled rejection: ${reason}`);
    process.exit(1);
  });
  
  // Создание сервера для воркера
  createServer();
} 