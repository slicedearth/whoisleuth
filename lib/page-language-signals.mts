// Reviewed, bounded language packs for static homepage text already retained by
// Deep Lookup. Matching emits fixed labels only: no page phrase, surrounding
// text, or arbitrary markup is returned or stored.

type PageLanguageSignalCategory =
  | 'account_verification'
  | 'account_restriction'
  | 'payment_update'
  | 'recovery_secret'
  | 'urgent_action';

type PageLanguageSignal = Readonly<{
  version: typeof PAGE_LANGUAGE_SIGNAL_VERSION;
  packId: string;
  language: string;
  category: PageLanguageSignalCategory;
  label: string;
}>;

type PageLanguagePack = Readonly<{
  id: string;
  language: string;
  label: string;
  patterns: readonly Readonly<{ category: PageLanguageSignalCategory; expression: RegExp }>[];
}>;

export const PAGE_LANGUAGE_SIGNAL_VERSION = 1;
export const MAX_PAGE_LANGUAGE_SIGNAL_CHARS = 300_000;

const CONTROL_CHARACTER_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const CATEGORY_LABELS: Readonly<Record<PageLanguageSignalCategory, string>> = Object.freeze({
  account_verification: 'account-verification',
  account_restriction: 'account-restriction',
  payment_update: 'payment-update',
  recovery_secret: 'wallet or recovery-secret',
  urgent_action: 'urgent-action',
});

const PAGE_LANGUAGE_PACKS: readonly PageLanguagePack[] = Object.freeze([
  {
    id: 'en-reviewed-v1', language: 'en', label: 'English', patterns: [
      { category: 'account_verification', expression: /(?:verify your account|confirm your identity|unusual (?:sign-?in|login) activity|click here to (?:verify|confirm|update|restore)|confirm your password)/iu },
      { category: 'account_restriction', expression: /(?:account has been (?:suspended|limited|locked|restricted)|your account will be (?:suspended|closed|locked|terminated)|re-?activate your account|unauthorized access detected|your password (?:has expired|will expire soon))/iu },
      { category: 'urgent_action', expression: /(?:security alert|immediate action required)/iu },
      { category: 'payment_update', expression: /update your (?:payment|billing) (?:information|details)/iu },
      { category: 'recovery_secret', expression: /(?:(?:connect|verify) your wallet|(?:enter|verify) your (?:seed|recovery) phrase|enter your private key)/iu },
    ],
  },
  {
    id: 'es-reviewed-v1', language: 'es', label: 'Spanish', patterns: [
      { category: 'account_verification', expression: /(?:verifica (?:tu|su) cuenta|confirma (?:tu|su) identidad)/iu },
      { category: 'account_restriction', expression: /(?:tu|su) cuenta (?:ha sido|será) (?:suspendida|bloqueada|limitada|restringida)/iu },
      { category: 'urgent_action', expression: /(?:acción inmediata requerida|alerta de seguridad)/iu },
      { category: 'payment_update', expression: /actualiza (?:tu|su) (?:información|datos) de pago/iu },
      { category: 'recovery_secret', expression: /(?:introduce|ingrese) (?:tu|su) frase de recuperación/iu },
    ],
  },
  {
    id: 'fr-reviewed-v1', language: 'fr', label: 'French', patterns: [
      { category: 'account_verification', expression: /(?:vérifiez votre compte|confirmez votre identité|veuillez confirmer votre identité)/iu },
      { category: 'account_restriction', expression: /votre compte (?:a été|sera) (?:suspendu|bloqué|limité|restreint)/iu },
      { category: 'urgent_action', expression: /(?:action immédiate requise|alerte de sécurité)/iu },
      { category: 'payment_update', expression: /mettez à jour vos (?:informations|coordonnées) de paiement/iu },
      { category: 'recovery_secret', expression: /saisissez votre phrase de récupération/iu },
    ],
  },
  {
    id: 'de-reviewed-v1', language: 'de', label: 'German', patterns: [
      { category: 'account_verification', expression: /(?:bestätigen sie ihr konto|bestätigen sie ihre identität)/iu },
      { category: 'account_restriction', expression: /ihr konto wurde (?:gesperrt|eingeschränkt|suspendiert)/iu },
      { category: 'urgent_action', expression: /(?:sofortiges handeln erforderlich|sicherheitswarnung)/iu },
      { category: 'payment_update', expression: /aktualisieren sie ihre zahlungsdaten/iu },
      { category: 'recovery_secret', expression: /geben sie ihre wiederherstellungsphrase ein/iu },
    ],
  },
  {
    id: 'pt-reviewed-v1', language: 'pt', label: 'Portuguese', patterns: [
      { category: 'account_verification', expression: /(?:verifique sua conta|confirme sua identidade)/iu },
      { category: 'account_restriction', expression: /sua conta (?:foi|será) (?:suspensa|bloqueada|limitada|restrita)/iu },
      { category: 'urgent_action', expression: /(?:ação imediata necessária|alerta de segurança)/iu },
      { category: 'payment_update', expression: /atualize suas informações de pagamento/iu },
      { category: 'recovery_secret', expression: /insira sua frase de recuperação/iu },
    ],
  },
  {
    id: 'it-reviewed-v1', language: 'it', label: 'Italian', patterns: [
      { category: 'account_verification', expression: /(?:verifica il tuo account|conferma la tua identità)/iu },
      { category: 'account_restriction', expression: /il tuo account (?:è stato|sarà) (?:sospeso|bloccato|limitato)/iu },
      { category: 'urgent_action', expression: /(?:azione immediata richiesta|avviso di sicurezza)/iu },
      { category: 'payment_update', expression: /aggiorna (?:i tuoi dati|le tue informazioni) di pagamento/iu },
      { category: 'recovery_secret', expression: /inserisci la (?:tua )?frase di recupero/iu },
    ],
  },
  {
    id: 'nl-reviewed-v1', language: 'nl', label: 'Dutch', patterns: [
      { category: 'account_verification', expression: /(?:verifieer uw account|bevestig uw identiteit)/iu },
      { category: 'account_restriction', expression: /uw account (?:is|wordt) (?:geblokkeerd|beperkt|opgeschort)/iu },
      { category: 'urgent_action', expression: /(?:onmiddellijke actie vereist|beveiligingswaarschuwing)/iu },
      { category: 'payment_update', expression: /werk uw betalingsgegevens bij/iu },
      { category: 'recovery_secret', expression: /voer uw herstelzin in/iu },
    ],
  },
]);

function preferredPacks(documentLanguage: unknown): readonly PageLanguagePack[] {
  if (typeof documentLanguage !== 'string') return PAGE_LANGUAGE_PACKS;
  const primary = documentLanguage.trim().toLowerCase().split('-', 1)[0];
  if (!primary) return PAGE_LANGUAGE_PACKS;
  const declared = PAGE_LANGUAGE_PACKS.filter((pack) => pack.language === primary);
  return declared.length
    ? Object.freeze([...declared, ...PAGE_LANGUAGE_PACKS.filter((pack) => pack.language !== primary)])
    : PAGE_LANGUAGE_PACKS;
}

export function detectPageLanguageSignal(
  input: unknown,
  documentLanguage?: unknown,
): PageLanguageSignal | null {
  if (typeof input !== 'string' || !input || input.length > MAX_PAGE_LANGUAGE_SIGNAL_CHARS || CONTROL_CHARACTER_RE.test(input)) {
    return null;
  }
  for (const pack of preferredPacks(documentLanguage)) {
    for (const pattern of pack.patterns) {
      if (!pattern.expression.test(input)) continue;
      return Object.freeze({
        version: PAGE_LANGUAGE_SIGNAL_VERSION,
        packId: pack.id,
        language: pack.language,
        category: pattern.category,
        label: `Reviewed ${pack.label} ${CATEGORY_LABELS[pattern.category]} language`,
      });
    }
  }
  return null;
}

export function pageLanguagePackCatalogue(): readonly Readonly<{
  id: string;
  language: string;
  categories: readonly PageLanguageSignalCategory[];
}>[] {
  return Object.freeze(PAGE_LANGUAGE_PACKS.map((pack) => Object.freeze({
    id: pack.id,
    language: pack.language,
    categories: Object.freeze([...new Set(pack.patterns.map((pattern) => pattern.category))]),
  })));
}

export type { PageLanguageSignal, PageLanguageSignalCategory };
