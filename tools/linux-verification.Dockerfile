ARG PRIMARY_NODE_IMAGE
ARG COMPATIBILITY_NODE_IMAGE
ARG BROWSER_IMAGE
FROM ${PRIMARY_NODE_IMAGE} AS primary-node
FROM ${COMPATIBILITY_NODE_IMAGE} AS compatibility-node
FROM ${BROWSER_IMAGE}

ARG CODEQL_VERSION=2.27.0
ARG CODEQL_SHA256=5e0f04bcb92c0c0973b6f5597e55316269051fa98bda3f725d8af9a85016721a
ARG POWERSHELL_VERSION=7.6.6
ARG POWERSHELL_SHA256=ddbc4a2d113bbd46d283cfedcbcd117a70caefd7673f41f2b4e0000badf103bc

USER root
RUN apt-get update && apt-get install -y --no-install-recommends git zsh fish curl ca-certificates zstd \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --location --retry 2 --output /tmp/codeql.tar.zst \
      "https://github.com/github/codeql-action/releases/download/codeql-bundle-v${CODEQL_VERSION}/codeql-bundle-linux64.tar.zst" \
    && echo "${CODEQL_SHA256}  /tmp/codeql.tar.zst" | sha256sum --check --strict \
    && tar --zstd -xf /tmp/codeql.tar.zst -C /opt \
    && rm /tmp/codeql.tar.zst
RUN mkdir /opt/pwsh \
    && curl --fail --location --retry 2 --output /tmp/powershell.tar.gz \
      "https://github.com/PowerShell/PowerShell/releases/download/v${POWERSHELL_VERSION}/powershell-${POWERSHELL_VERSION}-linux-x64.tar.gz" \
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
