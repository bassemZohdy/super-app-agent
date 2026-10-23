FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --ignore-scripts
EXPOSE 4000
CMD ["node", "--experimental-strip-types", "services/agent-core/src/index.ts"]
