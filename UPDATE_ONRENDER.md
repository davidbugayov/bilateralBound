# 🔧 Обновление переменных окружения на существующем onrender.com сервисе

## ⚠️ Важно!

**render.yaml применяется только при создании нового сервиса!** Для существующего сервиса нужно обновлять переменные окружения вручную.

## 🚀 Способы обновления

### 1. **Через веб-интерфейс onrender.com (Рекомендуется)**

1. **Войдите в onrender.com** и перейдите к вашему сервису
2. **Нажмите на сервис** `bilateral-bound-production`
3. **Перейдите в раздел "Environment"** (Переменные окружения)
4. **Добавьте/обновите переменные**:

```bash
# Основные настройки
NODE_ENV=production
LOG_LEVEL=error
ENABLE_LOGGING=false
ENABLE_METRICS=true

# Ограничения ресурсов
MAX_SESSIONS=15
MAX_VIEWERS_PER_SESSION=2
TICK_RATE=10

# Таймауты
CLEANUP_INTERVAL=1200000
SESSION_TIMEOUT=600000
INACTIVE_TIMEOUT=60000
NO_VIEWER_TIMEOUT=60000

# Rate limiting
RATE_LIMIT_MAX=15
API_RATE_LIMIT=2
```

5. **Обновите Build & Start команды**:

**Build Command:**
```bash
npm install --production && npm run build:pages
```

**Start Command:**
```bash
node server-production.js
```

6. **Сохраните изменения** - сервис автоматически перезапустится

### 2. **Через API (Автоматически)**

#### Установка зависимостей:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# CentOS/RHEL
sudo yum install jq
```

#### Настройка переменных окружения:
```bash
# Получите API ключ на: https://render.com/docs/api
export RENDER_API_KEY='your-api-key-here'

# Получите SERVICE_ID из URL вашего сервиса
# https://dashboard.render.com/web/[SERVICE_ID]
export RENDER_SERVICE_ID='your-service-id-here'
```

#### Запуск обновления:
```bash
# Сделайте скрипт исполняемым
chmod +x update-render.sh

# Запустите обновление
./update-render.sh
```

### 3. **Через Node.js скрипт**

```bash
# Установите переменные окружения
export RENDER_API_KEY='your-api-key-here'
export RENDER_SERVICE_ID='your-service-id-here'

# Запустите скрипт
node update-render-env.js
```

## 📋 Полный список переменных окружения

### Основные настройки
```bash
NODE_ENV=production
LOG_LEVEL=error
ENABLE_LOGGING=false
ENABLE_METRICS=true
```

### Ограничения ресурсов
```bash
MAX_SESSIONS=15
MAX_VIEWERS_PER_SESSION=2
TICK_RATE=10
```

### Таймауты (в миллисекундах)
```bash
CLEANUP_INTERVAL=1200000      # 20 минут
SESSION_TIMEOUT=600000         # 10 минут
INACTIVE_TIMEOUT=60000         # 1 минута
NO_VIEWER_TIMEOUT=60000       # 1 минута
```

### Rate limiting
```bash
RATE_LIMIT_MAX=15             # 15 запросов в минуту
API_RATE_LIMIT=2              # 2 API запроса в минуту
```

## 🔍 Поиск SERVICE_ID

### Способ 1: Из URL
1. Перейдите к вашему сервису на onrender.com
2. URL будет выглядеть как: `https://dashboard.render.com/web/[SERVICE_ID]`
3. Скопируйте `[SERVICE_ID]` часть

### Способ 2: Из списка сервисов
1. На главной странице onrender.com найдите ваш сервис
2. Нажмите на него
3. В URL будет SERVICE_ID

### Способ 3: Через API
```bash
# Получите список всех сервисов
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services" | jq '.[] | {id, name, type}'
```

## 🚨 Возможные проблемы

### 1. **API ключ не работает**
- Проверьте, что ключ активен
- Убедитесь, что у ключа есть права на чтение/запись
- Создайте новый ключ при необходимости

### 2. **SERVICE_ID не найден**
- Проверьте правильность ID
- Убедитесь, что сервис существует
- Проверьте права доступа к сервису

### 3. **Ошибка 403/401**
- Проверьте API ключ
- Убедитесь, что у ключа есть права на сервис
- Проверьте, что сервис не заблокирован

### 4. **Сервис не перезапускается**
- Подождите 5-10 минут
- Проверьте логи сервиса
- Попробуйте принудительный перезапуск

## 🔄 Принудительный перезапуск

### Через веб-интерфейс:
1. Перейдите к сервису
2. Нажмите "Manual Deploy"
3. Выберите "Clear build cache & deploy"

### Через API:
```bash
curl -X POST \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys"
```

## 📊 Проверка обновления

### 1. **Проверка переменных окружения**
```bash
# Через API
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID" | jq '.envVars'
```

### 2. **Проверка статуса сервиса**
```bash
# Health check
curl https://your-app.onrender.com/health

# Метрики
curl https://your-app.onrender.com/metrics
```

### 3. **Проверка логов**
- В веб-интерфейсе onrender.com перейдите к сервису
- Нажмите "Logs" для просмотра логов
- Убедитесь, что `ENABLE_LOGGING=false` работает

## 🎯 Рекомендации

### 1. **Порядок обновления**
1. Сначала обновите переменные окружения
2. Затем обновите build/start команды
3. Дождитесь автоматического перезапуска
4. Проверьте работоспособность

### 2. **Тестирование**
- Проверьте health endpoint
- Убедитесь, что логирование отключено
- Проверьте ограничения сессий
- Тестируйте rate limiting

### 3. **Мониторинг**
- Следите за использованием ресурсов
- Проверяйте логи ошибок
- Мониторьте производительность
- Отслеживайте количество активных сессий

## 🎉 После обновления

### Что должно произойти:
✅ **Сервис автоматически перезапустится**  
✅ **Логирование будет отключено** (ENABLE_LOGGING=false)  
✅ **Ограничения ресурсов применятся** (15 сессий, 2 зрителя)  
✅ **FPS снизится до 10** для экономии CPU  
✅ **Rate limiting активируется** (15 запросов/мин)  

### Время обновления:
- **Переменные окружения**: Мгновенно
- **Build/Start команды**: При следующем деплое
- **Автоматический перезапуск**: 2-5 минут
- **Полное применение**: 5-10 минут

## 📞 Поддержка

### Если что-то пошло не так:
1. **Проверьте логи** сервиса на onrender.com
2. **Убедитесь в правильности** переменных окружения
3. **Попробуйте принудительный перезапуск**
4. **Обратитесь в поддержку** onrender.com при необходимости

### Полезные ссылки:
- [Render API Documentation](https://render.com/docs/api)
- [Render Dashboard](https://dashboard.render.com)
- [Bilateral Bound Repository](https://github.com/davidbugayov/bilateralbound) 