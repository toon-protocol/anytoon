# Anvil's second test account. A published, well-known key with no value
# outside a local chain; DeployLocal.s.sol pre-funds it with mock USDC.
ANVIL_BUYER_KEY := 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
ANVIL_RPC       := http://127.0.0.1:8545
CHAIN_DIR       := .local-chain
LOCAL_COMPOSE   := -f compose.yml -f compose.local.yml

.PHONY: help keys verify test chain-up chain-down local-up local-down local-e2e \
        up down logs buy verify-routes clean

help:
	@echo "Local chain (recommended -- no testnet money needed):"
	@echo "  make local-e2e    keys, tests, anvil, stack, buy a bundle, check routes"
	@echo "  make local-up     start anvil and the stack against it"
	@echo "  make local-down   stop both"
	@echo ""
	@echo "Base Sepolia:"
	@echo "  make up           start the stack (needs a funded key)"
	@echo "  make buy          buy one bundle"
	@echo ""
	@echo "Always available:"
	@echo "  make keys         generate dev key material into ./data"
	@echo "  make verify       check ./data/keys against the issuer's boot rules"
	@echo "  make test         run both test suites (generates keys if needed)"
	@echo "  make logs         follow the stack's logs"
	@echo "  make clean        stop everything and remove generated files"

keys:
	./scripts/gen-keys.sh

verify:
	node scripts/verify-keys.ts

test: keys
	cd claim-minter && npm test
	cd buyer && npm test

# --- Local chain -------------------------------------------------------------
# anvil and the settlement contracts come from the connector repository, which
# deploys them at deterministic addresses on start. We do not reimplement that.
chain-up:
	@if [ ! -d $(CHAIN_DIR) ]; then \
		echo "cloning the connector repository for its anvil setup ..."; \
		git clone --depth 1 -q https://github.com/toon-protocol/connector $(CHAIN_DIR); \
	fi
	cd $(CHAIN_DIR) && HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose --profile evm up -d
	@echo "anvil is up with the settlement contracts deployed"

chain-down:
	@if [ -d $(CHAIN_DIR) ]; then cd $(CHAIN_DIR) && docker compose --profile evm down; fi

local-up: keys verify chain-up
	docker compose $(LOCAL_COMPOSE) up -d --build
	@echo "waiting for the connector ..."
	@until curl -fsS http://127.0.0.1:3000/ilp >/dev/null 2>&1; do sleep 2; done
	@echo "connector is serving, settling on anvil"

local-down:
	docker compose $(LOCAL_COMPOSE) down
	$(MAKE) chain-down

# The whole loop, with no testnet money and no funding step.
local-e2e: test local-up
	cd buyer && npm install --silent && \
		TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run buy
	cd buyer && TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run verify-routes

# --- Base Sepolia ------------------------------------------------------------
up: keys verify
	docker compose up -d --build
	@echo "waiting for the connector ..."
	@until curl -fsS http://127.0.0.1:3000/ilp >/dev/null 2>&1; do sleep 2; done
	@echo "connector is serving"

down:
	docker compose down

buy:
	cd buyer && npm install --silent && npm run buy

verify-routes:
	cd buyer && npm run verify-routes

logs:
	docker compose logs -f

clean: down chain-down
	rm -rf data claim-minter/node_modules buyer/node_modules $(CHAIN_DIR)
