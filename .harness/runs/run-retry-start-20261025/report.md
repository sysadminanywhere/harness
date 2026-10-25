# Retry запускает новую попытку

Финальное дополнение: исправлен также Windows sandbox TEMP root. Общий D:/Temp не позволял sandbox setup менять ACL. Каждый child получает .harness/runs/<runId>/tmp; глобальные ACL и конфигурация не изменялись. Known sandbox failures теперь failed даже при exitCode 0. Проверки: HARNESS_SANDBOX_OK, HARNESS_REAL_TOOLS_OK, npm test PASS (15 bridge tests).

Актуальная HCM-попытка — run-1792943985613-6b4bfa16, thread 01a173ca-14df-7031-aae2-e7ea3fbe3e8f; рабочие команды завершились с exitCode 0. Исполнитель оставлен работать. Первая попытка ниже столкнулась с ошибкой sandbox, а не выполнила реализацию. Дополнительные файлы: codex-bridge.js, scripts/codex-bridge.test.cjs, scripts/probe-codex-tools.cjs, README.md. Диагностика сверена с https://learn.chatgpt.com/docs/windows/windows-sandbox.

Статус: completed; проверки PASS.

Retry теперь создаёт новый run и запускает/ставит в очередь исполнителя одним запросом. Дубликаты повторного запроса возвращают ту же попытку. Reset отдельно возвращает ready. Добавлены обратная связь на кнопке, постоянное сообщение ошибки и timeout запроса.

Проверки: npm test PASS; Playwright RETRY_ONE_CLICK_OK без второго нажатия Run; duplicate/null-run/queued/local-command retry регрессии PASS; git diff --check PASS.

Реальный HCM-32 запущен через Retry: run-1792943489185-2a942b63, thread 01a173c2-859f-7e61-9181-6ec8155f5696. Подтверждены thread.started, turn.started и настоящее сообщение Codex. Этот исполнитель оставлен работать; результат КЭДО не считается принятым.

Файлы: server.js, board.js, sw.js, README.md, scripts/controls-test.mjs, scripts/runtime-test.mjs, scripts/browser-controls-probe.js и .harness protocol. Подробный отчёт: .harness/reports/latest.md; сообщения: messages.jsonl.
