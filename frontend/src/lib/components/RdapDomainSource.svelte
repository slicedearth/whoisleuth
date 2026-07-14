<script lang="ts">
  type JsonRecord = Record<string, any>;

  let {
    parsed,
    source = 'Registry',
  }: {
    parsed: JsonRecord;
    source?: string;
  } = $props();

  const roleOrder = ['registrar','registrant','administrative','technical','billing','abuse','noc','reseller','sponsor','proxy','notifications'];
  const populatedRoles = $derived(roleOrder.filter((role) => Array.isArray(parsed.entitiesByRole?.[role]) && parsed.entitiesByRole[role].length));

  function show(value: any): string {
    if (value == null || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ') || '—';
    if (typeof value === 'object') return show(value.name || value.org || value.handle || value.domain);
    return String(value);
  }

  function contactIdentity(contact: JsonRecord) {
    return show(contact.name || contact.org || contact.handle);
  }

  function contactDetails(contact: JsonRecord) {
    return [
      Array.isArray(contact.organizations) && contact.organizations.length ? `Organizations: ${contact.organizations.join(', ')}` : null,
      Array.isArray(contact.emails) && contact.emails.length ? `Email: ${contact.emails.join(', ')}` : null,
      Array.isArray(contact.phones) && contact.phones.length ? `Phone: ${contact.phones.join(', ')}` : null,
      Array.isArray(contact.addresses) && contact.addresses.length ? `Address: ${contact.addresses.join(' · ')}` : null,
      Array.isArray(contact.publicIds) && contact.publicIds.length ? `IDs: ${contact.publicIds.map((item: JsonRecord) => `${item.type}: ${item.identifier}`).join(', ')}` : null,
      Array.isArray(contact.links) && contact.links.length ? `Links: ${contact.links.map((item: JsonRecord) => item.href).join(', ')}` : null,
    ].filter(Boolean) as string[];
  }

  function linkText() {
    return Array.isArray(parsed.links)
      ? parsed.links.map((item: JsonRecord) => [item.rel, item.href].filter(Boolean).join(': ')).join(' · ')
      : '';
  }

  function glueText() {
    return Array.isArray(parsed.nameserverDetails)
      ? parsed.nameserverDetails
          .filter((item: JsonRecord) => Array.isArray(item.addresses) && item.addresses.length)
          .map((item: JsonRecord) => `${item.name}: ${item.addresses.join(', ')}`)
          .join(' · ')
      : '';
  }

  function dsText() {
    return Array.isArray(parsed.dsData)
      ? parsed.dsData.map((item: JsonRecord) => [item.keyTag,item.algorithm,item.digestType,item.digest]
          .filter((value) => value !== null && value !== undefined && value !== '').join(' ')).join(' · ')
      : '';
  }

  function textBlocks(value: any) {
    return Array.isArray(value)
      ? value.map((item: JsonRecord) => `${item.title}: ${(item.descriptions || []).join(' ')}`).join(' · ')
      : '';
  }

  function redactionText() {
    return Array.isArray(parsed.redactions)
      ? parsed.redactions.map((item: JsonRecord) => [
          item.name,item.method,item.reason,item.prePath||item.postPath||item.replacementPath,
        ].filter(Boolean).join(' · ')).join(' | ')
      : '';
  }

  function variantText() {
    return Array.isArray(parsed.variants)
      ? parsed.variants.map((group: JsonRecord) => {
          const names = Array.isArray(group.variantNames)
            ? group.variantNames.map((name: JsonRecord) => name.unicodeName || name.ldhName).filter(Boolean)
            : [];
          return [[...(group.relation || []),group.idnTable].filter(Boolean).join(', '),names.join(', ')]
            .filter(Boolean).join(': ');
        }).filter(Boolean).join(' · ')
      : '';
  }

  function serverTruncationText() {
    return Array.isArray(parsed.serverTruncationReasons)
      ? parsed.serverTruncationReasons.join(' · ')
      : '';
  }

  function formatDate(value: any) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function dateTimeAttribute(value: any) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
</script>

{#if parsed.serverTruncated}
  <p class="server-partial"><strong>Server-declared partial response.</strong> {source} reported that some RDAP data was omitted.{serverTruncationText() ? ` ${serverTruncationText()}.` : ''}</p>
{/if}

<dl>
  <dt>Domain</dt><dd>{show(parsed.domain)}</dd>
  <dt>Unicode name</dt><dd>{show(parsed.unicodeDomain)}</dd>
  <dt>Registry ID</dt><dd>{show(parsed.handle)}</dd>
  <dt>Registrar</dt><dd>{show(parsed.registrar)}</dd>
  <dt>Registrar ID</dt><dd>{show(parsed.registrarIanaId)}</dd>
  <dt>DNSSEC</dt><dd>{show(parsed.dnssec)}</dd>
  <dt>DS records</dt><dd>{dsText() || '—'}{parsed.dsDataTruncated ? ' (capped)' : ''}</dd>
  <dt>Status</dt><dd>{show(parsed.statuses)}{parsed.statusesTruncated ? ' (capped)' : ''}</dd>
  <dt>Nameservers</dt><dd>{show(parsed.nameservers)}{parsed.nameserversTruncated ? ' (capped)' : ''}</dd>
  <dt>Glue addresses</dt><dd>{glueText() || '—'}{parsed.nameserverAddressesTruncated ? ' (capped)' : ''}</dd>
  <dt>IDN variants</dt><dd>{variantText() || '—'}{parsed.variantsTruncated ? ' (capped)' : ''}</dd>
  <dt>Object class</dt><dd>{show(parsed.objectClassName)}</dd>
  <dt>Language</dt><dd>{show(parsed.language)}</dd>
  <dt>Conformance</dt><dd>{show(parsed.conformance)}{parsed.conformanceTruncated ? ' (capped)' : ''}</dd>
  <dt>Lifecycle events</dt><dd>{Array.isArray(parsed.events) ? parsed.events.length : 0}{parsed.eventsTruncated ? ' (capped)' : ''}</dd>
  <dt>RDAP database updated</dt><dd><time datetime={dateTimeAttribute(parsed.lifecycle?.databaseUpdatedDate)}>{formatDate(parsed.lifecycle?.databaseUpdatedDate)}</time></dd>
  <dt>Port 43</dt><dd>{show(parsed.port43)}</dd>
  <dt>Parent handle</dt><dd>{show(parsed.parentHandle)}</dd>
  <dt>Redactions</dt><dd>{redactionText() || '—'}{parsed.redactionsTruncated ? ' (capped)' : ''}</dd>
  <dt>Links</dt><dd>{linkText() || '—'}{parsed.linksTruncated ? ' (capped)' : ''}</dd>
  <dt>Notices</dt><dd>{textBlocks(parsed.notices) || '—'}{parsed.noticesTruncated ? ' (capped)' : ''}</dd>
  <dt>Remarks</dt><dd>{textBlocks(parsed.remarks) || '—'}{parsed.remarksTruncated ? ' (capped)' : ''}</dd>
</dl>

{#if populatedRoles.length}
  <details class="contact-inventory">
    <summary>Published contacts · {populatedRoles.length} role{populatedRoles.length === 1 ? '' : 's'}{parsed.entitiesTruncated ? ' · capped' : ''}</summary>
    <div>
      {#if parsed.entitiesTruncated}<p>{source} contact data exceeded local display limits. Review the raw response for the complete upstream payload.</p>{/if}
      {#each populatedRoles as role}
        <section>
          <h4>{role}{parsed.truncatedEntityRoles?.includes(role) ? ' · capped' : ''}</h4>
          {#each parsed.entitiesByRole[role] as contact}
            <article>
              <strong>{contactIdentity(contact)}{contact.truncated ? ' · capped' : ''}</strong>
              {#each contactDetails(contact) as detail}<span>{detail}</span>{/each}
            </article>
          {/each}
        </section>
      {/each}
    </div>
  </details>
{/if}

<style>
  dl{display:grid;grid-template-columns:95px minmax(0,1fr);gap:9px;margin:0;padding:0 16px 16px;font-size:.7rem}dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .server-partial{margin:0 16px 14px;padding:10px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--muted);font-size:.65rem;overflow-wrap:anywhere}.server-partial strong{color:#f2b84b}
  .contact-inventory{margin:0 16px 16px;border:1px solid var(--border);border-radius:9px}.contact-inventory>summary{padding:11px;font-size:.68rem}.contact-inventory>div{display:grid;gap:9px;padding:0 11px 11px}.contact-inventory>div>p{margin:0;padding:8px;border-left:3px solid #f2b84b;background:rgba(242,184,75,.04);color:var(--muted);font-size:.62rem}.contact-inventory section{min-width:0}.contact-inventory h4{margin:0 0 5px;color:var(--muted);font-size:.62rem;text-transform:uppercase}.contact-inventory article{padding:8px;border:1px solid var(--border);border-radius:7px;background:var(--panel)}.contact-inventory strong,.contact-inventory span{display:block;overflow-wrap:anywhere}.contact-inventory span{margin-top:4px;color:var(--muted);font-size:.62rem}
  @media(max-width:520px){dl{grid-template-columns:1fr;gap:4px}dt:not(:first-child){margin-top:7px}}
</style>
