FROM node:24-alpine
WORKDIR /app
COPY . .
RUN npm ci --omit=dev --ignore-scripts
EXPOSE 4006
CMD ["node", "--experimental-strip-types", "services/service-telecom/src/index.ts"]
