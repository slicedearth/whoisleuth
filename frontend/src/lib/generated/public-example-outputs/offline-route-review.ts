// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE = {
  "id": "offline-route-review",
  "direction": "output",
  "title": "Offline route-origin review",
  "format": "terminal",
  "command": "whoisleuth review-evidence synthetic-route.json",
  "summary": "An offline comparison against an empty analyst-supplied reserved-address authorisation set.",
  "synthetic": true,
  "notice": "Synthetic reserved-domain example. It is not a live finding and no request was made.",
  "content": "Synthetic reserved-domain example. It is not a live finding and no request was made.\n\nOffline evidence review\nKind   rpki\nState  not found\nRejected0\nMatches0\n\nLimitations:\n  - The review is local and uses only the supplied document. It does not refresh, transmit, or independently establish the current completeness of the evidence.\n  - This offline review evaluates an explicitly supplied route prefix and origin ASN against an analyst-supplied VRP snapshot.\n  - It does not collect BGP announcements, establish route ownership, or prove that the snapshot was current or complete.\n  - AS0 authorisations do not authorise an announcement. An AS0 route origin is invalid input; snapshot validation and signature verification remain external to this review.\n",
  "large": false,
  "downloadName": "synthetic-offline-route-review.txt",
  "mediaType": "text/plain"
} as const;
