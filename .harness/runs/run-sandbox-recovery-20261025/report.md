# HCM-35: восстановление окружения и статуса

Причина: старая попытка пыталась менять ACL общего D:/Temp, WRITE_DAC denied. Реальный read-only CodexBridge probe в D:/GitHub/hcm с индивидуальным TEMP успешно исполнил PowerShell (HARNESS_REAL_TOOLS_OK). Настройки sandbox и глобальные ACL не менялись.

Исправлены обработка sandbox failures в MCP/финальном сообщении и восстановление старых ложных completed. Исходные run.json/report.md резервируются. Успешное восстановление команд и принятые пользователем результаты сохраняются.

Проверки: npm test PASS (22 unit/model/bridge tests, smoke/runtime/models/controls), HARNESS_REAL_TOOLS_OK в HCM, node --check scripts/probe-codex-tools.cjs, git diff --check. Fresh GET основного сервера: HCM-35 blocked, run failed, report failed; событие codex_false_completion_recovered записано. Сервер оставлен на 4173.

Изменены: codex-bridge.js, server.js, scripts/codex-bridge.test.cjs, scripts/runtime-test.mjs, scripts/probe-codex-tools.cjs, README.md и протокол .harness. HCM-35 не реализована и повторно не запускалась; диагностика не меняла прикладной код HCM.
