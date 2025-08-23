module.exports = {
  apps: [{
    name: 'bilateral-bound-production',
    script: 'server-production.js',
    instances: 2, // Максимум 2 инстанса для onrender.com
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '150M', // Уменьшено для onrender.com
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'warn', // Только предупреждения и ошибки
      ENABLE_LOGGING: 'true',
      ENABLE_METRICS: 'true',
      MAX_SESSIONS: '25', // Уменьшено для onrender.com
      MAX_VIEWERS_PER_SESSION: '3', // Уменьшено
      TICK_RATE: '15', // Очень низкий FPS
      CLEANUP_INTERVAL: '600000', // 10 минут
      SESSION_TIMEOUT: '15', // 15 минут
      INACTIVE_TIMEOUT: '2', // 2 минуты
      NO_VIEWER_TIMEOUT: '1', // 1 минута
      RATE_LIMIT_MAX: '30', // Уменьшено
      API_RATE_LIMIT: '5' // Уменьшено
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
      LOG_LEVEL: 'error', // Только ошибки в продакшене
      ENABLE_LOGGING: 'false', // Отключаем логирование
      ENABLE_METRICS: 'true',
      MAX_SESSIONS: '20', // Еще меньше для продакшена
      MAX_VIEWERS_PER_SESSION: '2', // Минимум зрителей
      TICK_RATE: '10', // Минимальный FPS
      CLEANUP_INTERVAL: '900000', // 15 минут
      SESSION_TIMEOUT: '10', // 10 минут
      INACTIVE_TIMEOUT: '1', // 1 минута
      NO_VIEWER_TIMEOUT: '1', // 1 минута
      RATE_LIMIT_MAX: '20', // Минимум запросов
      API_RATE_LIMIT: '3' // Минимум API запросов
    },
    
    // Автоматический перезапуск при сбоях
    autorestart: true,
    max_restarts: 5, // Уменьшено
    min_uptime: '30s', // Увеличено
    
    // Логирование
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Мониторинг
    monitor: true,
    
    // Переменные окружения для оптимизации
    node_args: [
      '--max-old-space-size=150', // Ограничение памяти
      '--optimize-for-size', // Оптимизация размера
      '--gc-interval=200', // Увеличен интервал сборки мусора
      '--max-semi-space-size=32' // Уменьшен размер полупространства
    ],
    
    // Настройки для слабого сервера
    kill_timeout: 5000, // Быстрое завершение
    listen_timeout: 10000, // Таймаут прослушивания
    shutdown_with_message: true, // Корректное завершение
    
    // Ограничения ресурсов
    instances: 1, // Один инстанс для onrender.com
    exec_mode: 'fork', // Режим fork вместо cluster
    
    // Настройки для onrender.com
    cwd: './',
    script: 'server-production.js',
    
    // Переменные для onrender.com
    env: {
      NODE_ENV: 'production',
      PORT: process.env.PORT || 3000,
      LOG_LEVEL: 'error',
      ENABLE_LOGGING: 'false',
      ENABLE_METRICS: 'true',
      MAX_SESSIONS: '15', // Очень мало для onrender.com
      MAX_VIEWERS_PER_SESSION: '2',
      TICK_RATE: '10',
      CLEANUP_INTERVAL: '1200000', // 20 минут
      SESSION_TIMEOUT: '10',
      INACTIVE_TIMEOUT: '1',
      NO_VIEWER_TIMEOUT: '1',
      RATE_LIMIT_MAX: '15',
      API_RATE_LIMIT: '2'
    }
  }],
  
  deploy: {
    production: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:davidbugayov/bilateralbound.git',
      path: '/var/www/bilateralbound',
      'post-deploy': 'npm install --production && pm2 reload ecosystem-production.config.js --env production'
    }
  }
}; 