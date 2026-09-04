# The minter has no dependencies: it is Node's standard library, WebCrypto and
# about two hundred lines. Nothing to install, nothing to audit.
FROM node:26-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

# Never root, and never able to write its own source.
USER node

EXPOSE 8080
CMD ["node", "src/server.ts"]
