module.exports = {
  apps: [{
    name: 'bilateral-bound-optimized',
    script: 'server-optimized.js',
    instances: 'max', // Использовать все доступные CPU ядра
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '200M', // Перезапуск при превышении 200MB памяти
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    // Автоматический перезапуск при сбоях
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    
    // Логирование
    log_file: './logs/combined.log',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Мониторинг
    monitor: true,
    
    // Переменные окружения для оптимизации
    node_args: [
      '--max-old-space-size=200', // Ограничение памяти
      '--optimize-for-size', // Оптимизация размера
      '--gc-interval=100' // Интервал сборки мусора
    ]
  }],
  
  deploy: {
    production: {
      user: 'node',
      host: 'localhost',
      ref: 'origin/main',
      repo: 'git@github.com:davidbugayov/bilateralbound.git',
      path: '/var/www/bilateralbound',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production'
    }
  }
}; 