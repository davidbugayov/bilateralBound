const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const { createServer } = require('./server-optimized');

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  
  // Создание воркеров
  const workers = Math.min(numCPUs, 4); // Максимум 4 воркера для слабого сервера
  console.log(`Starting ${workers} workers...`);
  
  for (let i = 0; i < workers; i++) {
    cluster.fork();
  }
  
  // Мониторинг воркеров
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
  
  // Мониторинг производительности
  let totalConnections = 0;
  setInterval(() => {
    const activeWorkers = Object.keys(cluster.workers).length;
    console.log(`Active workers: ${activeWorkers}, Total connections: ${totalConnections}`);
  }, 30000);
  
  // Обработка сигналов
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down cluster...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down cluster...');
    for (const id in cluster.workers) {
      cluster.workers[id].kill();
    }
    process.exit(0);
  });
  
} else {
  // Воркер процесс
  console.log(`Worker ${process.pid} started`);
  
  // Обработка ошибок воркера
  process.on('uncaughtException', (error) => {
    console.error(`Worker ${process.pid} uncaught exception:`, error);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error(`Worker ${process.pid} unhandled rejection:`, reason);
    process.exit(1);
  });
  
  // Создание сервера для воркера
  createServer();
} 