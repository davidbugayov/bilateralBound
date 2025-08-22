## Bilateral Bound (EMDR)

Интерактивный инструмент двусторонней стимуляции (EMDR) с управлением движущимся объектом (шаром) в реальном времени через веб‑сокеты. Проект состоит из:

- фронтенда на GitHub Pages: [страница создания сессии](https://davidbugayov.github.io/bilateralBound/)  
- бэкенда на Render: `https://bilateralbound.onrender.com`

На странице можно создать сессию (генерируется `sid`), открыть ссылку зрителя и управлять направлением и скоростью движения.

### Быстрые ссылки
- Создать/управлять: [davidbugayov.github.io/bilateralBound](https://davidbugayov.github.io/bilateralBound/)
- Пример короткой ссылки зрителя на бэкенде: `https://bilateralbound.onrender.com/s/<sid>`

---

### Локальный запуск

Требуется Node.js 18+.

```bash
git clone https://github.com/davidbugayov/bilateralBound.git
cd bilateralBound
npm install
npm start
```

Сервер поднимется на `http://localhost:3000` и будет раздавать статику из `public/`.

При локальной разработке `public/config.js` указывает пустой `SERVER_URL`, поэтому фронтенд будет бить на локальный бэкенд.

---

### Деплой на GitHub Pages

Репозиторий настроен на публикацию из папки `docs/`.

1) Соберите файлы для Pages:
```bash
npm run build:pages
```
2) Закоммитьте и запушьте изменения (`docs/*`):
```bash
git add docs/
git commit -m "Build Pages"
git push
```

Страница будет доступна по адресу:  
`https://davidbugayov.github.io/bilateralBound/`

Важно: в `public/config.js` должен быть прописан адрес прод‑бэкенда:

```js
// public/config.js
window.SERVER_URL = 'https://bilateralbound.onrender.com';
```

---

### Как это работает

1. Нажмите «Создать» — фронтенд запросит `sid` у бэкенда (`GET /api/session/new`), сформирует ссылку зрителя и отобразит быстрые элементы управления.
2. Кнопки «↔︎/↕︎/диагональ» устанавливают направление. Ползунок — скорость.
3. «Старт» — подключает вас как контроллера и возобновляет движение (по горизонтали по умолчанию, если направление не выбрано).
4. «Стоп» — ставит на паузу.
5. «Сбросить сессию» — сбрасывает текущую и сразу создаёт новую.

Зритель открывает ссылку вида:
- GitHub Pages: `viewer.html?sid=<sid>&server=https%3A%2F%2Fbilateralbound.onrender.com`
- Короткая на Render: `https://bilateralbound.onrender.com/s/<sid>`

---

### API (бэкенд)

- `GET /api/session/new` — создать сессию, ответ `{ sessionId }`.
- `POST /api/session` — создать сессию, ответ `{ sessionId }`.
- `GET /s/:sessionId` — страница зрителя.
- `GET /c/:sessionId` — страница контроллера.

Сокеты (`socket.io`):
- `join-session` `{ sessionId, role: 'viewer'|'controller' }`
- `control-update` `{ sessionId, input: { dirX, dirY, speedScalar, reset, pause, resume } }`
- Сервер эмитит `ball-state`, `role-update`, `session-expired`, `viewer-joined`, `viewer-left`.

---

### Структура проекта

```
public/
  index.html       # Создание сессии, быстрый контроллер
  viewer.html      # Экран зрителя (канвас с шаром)
  controller.html  # Отдельная страница контроллера (опционально)
  config.js        # SERVER_URL для прод/дев
server.js          # Express + Socket.IO сервер
docs/              # Сборка для GitHub Pages
```

---

### Отладка

- «Черный экран / Unexpected token '<'» — обычно значит, что вместо JS пришла HTML‑страница (часто 404/redirect). Откройте DevTools → Network, найдите проблемный ресурс, проверьте URL и CORS.
- «Не двигается после Старт» — убедитесь, что вы присоединены как `controller` (нажмите «Старт» ещё раз или выберите направление). В коде предусмотрен автодефолт по горизонтали.
- Кэш GitHub Pages/CDN может задерживать обновления 1–2 минуты. Сделайте жёсткое обновление: Cmd+Shift+R / Ctrl+F5.

---

### Лицензия

MIT


