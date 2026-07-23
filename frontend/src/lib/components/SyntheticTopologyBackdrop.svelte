<div class="topology-backdrop" aria-hidden="true">
  <svg viewBox="0 0 760 430" preserveAspectRatio="xMidYMid slice">
    <g class="paths">
      <path d="M82 86 C170 86 170 162 266 162 S370 94 458 94 S578 150 680 150" />
      <path d="M42 304 C148 304 168 232 258 232 S378 324 470 324 S566 244 724 244" />
      <path d="M176 40 C176 126 250 120 250 208 S326 300 326 390" />
      <path d="M530 36 C530 118 476 148 476 212 S552 282 552 398" />
    </g>
    <g class="nodes">
      <rect x="62" y="68" width="40" height="36" rx="4" />
      <polygon points="246,142 278,142 290,162 278,182 246,182 234,162" />
      <rect x="438" y="74" width="40" height="40" rx="13" />
      <circle cx="680" cy="150" r="20" />
      <polygon points="22,286 62,286 72,304 62,322 22,322 12,304" />
      <rect x="238" y="212" width="40" height="40" rx="4" />
      <circle cx="470" cy="324" r="20" />
      <rect x="704" y="224" width="40" height="40" rx="13" />
      <circle cx="176" cy="40" r="9" />
      <circle cx="326" cy="390" r="9" />
      <circle cx="530" cy="36" r="9" />
      <circle cx="552" cy="398" r="9" />
    </g>
  </svg>
</div>

<style>
  .topology-backdrop{position:absolute;inset:-30px -6vw -20px;z-index:0;overflow:hidden;pointer-events:none;opacity:.22;mask-image:radial-gradient(ellipse 78% 74% at 58% 47%,#000 0 46%,transparent 78%)}
  svg{display:block;width:100%;height:100%}
  .paths{fill:none;stroke:color-mix(in srgb,var(--accent) 38%,var(--border));stroke-width:1.1;stroke-dasharray:4 8}
  .nodes{fill:color-mix(in srgb,var(--panel) 78%,transparent);stroke:color-mix(in srgb,var(--accent2) 52%,var(--border));stroke-width:1.2}
  .nodes :nth-child(3n){stroke:color-mix(in srgb,var(--amber) 52%,var(--border))}
  .nodes :nth-child(4n){stroke:color-mix(in srgb,var(--violet) 52%,var(--border));stroke-dasharray:3 2}
  @media(max-width:680px){.topology-backdrop{inset:30px -70vw 30%;opacity:.16;mask-image:linear-gradient(to bottom,#000,transparent)}}
</style>
