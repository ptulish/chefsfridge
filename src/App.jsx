import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'

const LOADING_HINTS = [
  'Отправляем запрос к AI…',
  'Модель подбирает сочетание продуктов…',
  'Собираем ингредиенты и шаги…',
  'Ещё чуть-чуть — иногда ответ занимает до минуты…',
]

/** Значения из `.env` / `.env.local` (префикс VITE_ обязателен). Vite не читает `.env.example`. */
const LLM_ENV = {
  apiKey: String(import.meta.env.VITE_LLM_API_KEY ?? '').trim(),
  baseUrl: String(import.meta.env.VITE_LLM_BASE_URL ?? 'https://api.openai.com/v1')
    .trim()
    .replace(/\/$/, ''),
  model: String(import.meta.env.VITE_LLM_MODEL ?? 'gpt-4o-mini').trim(),
}

const initialRecipe = {
  title: '',
  description: '',
  cookingTime: '',
  difficulty: '',
  cuisine: '',
  ingredients: [],
  steps: [],
  tips: [],
}

function safeParseRecipe(payload) {
  const normalizedPayload = payload
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim()

  const parsed = JSON.parse(normalizedPayload)

  return {
    title: parsed.title ?? 'Chef’s Fridge Recipe',
    description: parsed.description ?? '',
    cookingTime: parsed.cookingTime ?? '',
    difficulty: parsed.difficulty ?? '',
    cuisine: parsed.cuisine ?? '',
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    tips: Array.isArray(parsed.tips) ? parsed.tips : [],
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function formatHttpError(status, bodyText) {
  if (status === 429) {
    let providerHint = ''
    try {
      const parsed = JSON.parse(bodyText)
      const raw = parsed?.error?.metadata?.raw ?? parsed?.error?.message
      if (typeof raw === 'string' && raw.length > 0) {
        providerHint = `\n\nДетали: ${raw}`
      }
    } catch {
      /* не JSON — показываем как есть ниже */
    }

    return [
      'Лимит запросов (429): бесплатная модель или общий пул OpenRouter временно перегружен.',
      'Что сделать: подождать 1–2 минуты и повторить; в .env сменить VITE_LLM_MODEL на другую free-модель из каталога OpenRouter;',
      'либо привязать свой ключ провайдера (BYOK) в настройках OpenRouter — так лимиты считаются отдельно.',
      'https://openrouter.ai/models (фильтр Free) · https://openrouter.ai/settings/integrations',
      providerHint,
    ].join(' ')
  }

  if (status === 401) {
    return 'Неверный API-ключ (401). Проверь VITE_LLM_API_KEY в .env или ключ в блоке «Свой API-ключ».'
  }

  if (status === 402) {
    return 'Недостаточно кредитов у провайдера (402). Пополни баланс OpenRouter или выбери другую модель.'
  }

  return `Ошибка API ${status}: ${bodyText.slice(0, 800)}${bodyText.length > 800 ? '…' : ''}`
}

function formatRecipeText(recipe) {
  const ingredients = recipe.ingredients.map((item) => `- ${item}`).join('\n')
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
  const tips = recipe.tips.map((tip) => `- ${tip}`).join('\n')

  return [
    recipe.title,
    '',
    recipe.description,
    '',
    `Cuisine: ${recipe.cuisine || 'any'}`,
    `Difficulty: ${recipe.difficulty || 'any'}`,
    `Cooking time: ${recipe.cookingTime || 'n/a'}`,
    '',
    'Ingredients:',
    ingredients || '-',
    '',
    'Steps:',
    steps || '1. -',
    '',
    'Tips:',
    tips || '-',
  ].join('\n')
}

function App() {
  const [products, setProducts] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [recipe, setRecipe] = useState(initialRecipe)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingHintIndex, setLoadingHintIndex] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [error, setError] = useState('')
  /** Только ручное переопределение; ключ из .env сюда не подставляем и не показываем. */
  const [apiKeyOverride, setApiKeyOverride] = useState('')
  const [baseUrl, setBaseUrl] = useState(LLM_ENV.baseUrl)
  const [model, setModel] = useState(LLM_ENV.model)
  const [filters, setFilters] = useState({
    cookingTime: '30',
    difficulty: 'easy',
    cuisine: 'any',
  })

  const recipeText = useMemo(() => formatRecipeText(recipe), [recipe])

  const loadingHint = LOADING_HINTS[loadingHintIndex % LOADING_HINTS.length]

  useEffect(() => {
    if (!isLoading) {
      return undefined
    }

    const hintId = setInterval(() => {
      setLoadingHintIndex((i) => (i + 1) % LOADING_HINTS.length)
    }, 2800)

    return () => clearInterval(hintId)
  }, [isLoading])

  useEffect(() => {
    if (!isLoading) {
      return undefined
    }

    const tick = setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)

    return () => clearInterval(tick)
  }, [isLoading])

  const addProduct = (value) => {
    const product = value.trim().toLowerCase()
    if (!product || products.includes(product)) {
      return
    }
    setProducts((prev) => [...prev, product])
  }

  const onTagSubmit = (event) => {
    if (event.key !== 'Enter' && event.key !== ',') {
      return
    }

    event.preventDefault()
    addProduct(tagInput)
    setTagInput('')
  }

  const removeProduct = (product) => {
    setProducts((prev) => prev.filter((item) => item !== product))
  }

  const generateRecipe = async () => {
    if (products.length === 0) {
      setError('Добавь хотя бы один продукт для генерации рецепта.')
      return
    }

    const resolvedKey = (apiKeyOverride.trim() || LLM_ENV.apiKey).trim()
    const resolvedBase = (baseUrl.trim() || LLM_ENV.baseUrl).replace(/\/$/, '')
    const resolvedModel = (model.trim() || LLM_ENV.model).trim()

    if (!resolvedKey) {
      setError(
        'Нет API ключа: добавь VITE_LLM_API_KEY в файл .env в корне проекта (не .env.example) и перезапусти npm run dev.',
      )
      return
    }

    setError('')
    setLoadingHintIndex(0)
    setElapsedSec(0)
    setIsLoading(true)

    const endpoint = `${resolvedBase}/chat/completions`

    const prompt = `
Сгенерируй практичный рецепт в формате JSON.
Параметры:
- Продукты: ${products.join(', ')}
- Ограничение по времени: до ${filters.cookingTime} минут
- Сложность: ${filters.difficulty}
- Кухня: ${filters.cuisine}

Верни ТОЛЬКО JSON с полями:
{
  "title": "string",
  "description": "string",
  "cookingTime": "string",
  "difficulty": "string",
  "cuisine": "string",
  "ingredients": ["string"],
  "steps": ["string"],
  "tips": ["string"]
}
`

    const maxAttempts = 3

    try {
      let result

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedKey}`,
          },
          body: JSON.stringify({
            model: resolvedModel,
            temperature: 0.8,
            messages: [
              {
                role: 'system',
                content: 'Ты шеф-повар и даешь четкие, реалистичные рецепты.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        })

        const details = await response.text()

        if (response.ok) {
          result = JSON.parse(details)
          break
        }

        if (response.status === 429 && attempt < maxAttempts) {
          await sleep(2000 * attempt)
          continue
        }

        throw new Error(formatHttpError(response.status, details))
      }

      const content = result?.choices?.[0]?.message?.content

      if (!content) {
        throw new Error('Пустой ответ от модели.')
      }

      setRecipe(safeParseRecipe(content))
    } catch (requestError) {
      const message =
        requestError instanceof SyntaxError
          ? 'Некорректный JSON в ответе API. Попробуй другую модель или повтори запрос.'
          : requestError.message
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const downloadPdf = () => {
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 14
    let y = margin

    doc.setFontSize(18)
    doc.text(recipe.title || 'Chef’s Fridge Recipe', margin, y)
    y += 10

    doc.setFontSize(11)
    const lines = doc.splitTextToSize(recipeText, pageWidth - margin * 2)

    lines.forEach((line) => {
      if (y > pageHeight - margin) {
        doc.addPage()
        y = margin
      }
      doc.text(line, margin, y)
      y += 6
    })

    doc.save(`${(recipe.title || 'chefs-fridge-recipe').replace(/\s+/g, '-').toLowerCase()}.pdf`)
  }

  const shareToTelegram = () => {
    const textForTelegram = recipeText.slice(0, 3500)
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(textForTelegram)}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <main className="min-h-screen px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-screen-2xl rounded-3xl border border-orange-100 bg-white/95 p-6 shadow-xl md:p-10">
        <header className="mb-8">
          <h1 className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">
            Chef&apos;s Fridge
          </h1>
          <p className="mt-3 max-w-5xl text-slate-600">
            Введи продукты, задай фильтры и получи рецепт от AI. Готовый рецепт можно
            скачать в PDF или отправить в Telegram.
          </p>
        </header>

        <section
          className="grid gap-8 md:grid-cols-2"
          aria-busy={isLoading}
        >
          <div
            className={`space-y-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 ${isLoading ? 'pointer-events-none opacity-70' : ''}`}
          >
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Продукты (теги)
              </label>
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={onTagSubmit}
                disabled={isLoading}
                placeholder="Например: курица, томаты, рис"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
              <p className="mt-2 text-xs text-slate-500">
                Нажми Enter или запятую, чтобы добавить тег.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {products.map((product) => (
                  <button
                    key={product}
                    type="button"
                    onClick={() => removeProduct(product)}
                    disabled={isLoading}
                    className="rounded-full bg-orange-100 px-3 py-1 text-sm text-orange-800 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {product} x
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <label className="text-sm font-semibold text-slate-700">
                Время приготовления
                <select
                  value={filters.cookingTime}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, cookingTime: event.target.value }))
                  }
                  disabled={isLoading}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <option value="15">до 15 минут</option>
                  <option value="30">до 30 минут</option>
                  <option value="45">до 45 минут</option>
                  <option value="60">до 60 минут</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Уровень сложности
                <select
                  value={filters.difficulty}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, difficulty: event.target.value }))
                  }
                  disabled={isLoading}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <option value="easy">легкий</option>
                  <option value="medium">средний</option>
                  <option value="hard">сложный</option>
                </select>
              </label>

              <label className="text-sm font-semibold text-slate-700">
                Тип кухни
                <select
                  value={filters.cuisine}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, cuisine: event.target.value }))
                  }
                  disabled={isLoading}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <option value="any">любая</option>
                  <option value="italian">итальянская</option>
                  <option value="asian">азиатская</option>
                  <option value="georgian">грузинская</option>
                  <option value="mexican">мексиканская</option>
                  <option value="mediterranean">средиземноморская</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              onClick={generateRecipe}
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isLoading && (
                <span
                  className="size-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
              )}
              {isLoading ? 'Генерируем рецепт…' : 'Сгенерировать рецепт'}
            </button>

            {isLoading && (
              <p
                className="text-center text-xs text-slate-500"
                role="status"
                aria-live="polite"
              >
                {loadingHint} Прошло {elapsedSec} с — страница не зависла, ждём ответ сервера.
              </p>
            )}
          </div>

          <div className="relative min-h-[28rem] rounded-2xl border border-slate-200 bg-white p-5">
            {isLoading && (
              <div
                className="absolute inset-0 z-10 flex flex-col rounded-2xl border border-orange-100 bg-white/90 p-5 shadow-inner backdrop-blur-[2px] md:p-6"
                role="status"
                aria-live="polite"
                aria-label="Генерация рецепта"
              >
                <div className="flex items-start gap-4">
                  <span
                    className="mt-0.5 size-10 shrink-0 animate-spin rounded-full border-[3px] border-orange-200 border-t-orange-500"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">Готовим рецепт</p>
                    <p className="mt-1 text-sm text-slate-600">{loadingHint}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Прошло {elapsedSec} с. У бесплатных моделей и при высокой нагрузке ответ
                      иногда занимает до 1–2 минут — можно подождать с этой вкладкой открытой.
                    </p>
                  </div>
                </div>
                <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="chefs-indeterminate-bar h-full w-2/5 rounded-full bg-gradient-to-r from-orange-400 to-amber-400" />
                </div>
                <div className="mt-6 space-y-3">
                  <div className="h-6 w-3/4 max-w-md animate-pulse rounded-lg bg-slate-200" />
                  <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-slate-100" />
                  <div className="mt-4 grid gap-2 md:grid-cols-3">
                    <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
                    <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
                    <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
                  </div>
                  <div className="mt-4 space-y-2">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                    <div className="h-3 w-4/5 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              </div>
            )}

            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-slate-900">Рецепт</h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Скачать PDF
                </button>
                <button
                  type="button"
                  onClick={shareToTelegram}
                  disabled={isLoading}
                  className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Telegram
                </button>
              </div>
            </div>

            {error && (
              <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <h3 className="text-xl font-bold text-slate-900">
              {recipe.title || 'Здесь появится название рецепта'}
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              {recipe.description ||
                'После генерации здесь будет описание и пошаговый план приготовления.'}
            </p>

            <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
              <p>
                <span className="font-semibold">Время:</span>{' '}
                {recipe.cookingTime || `${filters.cookingTime} мин`}
              </p>
              <p>
                <span className="font-semibold">Сложность:</span>{' '}
                {recipe.difficulty || filters.difficulty}
              </p>
              <p>
                <span className="font-semibold">Кухня:</span> {recipe.cuisine || filters.cuisine}
              </p>
            </div>

            <div className="mt-6">
              <h4 className="font-semibold text-slate-900">Ингредиенты</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {(recipe.ingredients.length > 0 ? recipe.ingredients : ['Список появится после генерации']).map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>
            </div>

            <div className="mt-6">
              <h4 className="font-semibold text-slate-900">Шаги</h4>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
                {(recipe.steps.length > 0 ? recipe.steps : ['Шаги приготовления появятся здесь.']).map(
                  (step) => (
                    <li key={step}>{step}</li>
                  ),
                )}
              </ol>
            </div>

            <div className="mt-6">
              <h4 className="font-semibold text-slate-900">Советы шефа</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {(recipe.tips.length > 0 ? recipe.tips : ['Советы появятся после генерации.']).map(
                  (tip) => (
                    <li key={tip}>{tip}</li>
                  ),
                )}
              </ul>
            </div>
          </div>
        </section>

        <footer className="mt-10 border-t border-slate-100 pt-6">
          <details className="group rounded-xl transition-colors open:bg-slate-50/70">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1 text-xs text-slate-500 marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="text-slate-400 transition group-open:rotate-90" aria-hidden>
                ▸
              </span>
              <span className="font-medium text-slate-600 group-hover:text-slate-800">
                Свой API-ключ и модель
              </span>
              <span className="hidden sm:inline text-slate-400">·</span>
              <span className="hidden text-slate-400 sm:inline">
                обычно не нужно — берётся из настроек проекта (.env)
              </span>
              {LLM_ENV.apiKey ? (
                <span className="ml-auto shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                  .env ок
                </span>
              ) : (
                <span className="ml-auto shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                  проверь .env
                </span>
              )}
            </summary>
            <div className="mt-3 space-y-3 border-t border-slate-100/80 pt-4 pb-1">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Для локальной разработки ключ задаётся в файле{' '}
                <code className="rounded bg-slate-100 px-1 py-px text-slate-700">.env</code> (см.{' '}
                <code className="rounded bg-slate-100 px-1 py-px text-slate-700">.env.example</code>
                ). После правок перезапусти{' '}
                <code className="rounded bg-slate-100 px-1 py-px text-slate-700">npm run dev</code>.
                Ниже — только если нужно временно переопределить без правки файла. Значение из{' '}
                <code className="rounded bg-slate-100 px-1 py-px text-slate-700">.env</code> в поле
                не подставляется и на экране не показывается.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  value={apiKeyOverride}
                  onChange={(event) => setApiKeyOverride(event.target.value)}
                  type="password"
                  name="llm-api-key-override"
                  autoComplete="off"
                  placeholder={
                    LLM_ENV.apiKey ? 'Другой ключ (пусто = только .env)' : 'API key'
                  }
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-100 sm:col-span-1"
                />
                <input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="Base URL"
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs disabled:cursor-not-allowed disabled:bg-slate-100"
                />
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="Model id"
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                OpenAI, OpenRouter и другие совместимые эндпоинты.
              </p>
            </div>
          </details>
        </footer>
      </div>
    </main>
  )
}

export default App
