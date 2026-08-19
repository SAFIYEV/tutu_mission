# Развёртывание на Render

Приложение содержит серверный `/api/mission`, поэтому разворачивается как **Next.js Node Web Service**. GitHub Pages поддерживает только статическую публикацию и для этого проекта не подходит.

Важно: исходный код route handler может находиться в публичном репозитории — безопасность обеспечивается тем, что ключи существуют только в server-side environment Render. `.env*`, AWS credentials, сертификаты и key-файлы исключены через `.gitignore`; в Git хранится только пустой `.env.example`.

## Blueprint

Корневой `render.yaml` задаёт Node.js 22 runtime, Frankfurt region, production build, `npm run start`, health check `/api/health` и автодеплой после успешного GitHub quality gate.

## Первый деплой

1. Открыть Render Dashboard → **New → Blueprint**.
2. Подключить `SAFIYEV/tutu_mission`.
3. Выбрать `main` и корневой `render.yaml`.
4. Указать секрет `AWS_BEARER_TOKEN_BEDROCK`.
5. Нажать **Deploy Blueprint**.

Вместо API key можно использовать стандартные AWS credentials как секретные переменные Render, но для MVP предпочтительнее отдельный Bedrock API key с минимальными правами.

## Обязательные переменные

| Переменная | Значение |
|---|---|
| `TUTU_MCP_URL` | `https://mcp.tutu.ru/mcp` |
| `AWS_REGION` | регион доступа к Bedrock |
| `AWS_BEDROCK_MODEL_ID` | `global.anthropic.claude-sonnet-4-6` |
| `AWS_BEARER_TOKEN_BEDROCK` | secret, задаётся только в Render |

Остальные настройки MCP имеют безопасные defaults и перечислены в `.env.example`.

## Проверка после деплоя

1. Открыть публичный `onrender.com` URL.
2. Выполнить основной demo-запрос.
3. Проверить актуальные предложения и ссылки Туту.
4. Запустить smoke-тест API против production URL.

На бесплатном тарифе Render сервис может засыпать после периода бездействия, поэтому перед презентацией его нужно прогреть одним запросом либо использовать постоянно работающий instance.
