const ALIGNING_CLASS = 'lookup-scroll-aligning';
const CANCEL_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;
const ALIGNMENT_TOLERANCE_PX = 0.75;
const STABLE_FRAME_COUNT = 2;
const SAFE_HASH = /^#[A-Za-z][A-Za-z0-9:_-]{0,127}$/u;

type AlignmentPhase = 'idle' | 'aligning' | 'released';

type Geometry = Readonly<{
  target: HTMLElement;
  targetDocumentTop: number;
  scrollMarginTop: number;
  documentHeight: number;
}>;

function targetId(href: string): string | null {
  return SAFE_HASH.test(href) ? href.slice(1) : null;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= ALIGNMENT_TOLERANCE_PX;
}

function sameGeometry(left: Geometry | null, right: Geometry): boolean {
  return left !== null
    && left.target === right.target
    && closeEnough(left.targetDocumentTop, right.targetDocumentTop)
    && closeEnough(left.scrollMarginTop, right.scrollMarginTop)
    && closeEnough(left.documentHeight, right.documentHeight);
}

export class LookupAnchorController {
  #href = '';
  #fallbackHref = '';
  #root: HTMLElement | null = null;
  #phase: AlignmentPhase = 'idle';
  #frame = 0;
  #stableFrames = 0;
  #lastGeometry: Geometry | null = null;
  #forceAlignment = false;
  #smoothInFlight = false;
  #resizeObserver: ResizeObserver | null = null;
  #mutationObserver: MutationObserver | null = null;

  #cancel = (): void => {
    this.stop();
  };

  #scrollEnded = (): void => {
    if (this.#phase === 'idle') return;
    this.#smoothInFlight = false;
    this.#forceAlignment = true;
    this.#schedule();
  };

  begin(href: string, fallbackHref = ''): boolean {
    this.stop();
    if (!targetId(href) || (fallbackHref && !targetId(fallbackHref))) return false;
    const root = document.getElementById('result');
    if (!root) return false;

    this.#href = href;
    this.#fallbackHref = fallbackHref;
    this.#root = root;
    this.#phase = 'aligning';
    this.#forceAlignment = true;
    root.classList.add(ALIGNING_CLASS);

    this.#resizeObserver = new ResizeObserver(() => this.#invalidate());
    this.#resizeObserver.observe(root);
    this.#mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => this.#mutationAffectsGeometry(record))) this.#invalidate();
    });
    this.#mutationObserver.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-deferred-state', 'open', 'style'],
      childList: true,
      subtree: true,
    });
    for (const eventName of CANCEL_EVENTS) {
      window.addEventListener(eventName, this.#cancel, { capture: true, passive: true });
    }
    window.addEventListener('scrollend', this.#scrollEnded, { passive: true });
    this.#schedule();
    return true;
  }

  align(behavior: ScrollBehavior = this.#preferredBehavior()): boolean {
    if (!this.#current()) return false;
    const aligned = this.#scrollResolved(behavior);
    this.#smoothInFlight = aligned && behavior === 'smooth';
    this.#forceAlignment = false;
    this.#schedule();
    return aligned;
  }

  contentReady(): void {
    if (this.#phase === 'idle') return;
    this.#invalidate();
  }

  stop(): void {
    this.#resizeObserver?.disconnect();
    this.#mutationObserver?.disconnect();
    this.#resizeObserver = null;
    this.#mutationObserver = null;
    if (this.#frame && typeof window !== 'undefined') window.cancelAnimationFrame(this.#frame);
    this.#root?.classList.remove(ALIGNING_CLASS);
    if (typeof window !== 'undefined') {
      for (const eventName of CANCEL_EVENTS) {
        window.removeEventListener(eventName, this.#cancel, true);
      }
      window.removeEventListener('scrollend', this.#scrollEnded);
    }
    this.#href = '';
    this.#fallbackHref = '';
    this.#root = null;
    this.#phase = 'idle';
    this.#frame = 0;
    this.#stableFrames = 0;
    this.#lastGeometry = null;
    this.#forceAlignment = false;
    this.#smoothInFlight = false;
  }

  destroy(): void {
    this.stop();
  }

  #preferredBehavior(): ScrollBehavior {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  #current(): boolean {
    return this.#phase !== 'idle'
      && this.#root?.isConnected === true
      && window.location.hash === this.#href;
  }

  #target(exactOnly = false): HTMLElement | null {
    const requestedId = targetId(this.#href);
    const requested = requestedId ? document.getElementById(requestedId) : null;
    if (requested || exactOnly) return requested;
    const fallbackId = targetId(this.#fallbackHref);
    return fallbackId ? document.getElementById(fallbackId) : null;
  }

  #deferredContentPending(): boolean {
    return Boolean(this.#root?.querySelector('[data-deferred-state="loading"]'));
  }

  #mutationAffectsGeometry(record: MutationRecord): boolean {
    if (record.type === 'attributes' && record.attributeName === 'data-deferred-state') return true;
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    return !target?.closest('[data-deferred-state="loading"]');
  }

  #geometry(): Geometry | null {
    const target = this.#target();
    const root = this.#root;
    if (!target || !root) return null;
    const targetRect = target.getBoundingClientRect();
    return {
      target,
      targetDocumentTop: targetRect.top + window.scrollY,
      scrollMarginTop: Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0,
      documentHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
    };
  }

  #expectedScroll(geometry: Geometry): number {
    const maximumScroll = Math.max(0, geometry.documentHeight - window.innerHeight);
    return Math.min(
      Math.max(0, geometry.targetDocumentTop - geometry.scrollMarginTop),
      maximumScroll,
    );
  }

  #scrollResolved(behavior: ScrollBehavior, measured?: Geometry): boolean {
    const geometry = measured ?? this.#geometry();
    if (!geometry) return false;
    window.scrollTo({
      left: window.scrollX,
      top: this.#expectedScroll(geometry),
      behavior,
    });
    return true;
  }

  #invalidate(): void {
    if (this.#phase === 'idle') return;
    this.#stableFrames = 0;
    this.#forceAlignment = true;
    this.#smoothInFlight = false;
    this.#schedule();
  }

  #schedule(): void {
    if (this.#frame || this.#phase === 'idle') return;
    this.#frame = window.requestAnimationFrame(() => this.#measureFrame());
  }

  #measureFrame(): void {
    this.#frame = 0;
    if (!this.#current()) {
      this.stop();
      return;
    }

    const geometry = this.#geometry();
    if (!geometry) {
      if (!this.#deferredContentPending()) this.stop();
      return;
    }

    const changed = !sameGeometry(this.#lastGeometry, geometry);
    this.#stableFrames = changed ? 0 : this.#stableFrames + 1;
    const expectedScroll = this.#expectedScroll(geometry);
    const shouldRealign = this.#forceAlignment
      || (changed && this.#lastGeometry !== null)
      || (!this.#smoothInFlight && this.#stableFrames >= STABLE_FRAME_COUNT
        && !closeEnough(window.scrollY, expectedScroll));
    this.#lastGeometry = geometry;
    this.#forceAlignment = false;
    if (shouldRealign) {
      this.#smoothInFlight = false;
      this.#scrollResolved('auto', geometry);
      this.#stableFrames = 0;
    }

    const loading = this.#deferredContentPending();
    const exactTargetReady = this.#target(true) !== null;
    const aligned = closeEnough(window.scrollY, expectedScroll);
    if (
      !loading
      && (exactTargetReady || Boolean(this.#fallbackHref))
      && this.#stableFrames >= STABLE_FRAME_COUNT
      && aligned
    ) {
      if (this.#phase === 'aligning') {
        this.#phase = 'released';
        this.#stableFrames = 0;
        this.#lastGeometry = null;
        this.#forceAlignment = true;
        this.#root?.classList.remove(ALIGNING_CLASS);
        this.#schedule();
      } else {
        this.stop();
      }
      return;
    }

    if (!loading || this.#stableFrames < STABLE_FRAME_COUNT || !aligned || this.#phase === 'released') {
      this.#schedule();
    }
  }
}
