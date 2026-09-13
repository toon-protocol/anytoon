# The minter has no dependencies: it is Node's standard library, WebCrypto and
# about two hundred lines. Nothing to install, nothing to audit.
FROM node:26-alpine

# Links this image to its source on the GHCR package page, and is what tells a
# reader of someone else's compose file which repository they are running.
# Published from .github/workflows/claim-minter-image.yml; see
# docs/claim-minter-image.md for how a consumer pins it.
LABEL org.opencontainers.image.source="https://github.com/toon-protocol/anytoon"
LABEL org.opencontainers.image.description="Mints the credentials issuer's X-Payment-Claim from the TOON connector's X-TOON-Payer attribution."

WORKDIR /app
COPY package.json ./
COPY src ./src

# NAMED COPIES, not `COPY . .`: test/fixtures/proxy.key.pem is a private key,
# and this image is public. Key material reaches a running container through a
# mount (PROXY_PRIVATE_KEY_PATH) and never through a layer -- the entrypoint
# refuses to start when that mount is absent rather than falling back to
# anything. See .dockerignore, which is the second lock on the same door.

# Never root, and never able to write its own source.
USER node

EXPOSE 8080
CMD ["node", "src/server.ts"]
