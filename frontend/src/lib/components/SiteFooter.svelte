<script lang="ts">
  let { console = false }: { console?: boolean } = $props();
</script>

<footer class="site-footer public-footer" class:console>
  <p>WHOISleuth keeps registration and supporting evidence separate, so missing or inconclusive data is not presented as proof.</p>
  <div class="footer-meta">
    <p>© 2026 Created by <a href="https://github.com/slicedearth" target="_blank" rel="noopener">slicedearth</a></p>
    <nav class="footer-links" aria-label="Footer">
      <a href="https://github.com/slicedearth/whoisleuth" target="_blank" rel="noopener">Source and licence</a>
      <a href="/resources">Learn</a>
      <a href="/guide">Guide</a>
      <a href="/privacy">Privacy</a>
    </nav>
  </div>
</footer>

<style>
  footer{display:flex;justify-content:space-between;gap:30px;padding:22px 0 30px;border-top:1px solid var(--border);color:var(--muted);font:var(--text-2xs) var(--mono);line-height:1.6}
  footer.console{margin-top:54px}
  p{max-width:72ch;margin:0}
  .footer-meta{display:grid;flex:none;gap:8px;text-align:right}
  .footer-links{display:flex;justify-content:flex-end;gap:14px;margin:0}
  .footer-links a{display:inline-flex;align-items:center;min-height:32px;margin:0;padding:4px 0}
  a{color:var(--accent)}
  .footer-meta>p a{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
  a:hover{color:var(--text)}
  @media(max-width:720px){
    footer{align-items:flex-start;flex-direction:column;gap:18px;padding:20px 0 24px}
    .footer-meta{width:100%;gap:10px;text-align:left}
    .footer-links{width:100%;justify-content:flex-start;flex-wrap:wrap;gap:8px 16px}
  }
</style>
