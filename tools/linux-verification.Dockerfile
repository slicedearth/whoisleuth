ARG PRIMARY_NODE_IMAGE
ARG COMPATIBILITY_NODE_IMAGE
ARG BROWSER_IMAGE
ARG REDIS_IMAGE
FROM ${PRIMARY_NODE_IMAGE} AS primary-node
FROM ${COMPATIBILITY_NODE_IMAGE} AS compatibility-node
FROM ${REDIS_IMAGE} AS redis-verification
FROM ${BROWSER_IMAGE}

ARG CODEQL_VERSION=2.27.4
ARG POWERSHELL_VERSION=7.6.10
ARG TARGETARCH

USER root
RUN apt-get update && apt-get install -y --no-install-recommends git zsh fish curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) CODEQL_PLATFORM=linux64; CODEQL_SHA256=da3e952c7fe978a0b6b93e75d9cbabbdf8535667ca0810bd4b2ae37bc840ffee ;; \
      arm64) CODEQL_PLATFORM=linux-arm64; CODEQL_SHA256=1c015b411c6e1c7f7e767eb8c9408fc6a2012d24d78b177cf22f29edc5772d10 ;; \
      *) exit 1 ;; \
    esac \
    && curl --fail --location --retry 2 --output /tmp/codeql.tar.zst \
      "https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_VERSION}/codeql-bundle-${CODEQL_PLATFORM}.tar.zst" \
    && echo "${CODEQL_SHA256}  /tmp/codeql.tar.zst" | sha256sum --check --strict \
    && tar --zstd -xf /tmp/codeql.tar.zst -C /opt \
    && rm /tmp/codeql.tar.zst
RUN case "$TARGETARCH" in \
      amd64) POWERSHELL_PLATFORM=x64; POWERSHELL_SHA256=e261cabc91c78a9afe8d1e5f24731ab0d38204735ab2ec94b0af55102652e10d ;; \
      arm64) POWERSHELL_PLATFORM=arm64; POWERSHELL_SHA256=439432cdecf4418413b9a8f547e3ab4d9b40e8e4258913ec3d15fc92c67a9235 ;; \
      *) exit 1 ;; \
    esac \
    && mkdir /opt/pwsh \
    && curl --fail --location --retry 2 --output /tmp/powershell.tar.gz \
      "https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}/powershell-${POWERSHELL_VERSION}-linux-${POWERSHELL_PLATFORM}.tar.gz" \
    && echo "${POWERSHELL_SHA256}  /tmp/powershell.tar.gz" | sha256sum --check --strict \
    && tar -xzf /tmp/powershell.tar.gz -C /opt/pwsh \
    && chmod +x /opt/pwsh/pwsh && rm /tmp/powershell.tar.gz
COPY --from=primary-node /usr/local/ /usr/local/
COPY --from=compatibility-node /usr/local/ /opt/node-compat/
COPY --from=redis-verification /usr/local/bin/redis-server /usr/local/bin/redis-cli /opt/redis/bin/
COPY linux-verification-entrypoint.sh /usr/local/bin/verify-checkout
RUN chmod 755 /usr/local/bin/verify-checkout
ENV PATH="/opt/codeql:/opt/pwsh:${PATH}" \
    WHOISLEUTH_CLI_RUNTIME_NODE=/opt/node-compat/bin/node \
    WHOISLEUTH_BROWSER_SYSTEM_DEPS=preinstalled \
    WHOISLEUTH_VERIFICATION_REDIS_BIN_DIR=/opt/redis/bin \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=1
USER pwuser
WORKDIR /home/pwuser
ENTRYPOINT ["verify-checkout"]
