# Сервер экосистемы + все веб-приложения (клиентка, СТО, консьерж, диспетчер)
FROM node:22-alpine
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY server server
COPY apps apps
ENV PORT=8080 DB_FILE=/data/ecosystem.db
VOLUME /data
EXPOSE 8080
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
