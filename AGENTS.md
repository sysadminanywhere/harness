# Harness Lab instructions

Всегда добавлять нужные файлы в git, если проект является Git-репозиторием.

## Harness file protocol

Если существует `.harness/current-task.md`, перед началом работы прочитать этот файл и использовать его как контекст активной задачи.

Во время работы:
- during long-running work, periodically update intermediate progress in `.harness/reports/latest.md`;
- for Codex runs, preserve received message text in `.harness/runs/<runId>/messages.jsonl` and keep reports synchronized with that transcript;

- обновлять `.harness/status.json` при смене состояния задачи;
- во время длительной работы периодически обновлять промежуточный прогресс в `.harness/reports/latest.md`, чтобы наблюдатели видели текущий шаг до завершения;
- для запусков Codex сохранять полученный текст сообщений в `.harness/runs/<runId>/messages.jsonl` и синхронизировать отчёт с этой расшифровкой;
- добавлять существенные события в `.harness/events.jsonl` в формате JSON Lines;
- не перезаписывать пользовательские инструкции и существующий контекст;
- после завершения записывать отчёт в `.harness/reports/latest.md`;
- указывать в отчёте выполненные проверки и изменённые файлы;
- не объявлять задачу завершённой, если обязательные проверки не прошли.
