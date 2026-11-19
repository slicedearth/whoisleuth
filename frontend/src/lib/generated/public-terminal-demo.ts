// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_TERMINAL_DEMO = {
  "notice": "Example investigation · fictional data",
  "command": "whoisleuth view lookup.json --browse",
  "comparisonCommand": "whoisleuth diff earlier.json later.json --browse",
  "panels": [
    {
      "id": "target",
      "label": "Target",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n[1 Target]  2 Key facts  3 Registration  4 DNS  5 Mail  6 Collection\nTarget:\nQuery          example.test\nType           domain\nMode           Deep\nDNS/TLS/web    example.test\nView 1/6 · lines 1-4/4\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n[1 Target]  2 Key facts  ›\nTarget:\nQuery          example.test\nType           domain\nMode           Deep\nDNS/TLS/web    example.test\nView 1/6 · lines 1-4/4\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    },
    {
      "id": "key-facts",
      "label": "Key facts",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  [2 Key facts]  3 Registration  4 DNS  5 Mail  6 Collection\nKey facts:\nRegistrar      Example Registrar (Registry RDAP · success)\nCreated        None reported (Registry RDAP · success)\nExpires        None reported (Registry RDAP · success)\nStatuses       active (Registry RDAP · success)\nNameservers    ns1.example.test (Registry RDAP · success)\nIP addresses   192.0.2.10, 2001:db8::10 (DNS · success)\nFinal origin   Not collected (HTTP)\nHTTP status    Not collected (HTTP)\nTLS issuer     Not collected (TLS)\nTLS expiry     Not collected (TLS)\nView 2/6 · lines 1-10/10\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  [2 Key facts]  3 Registration…\nKey facts:\nRegistrar      Example Registrar\n               (Registry RDAP · success)\nCreated        None reported (Registry\n               RDAP · success)\nExpires        None reported (Registry\n               RDAP · success)\nStatuses       active (Registry RDAP ·\n               success)\nNameservers    ns1.example.test\n               (Registry RDAP · success)\nIP addresses   192.0.2.10, 2001:db8::10\n               (DNS · success)\nFinal origin   Not collected (HTTP)\nView 2/6 · lines 1-13/16\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    },
    {
      "id": "registration",
      "label": "Registration",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  2 Key facts  [3 Registration]  4 DNS  5 Mail  6 Collection\nRegistration:\nRDAP           Success\nWHOIS          Skipped\nView 3/6 · lines 1-2/2\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n‹  2 Key facts  [3 Registration]  4 DNS…\nRegistration:\nRDAP           Success\nWHOIS          Skipped\nView 3/6 · lines 1-2/2\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    },
    {
      "id": "dns",
      "label": "DNS",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  2 Key facts  3 Registration  [4 DNS]  5 Mail  6 Collection\nDNS:\nEvidence       Success\nCompleteness   Complete\nA              192.0.2.10\nAAAA           2001:db8::10\nRetained       A 1 · AAAA 1 · MX 1\nA             192.0.2.10\nAAAA          2001:db8::10\nMX            10 mail.example.test\nView 4/6 · lines 1-8/8\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n‹  3 Registration  [4 DNS]  5 Mail  ›\nDNS:\nEvidence       Success\nCompleteness   Complete\nA              192.0.2.10\nAAAA           2001:db8::10\nRetained       A 1 · AAAA 1 · MX 1\nA             192.0.2.10\nAAAA          2001:db8::10\nMX            10 mail.example.test\nView 4/6 · lines 1-8/8\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    },
    {
      "id": "mail",
      "label": "Mail",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  2 Key facts  3 Registration  4 DNS  [5 Mail]  6 Collection\nMail:\nEvidence       Success\nMail exchange  Unavailable\nSPF            Unavailable\nDMARC          Unavailable\nView 5/6 · lines 1-4/4\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n‹  4 DNS  [5 Mail]  6 Collection\nMail:\nEvidence       Success\nMail exchange  Unavailable\nSPF            Unavailable\nDMARC          Unavailable\nView 5/6 · lines 1-4/4\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    },
    {
      "id": "collection",
      "label": "Collection",
      "wide": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n1 Target  2 Key facts  3 Registration  4 DNS  5 Mail  [6 Collection]\nCollection:\nGenerated      2026-08-23T00:00:00.000Z\nOriginal plan  Not retained; original optional choices and collector starts are\n               unknown.\nView 6/6 · lines 1-3/3\n←/→ panels · ↑/↓ scroll · / search · ? help · q close\n",
      "narrow": "WHOISleuth evidence browser\nTarget  example.test\nMode    deep\n‹  5 Mail  [6 Collection]\nCollection:\nGenerated      2026-08-23T00:00:00.000Z\nOriginal plan  Not retained; original\n               optional choices and\n               collector starts are\n               unknown.\nView 6/6 · lines 1-5/5\n←/→ panels · ↑/↓ scroll · / search · ? …\n"
    }
  ]
} as const;
