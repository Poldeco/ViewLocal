# ViewLocal Client

Electron‑приложение. Захватывает экран и стримит на сервер (1 fps по умолчанию). Работает в системном трее. Автоматически обновляется из GitHub Releases.

## Разработка

```bash
npm install
VIEWLOCAL_SERVER=http://192.168.1.10:4000 npm start
```

## Сборка локально

```bash
npm run dist:win       # Windows installer (NSIS) в ./release
npm run dist           # текущая платформа
```

## Публикация в GitHub Releases

```bash
npm version patch
export GH_TOKEN=ghp_xxx
npm run publish
```

Либо через GitHub Actions — workflow `.github/workflows/release-client.yml`, запускается по тегу `client-vX.Y.Z`.

## Файлы

- `src/main.js` — основной процесс: захват, Socket.io, tray, auto-updater
- `src/preload.js` — bridge IPC
- `src/settings.html` — окно настроек
- `build/icon.svg` — иконка (конвертируйте в `.ico`/`.icns`/`.png` для production)
