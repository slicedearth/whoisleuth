export function infrastructureSource(id: string, version: number, values: readonly string[]): string {
  const date = String(version).replace(/^(\d{4})(\d{2})(\d{2})$/u, '$1-$2-$3');
  if (id === 'amazon-aws') return JSON.stringify({
    syncToken: '1794807425', createDate: `${date}-00-00-00`,
    prefixes: values.filter(value => !value.includes(':')).map(ip_prefix => ({ ip_prefix, service: 'AMAZON' })),
    ipv6_prefixes: values.filter(value => value.includes(':')).map(ipv6_prefix => ({ ipv6_prefix, service: 'AMAZON' })),
  });
  if (id === 'google-gcp') return JSON.stringify({
    syncToken: '1794816386426', creationTime: `${date}T00:00:00.000000`,
    prefixes: values.map(value => value.includes(':') ? { ipv6Prefix: value } : { ipv4Prefix: value }),
  });
  return JSON.stringify({ type: 'cidr', version, list: values });
}
