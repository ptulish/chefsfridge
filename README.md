# Chef's Fridge

Одностраничное приложение на React + Vite + Tailwind CSS для генерации рецептов по продуктам из холодильника.

## Что уже реализовано

- Поле ввода продуктов в виде тегов (Enter или запятая).
- Генерация рецепта через OpenAI-compatible API (`/chat/completions`).
- Фильтры: время приготовления, сложность, тип кухни.
- Экспорт сгенерированного рецепта в PDF (`jsPDF`).
- Шеринг рецепта в Telegram.
- Поддержка OpenAI и бесплатных совместимых провайдеров (например OpenRouter с free-моделью).

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run dev
```

## Переменные окружения

Файл `.env`:

```bash
VITE_LLM_API_KEY=your_api_key_here
VITE_LLM_BASE_URL=https://api.openai.com/v1
VITE_LLM_MODEL=gpt-4o-mini
```

## Провайдеры API

- OpenAI: оставь `VITE_LLM_BASE_URL=https://api.openai.com/v1`.
- OpenRouter (free модели): укажи `https://openrouter.ai/api/v1` и модель из каталога free.
- Любой другой OpenAI-compatible endpoint также поддерживается.
