# Работа Harness по целевому сценарию

Статус: completed. Отчёт: docs/WORKFLOW_CORRECTIONS.md.

Убран старый симулятор из основных действий: монитор исполнения, боковая история и новый план используют реальные API/данные. Исправлены авторун/очередь/приоритет/dry-run, terminal/legacy file bridge, актуальность отчёта, данные reconnect, изоляция A/B и loading-состояния, импорт/CSV, Origin/Host, idle-worker без Git/history, недоступные папки и повреждённый реестр. Планировщик сохраняет цель и ограничения.

Проверки PASS: npm test — 22 unit/model/bridge tests, smoke/runtime/controls/models, 21 audit case; браузерные controls/models/audit/workflows/execution, последние probes JS errors 0; Windows installer/portable/unpacked/PWA; HARNESS_PACKAGED_RUNTIME_OK из итогового каталога установщиков; git diff --check. Desktop/mobile screenshots просмотрены. git diff --cached --check проверяется при добавлении файлов.

Изменены: app.js, board.js, server.js, project.js, planner.js, i18n.js, index.html, style.css, sw.js, scripts/audit-test.mjs, scripts/browser-workflows-probe.js, scripts/browser-execution-probe.js, README.md, docs/WORKFLOW_CORRECTIONS.md, docs/RELIABILITY_PLAN.md, docs/INTEGRATIONS.md и протокол .harness.

Основной сервер обновлён на 4173. HCM ready/runId null/queue 0, реализация HCM не запускалась. Чистая установка и Linux/macOS не проверялись. Для ранее установленного desktop-приложения собраны новые installer/portable; автоматическая установка не выполнялась.
