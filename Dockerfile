# Многоэтапная сборка для оптимизации размера
FROM node:18-alpine AS builder

WORKDIR /app

# Копирование package файлов
COPY package-optimized.json package.json
COPY package-lock.json* ./

# Установка зависимостей
RUN npm ci --only=production && npm cache clean --force

# Копирование исходного кода
COPY . .

# Создание директории для логов
RUN mkdir -p logs

# Создание пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Изменение владельца файлов
RUN chown -R nodejs:nodejs /app
USER nodejs

# Открытие порта
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Запуск в кластерном режиме
CMD ["node", "cluster.js"] 