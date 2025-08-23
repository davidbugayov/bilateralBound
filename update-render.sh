#!/bin/bash

# Скрипт для обновления переменных окружения на onrender.com
# Требует curl и jq

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Проверка зависимостей
check_dependencies() {
    if ! command -v curl &> /dev/null; then
        echo -e "${RED}❌ curl не установлен${NC}"
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        echo -e "${RED}❌ jq не установлен${NC}"
        echo "Установите: brew install jq (macOS) или apt-get install jq (Ubuntu)"
        exit 1
    fi
}

# Проверка переменных окружения
check_env_vars() {
    if [ -z "$RENDER_API_KEY" ]; then
        echo -e "${RED}❌ RENDER_API_KEY не установлен${NC}"
        echo "Установите: export RENDER_API_KEY='your-api-key'"
        echo "Получите API ключ на: https://render.com/docs/api"
        exit 1
    fi
    
    if [ -z "$RENDER_SERVICE_ID" ]; then
        echo -e "${RED}❌ RENDER_SERVICE_ID не установлен${NC}"
        echo "Установите: export RENDER_SERVICE_ID='your-service-id'"
        echo "SERVICE_ID можно найти в URL вашего сервиса"
        echo "https://dashboard.render.com/web/[SERVICE_ID]"
        exit 1
    fi
}

# Обновление переменных окружения
update_env_vars() {
    echo -e "${BLUE}🚀 Обновление переменных окружения на onrender.com...${NC}"
    
    # Создание JSON с переменными окружения
    cat > /tmp/env_vars.json << EOF
{
  "envVars": [
    {"key": "NODE_ENV", "value": "production"},
    {"key": "LOG_LEVEL", "value": "error"},
    {"key": "ENABLE_LOGGING", "value": "false"},
    {"key": "ENABLE_METRICS", "value": "true"},
    {"key": "MAX_SESSIONS", "value": "15"},
    {"key": "MAX_VIEWERS_PER_SESSION", "value": "2"},
    {"key": "TICK_RATE", "value": "10"},
    {"key": "CLEANUP_INTERVAL", "value": "1200000"},
    {"key": "SESSION_TIMEOUT", "value": "600000"},
    {"key": "INACTIVE_TIMEOUT", "value": "60000"},
    {"key": "NO_VIEWER_TIMEOUT", "value": "60000"},
    {"key": "RATE_LIMIT_MAX", "value": "15"},
    {"key": "API_RATE_LIMIT", "value": "2"}
  ]
}
EOF
    
    # Отправка запроса на обновление
    response=$(curl -s -w "%{http_code}" \
        -X PATCH \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Content-Type: application/json" \
        -d @/tmp/env_vars.json \
        "https://api.render.com/v1/services/$RENDER_SERVICE_ID")
    
    http_code="${response: -3}"
    response_body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ Переменные окружения успешно обновлены!${NC}"
        echo -e "${BLUE}📋 Обновленные переменные:${NC}"
        jq -r '.envVars[] | "   \(.key)=\(.value)"' /tmp/env_vars.json
        echo -e "\n${YELLOW}🔄 Сервис будет автоматически перезапущен с новыми настройками${NC}"
        echo -e "${YELLOW}⏱️  Время перезапуска: 2-5 минут${NC}"
    else
        echo -e "${RED}❌ Ошибка обновления переменных окружения${NC}"
        echo "HTTP код: $http_code"
        echo "Ответ: $response_body"
        exit 1
    fi
    
    # Очистка временного файла
    rm -f /tmp/env_vars.json
}

# Обновление build и start команд
update_build_commands() {
    echo -e "\n${BLUE}🔧 Обновление build и start команд...${NC}"
    
    # Создание JSON с командами
    cat > /tmp/build_commands.json << EOF
{
  "buildCommand": "npm install --production && npm run build:pages",
  "startCommand": "node server-production.js"
}
EOF
    
    # Отправка запроса на обновление
    response=$(curl -s -w "%{http_code}" \
        -X PATCH \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        -H "Content-Type: application/json" \
        -d @/tmp/build_commands.json \
        "https://api.render.com/v1/services/$RENDER_SERVICE_ID")
    
    http_code="${response: -3}"
    response_body="${response%???}"
    
    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✅ Build и start команды обновлены!${NC}"
        echo -e "${BLUE}   Build: npm install --production && npm run build:pages${NC}"
        echo -e "${BLUE}   Start: node server-production.js${NC}"
    else
        echo -e "${RED}❌ Ошибка обновления команд${NC}"
        echo "HTTP код: $http_code"
        echo "Ответ: $response_body"
        exit 1
    fi
    
    # Очистка временного файла
    rm -f /tmp/build_commands.json
}

# Проверка статуса сервиса
check_service_status() {
    echo -e "\n${BLUE}📊 Проверка статуса сервиса...${NC}"
    
    response=$(curl -s \
        -H "Authorization: Bearer $RENDER_API_KEY" \
        "https://api.render.com/v1/services/$RENDER_SERVICE_ID")
    
    service_name=$(echo "$response" | jq -r '.name // "Unknown"')
    service_status=$(echo "$response" | jq -r '.status // "Unknown"')
    service_url=$(echo "$response" | jq -r '.serviceUrl // "Unknown"')
    
    echo -e "${BLUE}📱 Сервис: ${GREEN}$service_name${NC}"
    echo -e "${BLUE}📊 Статус: ${GREEN}$service_status${NC}"
    echo -e "${BLUE}🌐 URL: ${GREEN}$service_url${NC}"
}

# Главная функция
main() {
    echo -e "${BLUE}🚀 Render.com Environment Updater${NC}"
    echo -e "${BLUE}================================${NC}\n"
    
    # Проверки
    check_dependencies
    check_env_vars
    
    # Обновления
    update_env_vars
    update_build_commands
    check_service_status
    
    echo -e "\n${GREEN}🎉 Обновление завершено!${NC}"
    echo -e "${BLUE}📱 Проверьте статус на: https://dashboard.render.com${NC}"
}

# Запуск скрипта
main "$@" 