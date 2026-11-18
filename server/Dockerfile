FROM node:22-alpine
# Prisma's migration engine needs OpenSSL, which the Alpine image doesn't include.
RUN apk add --no-cache openssl
WORKDIR /app
# The schema and config go in before npm install, because postinstall runs
# `prisma generate` and needs them.
COPY package.json package-lock.json* prisma.config.ts ./
COPY prisma ./prisma
RUN npm install
COPY . .
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
