# ViewLocal — LAN Screen Monitor

Просмотр рабочих столов компьютеров в локальной сети. Один сервер с веб‑интерфейсом + лёгкий клиент‑агент на удалённых машинах с автообновлением.

```
┌──────────────┐   1 fps JPEG      ┌──────────────┐   Socket.io     ┌───────────────┐
│ Client(s)    │ ────── Socket.io ─▶│ Server (Node)│ ──── push ─────▶│ Web UI (React)│
│ Electron app │                   │ + Static UI  │                 │ tiles / list  │
└──────────────┘                   └──────────────┘                 └───────────────┘
       ▲                                   ▲
       │  auto-update (electron-updater)   │
       └───────── GitHub Releases ─────────┘
```

## Возможности

- **Сервер**: Node.js + Express + Socket.io. Принимает кадры от клиентов, отдаёт веб‑UI.
- **Веб‑UI**: React + Vite. Тайлы и список. Клик по тайлу — увеличенный просмотр. Обновление 1 раз/сек.
- **Клиент**: Electron. Захват экрана `desktopCapturer`, JPEG, настраиваемая частота/качество.
- **Автообновление**: `electron-updater` + GitHub Releases (private-repo compatible). Клиент сам скачивает и ставит обновления.
- **Tray‑иконка**, single‑instance lock, автозапуск при входе в систему.
- **Кроссплатформенно**: Windows (NSIS), macOS (DMG), Linux (AppImage).

## Структура

```
ViewLocal/
├── server/                 # Серверная часть (отдельный npm‑проект)
│   ├── src/index.js        # Express + Socket.io
│   ├── package.json
│   └── frontend/           # React UI (Vite)
│       ├── index.html
│       ├── vite.config.js
│       └── src/{App.jsx, main.jsx, styles.css}
├── client/                 # Клиентская часть (отдельный npm‑проект)
│   ├── src/{main.js, preload.js, settings.html}
│   ├── build/icon.svg
│   └── package.json        # + electron-builder config
├── .github/workflows/release-client.yml
└── README.md
```

## Требования

- Node.js 18+
- npm 9+
- (Для сборки клиента под Windows с GitHub Releases) — переменная окружения `GH_TOKEN` с правом `repo`

## Запуск сервера

```bash
cd server
npm install
cd frontend && npm install && npm run build
cd ..
npm start
# слушает 0.0.0.0:4000 — веб‑UI: http://<host>:4000/
```

Dev‑режим (с hot‑reload UI):

```bash
# терминал 1 — backend
cd server && npm run dev
# терминал 2 — frontend
cd server/frontend && npm run dev
# открыть http://localhost:5173
```

### Endpoints

| URL                         | Назначение                          |
|-----------------------------|-------------------------------------|
| `GET /`                     | Веб‑UI (SPA)                        |
| `GET /api/health`           | JSON health‑check                   |
| `GET /api/clients`          | Список подключённых клиентов        |
| `ws  /socket.io`            | Связь с веб‑UI                      |
| `ws  /client/socket.io`     | Namespace для клиентов (кадры)      |

## Запуск клиента в режиме разработки

```bash
cd client
npm install
VIEWLOCAL_SERVER=http://192.168.1.10:4000 npm start
```

При первом запуске открывается окно настроек: адрес сервера, интервал, ширина кадра, качество JPEG, автозапуск.

## Сборка клиента и релиз

Собрать установщик локально (артефакты → `client/release/`):

```bash
cd client
npm run dist:win     # Windows NSIS
npm run dist         # по умолчанию — текущая ОС
```

Опубликовать в GitHub Releases (включит автообновление на всех клиентах):

```bash
cd client
# bump версию
npm version patch           # или minor / major
# опубликовать
export GH_TOKEN=ghp_xxx     # токен с правом repo
npm run publish
```

Или через GitHub Actions: закоммитьте изменения, запушьте тег `client-vX.Y.Z` → workflow `Release Client` соберёт под Windows/macOS/Linux и опубликует.

```bash
git tag client-v1.0.1
git push origin client-v1.0.1
```

## Как работает автообновление

1. `electron-builder` публикует в GitHub Releases файлы: `ViewLocal-Client-Setup-x.y.z.exe`, `latest.yml`, `*.blockmap`.
2. Клиент при старте (через 15 сек) и далее раз в 30 мин обращается к `latest.yml` через `electron-updater` (провайдер `github`, поддерживает private repo).
3. Если версия в релизе выше — фоновая загрузка и `quitAndInstall` через 3 сек.
4. Тихий one‑click NSIS установщик устанавливает per‑user, не требует админских прав.

Для private‑репозитория `electron-updater` автоматически использует GitHub token, встроенный при сборке через `GH_TOKEN`. Подробнее: https://www.electron.build/auto-update.html

## Настройки клиента (persistent, `electron-store`)

| Ключ             | По умолчанию             | Что делает                              |
|------------------|--------------------------|------------------------------------------|
| `serverUrl`      | `http://192.168.1.10:4000` | Адрес сервера                          |
| `captureInterval`| `1000`                   | Интервал захвата, мс                    |
| `maxWidth`       | `1280`                   | Макс. ширина передаваемого кадра, px    |
| `jpegQuality`    | `0.6`                    | Качество JPEG (0.1 – 1.0)               |
| `launchOnStartup`| `true`                   | Автозапуск при входе                    |

Можно заранее указать сервер через переменную окружения `VIEWLOCAL_SERVER` перед первым запуском.

## Устойчивость клиента (защита от случайного закрытия)

Клиент рассчитан на управляемые машины, где **пользователи знают о мониторинге**, но
могут случайно завершить агент в Диспетчере задач. Чтобы агент сам восстанавливался
и его не мог выгрузить обычный (не‑админ) пользователь, установка (perMachine, с правами
администратора) создаёт две задачи Планировщика:

| Задача | От кого | Сессия | Может ли не‑админ убить |
|---|---|---|---|
| `ViewLocal Agent` | интерактивный пользователь | сессия пользователя | да — но мгновенно поднимается обратно |
| `ViewLocal Watchdog` | `LocalSystem` | session 0 | нет (Access Denied) |

Как работает:

1. Агент раз в секунду пишет heartbeat в `C:\ProgramData\ViewLocal\agent-heartbeat`
   (независимо от состояния сети — простой сервера не выглядит как «мёртвый агент»).
2. Watchdog (`resources\watchdog.js`, запущен как SYSTEM через Electron‑as‑Node) каждую
   секунду проверяет heartbeat. Если он протух (>4 c) — `schtasks /Run "ViewLocal Agent"`
   поднимает агент в сессии пользователя за ~3 секунды.
3. SYSTEM‑процесс watchdog обычный пользователь убить не может, а сами задачи лежат в
   корне Планировщика и защищены от не‑админа (нельзя отключить/удалить).

Это **супервайзер, а не скрытность**: агент виден в Диспетчере задач, ничем не
маскируется. Полный контроль остаётся у администратора — отключить задачу
`ViewLocal Watchdog` или запустить `resources\service\uninstall-tasks.ps1` (деинсталлятор
делает это автоматически).

Ручная (пере)установка задач, если нужно вне инсталлятора (PowerShell от админа):

```powershell
& "C:\Program Files\ViewLocal Client\resources\service\install-tasks.ps1" `
  -ExePath        "C:\Program Files\ViewLocal Client\ViewLocal Client.exe" `
  -WatchdogScript "C:\Program Files\ViewLocal Client\resources\watchdog.js"
```

## Безопасность

- Проект рассчитан на доверенную локальную сеть.
- Для выхода за периметр LAN рекомендуется:
  - поднять HTTPS на сервере (обратный прокси Caddy/Nginx);
  - добавить shared‑secret/JWT‑токен в `auth` при подключении клиента;
  - ограничить `CORS` на сервере.
- Не коммитьте токены/секреты.

## Roadmap

- [ ] Shared‑secret аутентификация клиентов
- [ ] Запись сессий (rolling history)
- [ ] Удалённые действия (lock / notify)
- [ ] Поддержка нескольких мониторов на клиенте

## Лицензия

Private.
