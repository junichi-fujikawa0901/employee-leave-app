FROM node:20-alpine

# Prisma CLI/エンジンが Linux 上で openssl を要求するため追加
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npx prisma generate && npm run dev -- -H 0.0.0.0"]
