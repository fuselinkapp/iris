export type DnsRecord = {
  type: 'MX' | 'TXT';
  host: '@';
  value: string;
  priority?: number;
  note: string;
};

export const CLOUDFLARE_EMAIL_ROUTING_RECORDS: ReadonlyArray<DnsRecord> = [
  {
    type: 'MX',
    host: '@',
    value: 'route1.mx.cloudflare.net',
    priority: 1,
    note: 'Primary inbound mail server.',
  },
  {
    type: 'MX',
    host: '@',
    value: 'route2.mx.cloudflare.net',
    priority: 2,
    note: 'Backup inbound mail server.',
  },
  {
    type: 'TXT',
    host: '@',
    value: 'v=spf1 include:_spf.mx.cloudflare.net ~all',
    note: 'SPF record. Tells other servers Cloudflare may send on your behalf.',
  },
];
