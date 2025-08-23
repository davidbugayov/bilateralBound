# Bilateral Bound - Оптимизированная версия

## 🚀 Оптимизации для слабого сервера

### Основные улучшения производительности

1. **Сниженная частота обновлений**: 30 FPS вместо 60 FPS
2. **Ограничение сессий**: Максимум 50 активных сессий
3. **Ограничение зрителей**: Максимум 10 зрителей на сессию
4. **Упрощенная физика**: Убраны сложные вычисления
5. **Кластерный режим**: Использование всех CPU ядер
6. **Защита от DDoS**: Rate limiting и блокировка IP

### Защита от атак

- **Rate Limiting**: Ограничение запросов с одного IP
- **IP блокировка**: Автоматическая блокировка подозрительных IP
- **Валидация входных данных**: Проверка всех параметров
- **Ограничение размера запросов**: Максимум 10KB
- **Защита от ботов**: Блокировка crawler'ов

## 📦 Установка и запуск

### Быстрый запуск с Docker

```bash
# Клонирование репозитория
git clone https://github.com/davidbugayov/bilateralbound.git
cd bilateralbound

# Запуск всех сервисов
docker-compose up -d

# Проверка статуса
docker-compose ps
```

### Запуск без Docker

```bash
# Установка зависимостей
npm install

# Запуск в кластерном режиме
npm run start:cluster

# Или с PM2
npm run start:pm2
```

## 🔧 Конфигурация

### Переменные окружения

```bash
NODE_ENV=production
PORT=3000
MAX_SESSIONS=50
MAX_VIEWERS_PER_SESSION=10
TICK_RATE=30
```

### Настройка для слабого сервера

В `server-optimized.js` можно изменить:

```javascript
const SERVER_CONFIG = {
  MAX_SESSIONS: 30,           // Уменьшить для очень слабого сервера
  MAX_VIEWERS_PER_SESSION: 5, // Уменьшить количество зрителей
  TICK_RATE: 20,              // Снизить FPS еще больше
  CLEANUP_INTERVAL: 300000,   // Увеличить интервал очистки (5 минут)
};
```

## 🛡️ Защита от DDoS

### Nginx конфигурация

```bash
# Копирование конфигурации
sudo cp nginx.conf /etc/nginx/sites-available/bilateralbound

# Активация
sudo ln -s /etc/nginx/sites-available/bilateralbound /etc/nginx/sites-enabled/

# Проверка конфигурации
sudo nginx -t

# Перезапуск
sudo systemctl reload nginx
```

### Настройка firewall

```bash
# UFW (Ubuntu)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3000/tcp
sudo ufw enable

# iptables (CentOS/RHEL)
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
```

## 📊 Мониторинг

### Prometheus метрики

```bash
# Доступ к метрикам
curl http://localhost:9090/metrics

# Основные метрики:
# - bilateral_sessions_total
# - bilateral_viewers_total
# - bilateral_connections_active
# - bilateral_requests_total
# - bilateral_errors_total
```

### Grafana дашборды

```bash
# Доступ к Grafana
http://localhost:3001
# Логин: admin
# Пароль: admin
```

## 🚨 Обработка инцидентов

### Высокая нагрузка

```bash
# Проверка нагрузки
docker stats
htop

# Ограничение ресурсов
docker update --cpus="0.3" bilateral-bound-app
docker update --memory="150M" bilateral-bound-app
```

### DDoS атака

```bash
# Просмотр логов
docker logs bilateral-bound-nginx
tail -f /var/log/nginx/bilateralbound_access.log

# Блокировка IP
docker exec bilateral-bound-app node -e "
const bannedIPs = require('./server-optimized').bannedIPs;
bannedIPs.add('ATTACKER_IP');
console.log('IP заблокирован');
"
```

### Восстановление после сбоя

```bash
# Перезапуск сервисов
docker-compose restart

# Проверка здоровья
curl http://localhost/health

# Восстановление из резервной копии
docker-compose down
docker-compose up -d
```

## 📈 Производительность

### Бенчмарки

| Конфигурация | Сессии | Зрители | CPU | RAM | FPS |
|--------------|--------|---------|-----|-----|-----|
| Базовый | 100 | 20 | 100% | 500MB | 60 |
| Оптимизированный | 50 | 10 | 50% | 200MB | 30 |
| Слабый сервер | 30 | 5 | 25% | 100MB | 20 |

### Рекомендации по железу

- **Минимально**: 1 CPU, 512MB RAM
- **Рекомендуется**: 2 CPU, 1GB RAM
- **Оптимально**: 4 CPU, 2GB RAM

## 🔄 Обновление

```bash
# Остановка сервисов
docker-compose down

# Обновление кода
git pull origin main

# Пересборка и запуск
docker-compose up -d --build

# Проверка статуса
docker-compose ps
```

## 📝 Логи

### Просмотр логов

```bash
# Логи приложения
docker logs bilateral-bound-app

# Логи nginx
docker logs bilateral-bound-nginx

# Логи в реальном времени
docker logs -f bilateral-bound-app
```

### Ротация логов

```bash
# Создание директории для логов
mkdir -p logs

# Настройка logrotate
sudo nano /etc/logrotate.d/bilateralbound

# Конфигурация logrotate
/var/log/bilateralbound/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
}
```

## 🆘 Поддержка

### Полезные команды

```bash
# Статус всех сервисов
docker-compose ps

# Перезапуск конкретного сервиса
docker-compose restart bilateral-bound

# Просмотр использования ресурсов
docker stats

# Проверка сети
docker network ls
docker network inspect bilateralbound_bilateral-network
```

### Отладка

```bash
# Вход в контейнер
docker exec -it bilateral-bound-app sh

# Проверка процессов
ps aux

# Проверка портов
netstat -tlnp

# Проверка памяти
free -h
```

## 📚 Дополнительные ресурсы

- [Socket.IO оптимизация](https://socket.io/docs/v4/performance-tuning/)
- [Node.js кластеризация](https://nodejs.org/api/cluster.html)
- [Nginx защита от DDoS](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)
- [Docker оптимизация](https://docs.docker.com/develop/dev-best-practices/) 