# Исправление очереди и жизненного цикла Codex

Статус: completed.

Исправлены ложный heartbeat браузера, определение прогресса, таймаут старта сессии, обработка завершения и отмены процесса, защита runId, восстановление очереди и показ текущей ошибки. Терминальные запуски освобождают claim.

Проверки: npm test PASS (10 bridge tests, HARNESS_SMOKE_OK, HARNESS_RUNTIME_OK с auto-dispatch); настоящий Codex ответил HARNESS_BRIDGE_OK через bridge; Playwright Retry в HCM показал Run вместо очереди/ошибки; API подтвердил ready, queue [], claim отсутствует. git diff --check PASS.

Файлы: server.js, codex-bridge.js, board.js, sw.js, package.json, README.md, scripts/test.mjs, scripts/codex-bridge.test.cjs, scripts/runtime-test.mjs и локальный Harness-протокол. Подробный отчёт с сохранённой историей — `.harness/reports/latest.md`; сообщения — `messages.jsonl` рядом с этим отчётом.
