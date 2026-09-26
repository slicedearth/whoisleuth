ARG PRIMARY_NODE_IMAGE
ARG COMPATIBILITY_NODE_IMAGE
ARG BROWSER_IMAGE
FROM ${PRIMARY_NODE_IMAGE} AS primary-node
FROM ${COMPATIBILITY_NODE_IMAGE} AS compatibility-node
FROM ${BROWSER_IMAGE}

ARG CODEQL_VERSION=2.27.1
ARG POWERSHELL_VERSION=7.6.6
ARG TARGETARCH

USER root
RUN apt-get update && apt-get install -y --no-install-recommends git zsh fish curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) CODEQL_PLATFORM=linux64; CODEQL_SHA256=1ec99cfa9420f04c2330784b4ddb8363a0dd67c3e4471cd93963c50e6c433717 ;; \
      arm64) CODEQL_PLATFORM=linux-arm64; CODEQL_SHA256=5e87cf7254bc948b002ae444066ecc6f913960361ac675d049862dcb62d7786a ;; \
      *) exit 1 ;; \
    esac \
    && curl --fail --location --retry 2 --output /tmp/codeql.tar.zst \
      "https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_VERSION}/codeql-bundle-${CODEQL_PLATFORM}.tar.zst" \
    && echo "${CODEQL_SHA256}  /tmp/codeql.tar.zst" | sha256sum --check --strict \
    && tar --zstd -xf /tmp/codeql.tar.zst -C /opt \
    && rm /tmp/codeql.tar.zst
RUN case "$TARGETARCH" in \
      amd64) POWERSHELL_PLATFORM=x64; POWERSHELL_SHA256=ddbc4a2d113bbd46d283cfedcbcd117a70caefd7673f41f2b4e0000badf103bc ;; \
      arm64) POWERSHELL_PLATFORM=arm64; POWERSHELL_SHA256=924829e54c983648f6f1419a2dc7f9433c861b2fb5bd57736ff096c24f133729 ;; \
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
COPY linux-verification-entrypoint.sh /usr/local/bin/verify-checkout
RUN chmod 755 /usr/local/bin/verify-checkout
ENV PATH="/opt/codeql:/opt/pwsh:${PATH}" \
    WHOISLEUTH_CLI_RUNTIME_NODE=/opt/node-compat/bin/node \
    WHOISLEUTH_BROWSER_SYSTEM_DEPS=preinstalled \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CI=1
USER pwuser
WORKDIR /home/pwuser
ENTRYPOINT ["verify-checkout"]
