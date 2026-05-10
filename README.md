# Chef's Fridge

Веб-приложение **«Chef's Fridge»**: собираешь продукты тегами, задаёшь фильтры (время, сложность, кухня), получаешь **рецепт от языковой модели** в удобном виде. Можно **скачать PDF** или **поделиться в Telegram**.

Стек: **React 19**, **Vite 8**, **Tailwind CSS 4**.

![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## Возможности

| Функция | Описание |
|--------|----------|
| Продукты | Ввод тегами (Enter или запятая), удаление по клику |
| Фильтры | Время приготовления, сложность, тип кухни |
| AI | Запрос к OpenAI-compatible API (`POST /v1/chat/completions`) |
| Экспорт | Скачивание рецепта в **PDF** (jsPDF) |
| Соцсети | **Telegram** — шеринг текста рецепта (`t.me/share`) |
| Ошибки | Понятные сообщения по-русски, повтор запроса при **429** (лимиты) |
| Настройки API | Ключ и модель из `.env`; ручной оверрайд — в свёрнутом блоке внизу страницы |

---

## Скриншот

_После деплоя можно добавить сюда изображение: `docs/screenshot.png`._

---

## Требования

- **Node.js** 20+ (рекомендуется LTS; для ESLint 10 в шаблоне указаны совместимые минорные версии)
- **npm** 10+

---

## Быстрый старт

```bash
git clone https://github.com/YOUR_USERNAME/chefsfridge.git
cd chefsfridge
npm install
cp .env.example .env
```

Отредактируй `.env` (см. ниже), затем:

```bash
npm run dev
```

Открой в браузере адрес из консоли (обычно `http://localhost:5173`).

### Сборка и превью продакшена

```bash
npm run build
npm run preview
```

### Линт

```bash
npm run lint
```

---

## Переменные окружения

Файл **`.env`** должен лежать в **корне репозитория** рядом с `package.json`. Файл **`.env.example`** Vite **не подхватывает** — это только шаблон для копирования.

Префикс **`VITE_`** обязателен: иначе переменные не попадут в клиентский бандл.

| Переменная | Назначение | Пример |
|------------|------------|--------|
| `VITE_LLM_API_KEY` | Секрет API (OpenAI, OpenRouter и т.д.) | `sk-...` |
| `VITE_LLM_BASE_URL` | База без завершающего `/` | `https://openrouter.ai/api/v1` |
| `VITE_LLM_MODEL` | ID модели у провайдера | см. каталог моделей провайдера |

Пример для **OpenAI**:

```env
VITE_LLM_API_KEY=sk-...
VITE_LLM_BASE_URL=https://api.openai.com/v1
VITE_LLM_MODEL=gpt-4o-mini
```

Пример для **OpenRouter**:

```env
VITE_LLM_API_KEY=sk-or-v1-...
VITE_LLM_BASE_URL=https://openrouter.ai/api/v1
VITE_LLM_MODEL=google/gemini-2.0-flash-001
```

После любого изменения `.env` перезапусти **`npm run dev`**.

### Безопасность ключей

- Значение ключа из `.env` **не подставляется в поля формы** и не отображается в интерфейсе.
- Любая переменная `VITE_*` всё равно **попадает в собранный фронтенд** (её можно найти в JS-бандле). Для **публичного продакшена** правильный вариант — **прокси на своём бэкенде**, где ключ хранится только на сервере.

---

## Провайдеры и типичные проблемы

### OpenRouter, ошибка 429

Бесплатные модели часто идут через общий пул провайдеров; возможен ответ **429** («rate limited upstream»). В приложении есть **несколько автоматических повторов** с паузой.

Что сделать вручную:

- подождать 1–2 минуты и сгенерировать снова;
- сменить `VITE_LLM_MODEL` на другую **free** модель в [каталоге OpenRouter](https://openrouter.ai/models);
- при необходимости настроить [BYOK / интеграции](https://openrouter.ai/settings/integrations) или баланс аккаунта.

### Неверный ключ (401)

Проверь `VITE_LLM_API_KEY` и что сервер перезапущен после правок `.env`.

---

## Структура проекта (кратко)

```
chefsfridge/
├── public/
│   └── favicon.svg      # иконка сайта
├── src/
│   ├── App.jsx          # UI и логика генерации
│   ├── main.jsx
│   └── index.css        # Tailwind
├── index.html
├── vite.config.js
├── package.json
├── .env.example
└── README.md
```

---

## Лицензия

MIT — используй свободно, с указанием авторства по желанию.

---

## English summary

**Chef's Fridge** is a React + Vite + Tailwind app: tag your ingredients, set filters, get an AI-generated recipe, export to PDF or share via Telegram. Configure `VITE_LLM_*` in `.env` for any OpenAI-compatible API (OpenAI, OpenRouter, etc.). See **Environment variables** and **Security** above: never expose production secrets in client-only `VITE_` vars without a backend proxy.
