<script lang="ts">
  import {
    boundedTechnologyText,
    dateTimeAttribute,
    formatDate,
    records as boundedRecords,
    show,
    stringList,
  } from '$lib/analysis/lookup-display-shared.ts';

  type JsonRecord = Record<string, unknown>;

  let {
    parsed,
    source = 'Registry',
  }: {
    parsed: JsonRecord;
    source?: string;
  } = $props();

  const isRecord = (value: unknown): value is JsonRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
  const record = (value: unknown): JsonRecord => isRecord(value) ? value : {};
  const records = (value: unknown, maximum = 500): JsonRecord[] => boundedRecords(value, maximum);
  const roleOrder = ['registrar','registrant','administrative','technical','billing','abuse','noc','reseller','sponsor','proxy','notifications'];
  const entitiesByRole = $derived(record(parsed.entitiesByRole));
  const lifecycle = $derived(record(parsed.lifecycle));
  const truncatedEntityRoles = $derived(stringList(parsed.truncatedEntityRoles, 11, 80));
  const contactsForRole = (role:string):JsonRecord[] => records(entitiesByRole[role], 5);
  const populatedRoles = $derived(roleOrder.filter((role) => contactsForRole(role).length));

  function contactIdentity(contact: JsonRecord) {
    return show(contact.name || contact.org || contact.handle);
  }

  function contactDetails(contact: JsonRecord) {
    return [
      stringList(contact.organizations, 8, 300).length ? `Organisations: ${stringList(contact.organizations, 8, 300).join(', ')}` : null,
      stringList(contact.emails, 8, 320).length ? `Email: ${stringList(contact.emails, 8, 320).join(', ')}` : null,
      stringList(contact.phones, 8, 100).length ? `Phone: ${stringList(contact.phones, 8, 100).join(', ')}` : null,
      stringList(contact.addresses, 8, 1_000).length ? `Address: ${stringList(contact.addresses, 8, 1_000).join(' · ')}` : null,
      records(contact.publicIds, 20).length ? `IDs: ${records(contact.publicIds, 20).map((item) => `${boundedTechnologyText(item.type, 160)}: ${boundedTechnologyText(item.identifier, 300)}`).join(', ')}` : null,
      records(contact.links, 10).length ? `Links: ${records(contact.links, 10).map((item) => boundedTechnologyText(item.href, 2_048)).filter(Boolean).join(', ')}` : null,
    ].filter(Boolean) as string[];
  }

  function linkText() {
    return Array.isArray(parsed.links)
      ? records(parsed.links, 20).map((item) => [boundedTechnologyText(item.rel, 100), boundedTechnologyText(item.href, 2_048)].filter(Boolean).join(': ')).join(' · ')
      : '';
  }

  function glueText() {
    return Array.isArray(parsed.nameserverDetails)
      ? records(parsed.nameserverDetails, 200)
          .filter((item) => Array.isArray(item.addresses) && item.addresses.length)
          .map((item) => `${boundedTechnologyText(item.name, 253)}: ${stringList(item.addresses, 20, 80).join(', ')}`)
          .join(' · ')
      : '';
  }

  function dsText() {
    return Array.isArray(parsed.dsData)
      ? records(parsed.dsData, 50).map((item) => [item.keyTag,item.algorithm,item.digestType,item.digest]
          .map((value) => boundedTechnologyText(value, 512))
          .filter(Boolean).join(' ')).join(' · ')
      : '';
  }

  function textBlocks(value: unknown) {
    return Array.isArray(value)
      ? records(value, 12).map((item) => `${boundedTechnologyText(item.title, 160)}: ${stringList(item.descriptions, 6, 800).join(' ')}`).join(' · ')
      : '';
  }

  function redactionText() {
    return Array.isArray(parsed.redactions)
      ? records(parsed.redactions, 100).map((item) => [
          item.name,item.method,item.reason,item.prePath||item.postPath||item.replacementPath,
        ].map((value) => boundedTechnologyText(value, 500)).filter(Boolean).join(' · ')).join(' | ')
      : '';
  }

  function variantText() {
    return Array.isArray(parsed.variants)
      ? records(parsed.variants, 20).map((group) => {
          const names = Array.isArray(group.variantNames)
            ? records(group.variantNames, 50).map((name) => boundedTechnologyText(name.unicodeName || name.ldhName, 253)).filter(Boolean)
            : [];
          return [[...stringList(group.relation, 20, 100),boundedTechnologyText(group.idnTable, 300)].filter(Boolean).join(', '),names.join(', ')]
            .filter(Boolean).join(': ');
        }).filter(Boolean).join(' · ')
      : '';
  }

  function serverTruncationText() {
    return Array.isArray(parsed.serverTruncationReasons)
      ? stringList(parsed.serverTruncationReasons, 8, 160).join(' · ')
      : '';
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
  <dt>RDAP database updated</dt><dd><time datetime={dateTimeAttribute(lifecycle.databaseUpdatedDateIso || lifecycle.databaseUpdatedDate)}>{formatDate(lifecycle.databaseUpdatedDateIso || lifecycle.databaseUpdatedDate)}</time></dd>
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
          <h4>{role}{truncatedEntityRoles.includes(role) ? ' · capped' : ''}</h4>
          {#each contactsForRole(role) as contact}
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
  dl{display:grid;grid-template-columns:110px minmax(0,1fr);gap:9px;margin:0;padding:4px var(--card-pad) var(--card-pad);font-size:var(--text-xs)}dd{min-width:0;margin:0;overflow-wrap:anywhere}
  .server-partial{margin:0 var(--card-pad) 14px;padding:10px 12px;border-left:3px solid var(--amber);border-radius:0 var(--radius-sm) var(--radius-sm) 0;background:rgb(var(--amber-rgb) / .05);color:var(--muted);font-size:var(--text-xs);line-height:1.55;overflow-wrap:anywhere}.server-partial strong{color:var(--amber)}
  .contact-inventory{margin:0 var(--card-pad) var(--card-pad);border:1px solid var(--border);border-radius:var(--radius-sm)}.contact-inventory>summary{padding:10px 12px;cursor:pointer;font:700 var(--text-xs) var(--mono)}.contact-inventory>summary:hover{color:var(--accent)}.contact-inventory[open]>summary{border-bottom:1px solid var(--border)}.contact-inventory>div{display:grid;gap:9px;padding:11px 12px}.contact-inventory>div>p{margin:0;padding:8px 10px;border-left:3px solid var(--amber);background:rgb(var(--amber-rgb) / .05);color:var(--muted);font-size:var(--text-xs);line-height:1.5}.contact-inventory section{min-width:0}.contact-inventory h4{margin:0 0 5px;color:var(--muted);font:600 var(--text-2xs) var(--mono);letter-spacing:.05em;text-transform:uppercase}.contact-inventory article{padding:9px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--panel)}.contact-inventory strong,.contact-inventory span{display:block;overflow-wrap:anywhere}.contact-inventory strong{font-size:var(--text-xs)}.contact-inventory span{margin-top:4px;color:var(--muted);font-size:var(--text-xs)}
  @media(max-width:520px){dl{grid-template-columns:1fr;gap:4px}dt:not(:first-child){margin-top:7px}}
</style>
