export type PublicReferenceSection = Readonly<{
  href: string;
  label: string;
}>;

export type PublicReferenceContext = {
  currentHref: string;
  title: string;
  sections: readonly PublicReferenceSection[];
};

export const PUBLIC_REFERENCE_CONTEXT = Symbol('public-reference-context');
