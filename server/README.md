# ViewLocal Server

Node.js + Express + Socket.io. Принимает JPEG‑кадры от клиентов, раздаёт их веб‑интерфейсу.

## Быстрый старт

```bash
npm install
cd frontend && npm install && npm run build
cd ..
npm start
```

По умолчанию слушает `0.0.0.0:4000`. Переопределить: `PORT=8080 HOST=0.0.0.0 npm start`.

## Разработка

```bash
npm run dev              # backend с nodemon
cd frontend && npm run dev   # фронт на :5173, прокси к :4000
```

## Namespaces

- `/` — веб‑UI (zimmer'ы, получают события `clients`, `frame`, `client-gone`)
- `/client` — клиенты (отправляют `frame`, auth‑метаданные через `socket.handshake.auth`)

## REST

- `GET /api/health` — `{ok, clients, ts}`
- `GET /api/clients` — список клиентов
