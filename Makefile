# Anvil's second test account. A published, well-known key with no value
# outside a local chain; DeployLocal.s.sol pre-funds it with mock USDC.
ANVIL_BUYER_KEY := 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a
# 18545: see config/chain-ports.yml. 8545 is the port every other local stack
# on a developer's machine already holds.
ANVIL_RPC       := http://127.0.0.1:18545
CHAIN_DIR       := .local-chain
# The rehearsal's own channel store: never the developer's ~/.toon, whose
# watermark belongs to whatever chain they last used.
#
# ITS LIFETIME IS THE CHAIN'S. Deleting it while the channel is still open on
# chain is refused by the client, and rightly: resuming would restart the nonce
# at 0 and every claim would be rejected, while opening a new channel would
# strand the collateral in the old one. So `hs-e2e` never removes it and
# `hs-down`, which takes the chain down with it, always does.
#
# IT IS TWO FILES. The client writes the nonce watermark to the path it is
# given and the channel BINDINGS to a `.peers.json` sibling of it. Removing only
# the first leaves a binding pointing at a channel whose watermark is gone,
# which is the one state the client refuses to start from -- so both names are
# always removed together.
HS_STORE        := $(CURDIR)/.hs-channels.json
HS_STORE_FILES  := $(HS_STORE) $(CURDIR)/.hs-channels.peers.json
# The loopback rehearsal gets its own too, and for the same reason: the client's
# default is ~/.toon, whose watermark belongs to whatever chain the developer
# last used. A stale entry there fails as `F01 ... names a channel this
# connector has no record of`, which reads like a connector fault and is not one.
LOCAL_STORE     := $(CURDIR)/.local-channels.json
LOCAL_STORE_FILES := $(LOCAL_STORE) $(CURDIR)/.local-channels.peers.json
LOCAL_COMPOSE   := -f compose.yml -f compose.local.yml
HS_COMPOSE      := -f compose.yml -f compose.local-hs.yml
HS_COMPOSE_FILES := compose.yml:compose.local-hs.yml
HS_ENV          := COMPOSE_FILE=$(HS_COMPOSE_FILES)
# The buyer proxy's host port. 9050 is usually already held by a developer's own
# anon/Tor daemon; see compose.yml.
ANON_SOCKS_PORT ?= 19050

.PHONY: help keys verify test chain-up chain-down local-up local-down local-e2e \
        up down logs buy verify-routes hs-address hs-e2e hs-down clean

help:
	@echo "Local chain (recommended -- no testnet money needed):"
	@echo "  make local-e2e    keys, tests, anvil, stack, buy a bundle, check routes"
	@echo "  make hs-e2e       the same, but reached ONLY at its hidden-service address"
	@echo "  make local-up     start anvil and the stack against it"
	@echo "  make local-down   stop both"
	@echo ""
	@echo "Ethereum mainnet, behind a hidden service (REAL MONEY):"
	@echo "  make up           start the daemon, render its address, start the stack"
	@echo "  make hs-address    print this node's address and re-render the config"
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
	cd $(CHAIN_DIR) && HOST_UID=$$(id -u) HOST_GID=$$(id -g) docker compose \
		-f docker-compose.yml -f $(CURDIR)/config/chain-ports.yml --profile evm up -d
	@echo "anvil is up with the settlement contracts deployed"

chain-down:
	@if [ -d $(CHAIN_DIR) ]; then cd $(CHAIN_DIR) && docker compose \
		-f docker-compose.yml -f $(CURDIR)/config/chain-ports.yml --profile evm down; fi

local-up: keys verify chain-up
	docker compose $(LOCAL_COMPOSE) up -d --build
	@echo "waiting for the connector ..."
	@until curl -fsS http://127.0.0.1:3000/ilp >/dev/null 2>&1; do sleep 2; done
	@echo "connector is serving, settling on anvil"

local-down:
	docker compose $(LOCAL_COMPOSE) down
	rm -f $(LOCAL_STORE_FILES)
	$(MAKE) chain-down

# The whole loop, with no testnet money and no funding step.
local-e2e: test local-up
	cd buyer && npm install --silent && \
		TOON_CHANNEL_STORE=$(LOCAL_STORE) \
		TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run buy
	cd buyer && TOON_CHANNEL_STORE=$(LOCAL_STORE) \
		TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run verify-routes

# --- Ethereum mainnet, behind a hidden service -------------------------------
# THE ORDER HERE IS THE POINT, and it is why a bare `docker compose up -d` is
# not the documented path. The daemon has to generate an address before the
# connector's config can name it, and the connector mounts the RENDERED config
# rather than the committed template -- so the three steps cannot be collapsed
# into one. See scripts/hs-address.sh and connector ADR 0070 decision 7.
up: keys verify
	docker compose up -d anon
	@echo "waiting for the hidden service to bootstrap (a minute or two, longer on a cold volume) ..."
	@n=0; while :; do \
		cid=$$(docker compose ps -q anon 2>/dev/null); \
		if [ -n "$$cid" ] && \
		   [ "$$(docker inspect -f '{{.State.Health.Status}}' $$cid 2>/dev/null)" = healthy ]; then \
			break; \
		fi; \
		n=$$((n+1)); \
		if [ $$n -gt 120 ]; then \
			echo ""; \
			echo "  The daemon did not reach 'Bootstrapped 100%' in ten minutes."; \
			echo "  make logs   -- a cold volume is slow; a blocked network never finishes."; \
			echo "  If it exited at once, check AgreeToTerms in config/anonrc."; \
			exit 1; \
		fi; \
		sleep 5; \
	done
	./scripts/hs-address.sh
	docker compose up -d --build
	@echo "waiting for the connector ..."
	@until curl -fsS http://127.0.0.1:3000/ilp >/dev/null 2>&1; do sleep 2; done
	@echo "connector is serving, reachable only over the circuit"

# Prints the address and re-renders the config from it. Run it after any restart
# of the daemon: it is also the check that the address SURVIVED that restart,
# which is the one failure that goes unnoticed on every buyer at once.
hs-address:
	./scripts/hs-address.sh

down:
	docker compose down

buy:
	cd buyer && npm install --silent && npm run buy

verify-routes:
	cd buyer && npm run verify-routes

logs:
	docker compose logs -f

# `down` keeps volumes, so this does NOT destroy the address -- losing it
# would cost every buyer their configuration, and no `make clean` should be able
# to do that by accident. `docker compose down -v` is how you really discard it.
clean: down chain-down
	rm -rf data config/.rendered $(HS_STORE_FILES) $(LOCAL_STORE_FILES) claim-minter/node_modules buyer/node_modules $(CHAIN_DIR)

# Waits until the named services report docker-healthy. `anon`'s healthcheck is
# "hostname file exists AND Bootstrapped 100%", so this is a wait for a CIRCUIT,
# not for a container: one that is Up has neither.
define wait_healthy
	@export $(HS_ENV); for svc in $(1); do \
		n=0; \
		while :; do \
			cid=$$(docker compose ps -q $$svc 2>/dev/null); \
			if [ -n "$$cid" ] && \
			   [ "$$(docker inspect -f '{{.State.Health.Status}}' $$cid 2>/dev/null)" = healthy ]; then \
				echo "  $$svc: healthy"; break; \
			fi; \
			n=$$((n+1)); \
			if [ $$n -gt 120 ]; then \
				echo "  $$svc never became healthy."; \
				echo "  COMPOSE_FILE=$(HS_COMPOSE_FILES) docker compose logs --tail 50 $$svc"; \
				exit 1; \
			fi; \
			sleep 5; \
		done; \
	done
endef

# --- The hidden-service ingress, on a local chain -----------------------------
# `local-e2e` proves the stack over loopback. THIS proves the INGRESS: the same
# node reached only at its `.anyone` address, paid by the real toon client over
# a circuit, still settling on anvil so it costs nothing.
#
# Deliberately not part of `local-e2e`: it waits on a third-party anonymity
# network bootstrapping, and a gate that goes red when that network has a bad
# day is "a test either runs or fails loudly" inverted rather than honoured.
#
# COMPOSE_FILE is set PER RECIPE LINE, not on the target: a target-level export
# reaches prerequisites too, and `chain-up` runs `docker compose` inside
# .local-chain, where these files do not exist. Each line is its own shell, so
# exporting at the head of a line scopes it exactly.
hs-e2e: keys verify chain-up
	# Build EVERYTHING first. A later `up --build` would rebuild the daemon
	# images, and a new image id makes compose RECREATE those containers --
	# throwing away the circuits this rehearsal just waited for, moments before
	# it needs them.
	$(HS_ENV) docker compose build
	$(HS_ENV) docker compose up -d anon anon-client
	@echo "waiting for both daemons to bootstrap (a minute or two, longer on a cold volume) ..."
	$(call wait_healthy,anon anon-client)
	$(HS_ENV) ./scripts/hs-address.sh config/connector.local-hs.toml config/.rendered/connector.local-hs.toml
	$(HS_ENV) docker compose up -d
	@echo "waiting for the connector ..."
	$(call wait_healthy,connector)
	@echo "  and re-checking the daemons, in case the stack disturbed them"
	$(call wait_healthy,anon anon-client)
	@echo "connector is serving, and it publishes no port -- the circuit is the only way in"
	@addr=$$(grep -oE '[a-z2-7]{56}\.anyone' config/.rendered/connector.local-hs.toml | head -1); \
	echo ""; echo "=== buying a bundle at $$addr, over the circuit ==="; \
	cd buyer && npm install --silent && \
	TOON_CONNECTOR=http://$$addr \
	TOON_SOCKS_PROXY=socks5h://127.0.0.1:$(ANON_SOCKS_PORT) \
	TOON_PROXY_RPC=false \
	TOON_CHANNEL_STORE=$(HS_STORE) \
	TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run buy
	@addr=$$(grep -oE '[a-z2-7]{56}\.anyone' config/.rendered/connector.local-hs.toml | head -1); \
	echo ""; echo "=== route checks, over the circuit ==="; \
	cd buyer && \
	TOON_CONNECTOR=http://$$addr \
	TOON_SOCKS_PROXY=socks5h://127.0.0.1:$(ANON_SOCKS_PORT) \
	TOON_PROXY_RPC=false \
	TOON_CHANNEL_STORE=$(HS_STORE) \
	TOON_EVM_PRIVATE_KEY=$(ANVIL_BUYER_KEY) TOON_RPC_URL=$(ANVIL_RPC) npm run verify-routes

hs-down:
	$(HS_ENV) docker compose down
	rm -f $(HS_STORE_FILES)
	$(MAKE) chain-down
