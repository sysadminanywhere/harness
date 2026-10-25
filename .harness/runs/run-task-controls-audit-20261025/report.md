# Проверка управления задачами

Статус: completed; exitCode: 0.

Исправлены server/card/run рассогласования, cancel active/queued/ready, retry persistence, historical review, pause/resume Codex, background command cancellation, stale run protection, deletion and editing of running cards. Клиент больше не записывает статусы после управления самостоятельно.

Проверки: npm test PASS (12 bridge tests и smoke/runtime/controls suites); реальный Codex pause/resume PASS; Playwright task controls и active deletion PASS; git diff --check PASS.

HCM-32 отменена: cancelled, runId null, queue пустая; карточка persisted blocked/cancelled true. Реализация КЭДО не запускалась. Обновлённый сервер оставлен на 4173.

Файлы: server.js, codex-bridge.js, board.js, sw.js, package.json, README.md, scripts/smoke.mjs, scripts/codex-bridge.test.cjs, scripts/controls-test.mjs, scripts/browser-controls-probe.js, scripts/probe-codex-controls.cjs и Harness protocol files. Подробности: .harness/reports/latest.md. Расшифровка: messages.jsonl.

Дополнительная очистка временных preview-папок отклонена автоматической проверкой; тестовые браузер и сервер закрыты.
