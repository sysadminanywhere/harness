# Выбор модели для задач и групп

Статус: completed. Добавлены настройки модели проекта, группы и карточки с наследованием задача → ближайшая группа → проект → Codex. Выбранная модель передаётся через --model и сохраняется в истории. Очередь и Resume сохраняют модель попытки; Retry учитывает текущие настройки. Каталог допускает ручной ввод ID и не раскрывает данные аккаунта.

Проверки: npm test PASS (20 unit/bridge/model tests, HARNESS_SMOKE_OK, HARNESS_RUNTIME_OK, HARNESS_MODELS_OK, HARNESS_CONTROLS_OK); Playwright HARNESS_BROWSER_MODELS_OK, JS errors 0; MODEL_PACKAGE_CONFIG_OK; node --check board.js; git diff --check. Установщики не собирались. Реальное исполнение с новой явно выбранной моделью отдельно не запускалось: передача --model проверена bridge-тестами.

Изменены: model-settings.js, server.js, codex-bridge.js, board.js, style.css, sw.js, package.json, scripts/package-pwa.ps1, scripts/model-settings.test.cjs, scripts/codex-bridge.test.cjs, scripts/controls-test.mjs, scripts/browser-models-probe.js, README.md и протокол .harness.

Основной сервер обновлён и оставлен на 4173. Тестовый preview и браузер закрыты. Настройки модели существующего HCM-проекта не менялись.
