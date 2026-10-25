# Исправление spawn codex ENOENT

Причина: установленный Codex CLI находится в `%LOCALAPPDATA%/OpenAI/Codex/bin/<build-id>/codex.exe`. Старый поиск не обходил каталоги версий и зависел от PATH/окружения Codex.

Исправлено: абсолютный путь, явная настройка CODEX_CLI_PATH, runtime env, PATH и поиск установленных версионных сборок. Некорректный явный путь вызывает понятную ошибку. Незавершённые каталоги обновлений пропускаются.

Проверки: npm test PASS (11 bridge tests, HARNESS_SMOKE_OK, HARNESS_RUNTIME_OK); реальный CLI найден с полностью пустым PATH и без обеих переменных CODEX; полноценный bridge без Codex env и Codex PATH получил HARNESS_STANDALONE_OK и completed с exitCode 0.

Сервер перезапущен на 4173. HCM-32: ready, queue [], предыдущая failed-попытка сохранена. КЭДО повторно не запускалась.

Файлы: codex-bridge.js, scripts/codex-bridge.test.cjs, README.md и .harness-протокол.
