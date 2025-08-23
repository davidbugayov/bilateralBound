#!/usr/bin/env node

/**
 * Скрипт для обновления переменных окружения на onrender.com
 * Требует API ключ от onrender.com
 */

const https = require('https');

// Конфигурация
const RENDER_API_KEY = process.env.RENDER_API_KEY;
const SERVICE_ID = process.env.RENDER_SERVICE_ID || 'your-service-id';

if (!RENDER_API_KEY) {
  console.error('❌ Установите RENDER_API_KEY в переменных окружения');
  console.log('Получите API ключ на: https://render.com/docs/api');
  process.exit(1);
}

// Переменные окружения для продакшена
const environmentVariables = [
  { key: 'NODE_ENV', value: 'production' },
  { key: 'LOG_LEVEL', value: 'error' },
  { key: 'ENABLE_LOGGING', value: 'false' },
  { key: 'ENABLE_METRICS', value: 'true' },
  { key: 'MAX_SESSIONS', value: '15' },
  { key: 'MAX_VIEWERS_PER_SESSION', value: '2' },
  { key: 'TICK_RATE', value: '10' },
  { key: 'CLEANUP_INTERVAL', value: '1200000' },
  { key: 'SESSION_TIMEOUT', value: '600000' },
  { key: 'INACTIVE_TIMEOUT', value: '60000' },
  { key: 'NO_VIEWER_TIMEOUT', value: '60000' },
  { key: 'RATE_LIMIT_MAX', value: '15' },
  { key: 'API_RATE_LIMIT', value: '2' }
];

// Функция для HTTP запросов
function makeRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (error) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });
    
    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// Обновление переменных окружения
async function updateEnvironmentVariables() {
  console.log('🚀 Обновление переменных окружения на onrender.com...');
  
  try {
    // Получение текущего сервиса
    const getServiceOptions = {
      hostname: 'api.render.com',
      port: 443,
      path: `/v1/services/${SERVICE_ID}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    console.log('📡 Получение информации о сервисе...');
    const serviceResponse = await makeRequest(getServiceOptions);
    
    if (serviceResponse.status !== 200) {
      console.error('❌ Ошибка получения сервиса:', serviceResponse.data);
      return;
    }
    
    console.log('✅ Сервис найден:', serviceResponse.data.name);
    
    // Обновление переменных окружения
    const updateOptions = {
      hostname: 'api.render.com',
      port: 443,
      path: `/v1/services/${SERVICE_ID}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const updateData = {
      envVars: environmentVariables
    };
    
    console.log('📝 Обновление переменных окружения...');
    const updateResponse = await makeRequest(updateOptions, updateData);
    
    if (updateResponse.status === 200) {
      console.log('✅ Переменные окружения успешно обновлены!');
      console.log('\n📋 Обновленные переменные:');
      environmentVariables.forEach(env => {
        console.log(`   ${env.key}=${env.value}`);
      });
      
      console.log('\n🔄 Сервис будет автоматически перезапущен с новыми настройками');
      console.log('⏱️  Время перезапуска: 2-5 минут');
      
    } else {
      console.error('❌ Ошибка обновления:', updateResponse.data);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Обновление build и start команд
async function updateBuildCommands() {
  console.log('\n🔧 Обновление build и start команд...');
  
  try {
    const updateOptions = {
      hostname: 'api.render.com',
      port: 443,
      path: `/v1/services/${SERVICE_ID}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${RENDER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };
    
    const updateData = {
      buildCommand: 'npm install --production && npm run build:pages',
      startCommand: 'node server-production.js'
    };
    
    const updateResponse = await makeRequest(updateOptions, updateData);
    
    if (updateResponse.status === 200) {
      console.log('✅ Build и start команды обновлены!');
      console.log('   Build: npm install --production && npm run build:pages');
      console.log('   Start: node server-production.js');
    } else {
      console.error('❌ Ошибка обновления команд:', updateResponse.data);
    }
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Главная функция
async function main() {
  console.log('🚀 Render.com Environment Updater');
  console.log('================================\n');
  
  if (SERVICE_ID === 'your-service-id') {
    console.log('⚠️  Установите RENDER_SERVICE_ID или обновите скрипт');
    console.log('   SERVICE_ID можно найти в URL вашего сервиса');
    console.log('   https://dashboard.render.com/web/[SERVICE_ID]');
    return;
  }
  
  await updateEnvironmentVariables();
  await updateBuildCommands();
  
  console.log('\n🎉 Обновление завершено!');
  console.log('📱 Проверьте статус на: https://dashboard.render.com');
}

// Запуск скрипта
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { updateEnvironmentVariables, updateBuildCommands }; 