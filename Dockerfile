FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Ensure data directory exists and has proper permissions
RUN mkdir -p /app/data && chmod -R 755 /app/data

EXPOSE 8421

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node bin/octosql.js status || exit 1

CMD ["node", "daemon.js"]