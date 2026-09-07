# anon v0.4.10.2 -- the daemon this stack runs, and the release `toon-client`
# pins as its ANON_VERSION.
#
# WHY THIS FILE EXISTS. ghcr.io/anyone-protocol/ator-protocol publishes no image
# for it: its tag list stops at v0.4.9.7, from October 2024. So this overlays
# the official release binary onto that image, which keeps the image contract --
# the `anond` user, /var/lib/anon and its ownership, the entrypoint -- identical.
# The binary is statically linked, so nothing else has to come with it.
#
# THE VERSION IS THE WHOLE POINT. Anyone Protocol renamed the hidden-service TLD
# between these two releases, and the rename is total in both directions:
#
#            | anon v0.4.9.7        | anon v0.4.10.2
#   TLD      | .onion               | .anyone
#   other    | ".anyone" absent     | ".onion" -- ZERO occurrences
#
# v0.4.10.2 writes `<56-base32>.anyone` into HiddenServiceDir/hostname, routes
# it, and REFUSES the same address spelled `.onion`. The toon client accepts
# `.anyone` and nothing else -- it rejects `.onion` by name, because that is Tor
# and not `anon`. So a daemon at the older pin publishes an address every buyer
# refuses. Do not "simplify" this back to the ghcr tag.
FROM ghcr.io/anyone-protocol/ator-protocol:v0.4.9.7

ARG ANON_VERSION=v0.4.10.2
# sha256 of anon-live-linux-amd64.zip -- the same figure toon-client records in
# packages/client/src/cli/anon-daemon.ts. Checked BEFORE the binary is ever
# executed: an unverified download is not an upgrade.
ARG ANON_SHA256=9c6498b8d27de54d78842a1b854979a605f9c140ccc34f2b4c267bf094eaeb17

USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends curl unzip ca-certificates; \
    curl -fsSL -o /tmp/anon.zip \
      "https://github.com/anyone-protocol/ator-protocol/releases/download/${ANON_VERSION}/anon-live-linux-amd64.zip"; \
    echo "${ANON_SHA256}  /tmp/anon.zip" | sha256sum -c -; \
    unzip -o -j /tmp/anon.zip -d /tmp/anon; \
    install -m 0755 /tmp/anon/anon /usr/local/bin/anon; \
    install -m 0644 /tmp/anon/geoip  /usr/local/share/anon/geoip; \
    install -m 0644 /tmp/anon/geoip6 /usr/local/share/anon/geoip6; \
    rm -rf /tmp/anon /tmp/anon.zip; \
    apt-get purge -y curl unzip; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    # Fail the BUILD, not the first bring-up, if the wrong release was fetched.
    anon --version | grep -q "0.4.10.2"
