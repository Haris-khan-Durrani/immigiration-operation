FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY scripts/prepare-assets.js ./scripts/prepare-assets.js
COPY public/richtext-entry.js ./public/richtext-entry.js
RUN npm ci --omit=dev
COPY server ./server
COPY database ./database
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /app/private-uploads /app/backups && chown -R node:node /app
USER node
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["sh", "-c", "node server/migrate.js && node server/index.js"]
