FROM oven/bun:1.4.4-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
USER bun
CMD ["bun", "src/index.js"]
