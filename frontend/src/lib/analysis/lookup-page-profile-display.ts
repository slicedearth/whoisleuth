import {
  boundedCredentialCount,
  boundedPostureCount,
  boundedTechnologyText,
  rec,
  records,
  statusLabel,
  stringList,
  type JsonRecord,
} from './lookup-display-shared.ts';
import { MAX_SECURITY_POSTURE_FINDINGS } from '../../../../lib/website-security-posture.mts';
import { technologyEvidenceRoles } from '../../../../lib/technology-evidence-role.mts';

const SECURITY_POSTURE_STATES = new Set([
  'observed',
  'potential_exposure',
  'observed_absence',
  'unavailable',
]);
const SECURITY_POSTURE_TONES = new Set(['configured', 'review', 'neutral']);

export function buildLookupPageProfileDisplay(input: {
  credentialSurfaceProfile: JsonRecord;
  structuredDataIdentity: JsonRecord;
  technologyProfile: JsonRecord;
  browserLibraryProfile: JsonRecord;
  pageRoleProfile: JsonRecord;
  clientBehaviorProfile: JsonRecord;
}) {
  const {
    credentialSurfaceProfile,
    structuredDataIdentity,
    technologyProfile,
    browserLibraryProfile,
    pageRoleProfile,
    clientBehaviorProfile,
  } = input;
  const credentialSurfaceForms = rec(credentialSurfaceProfile.forms);
  const clientScriptSummary = rec(clientBehaviorProfile.scriptSummary);
  const credentialSurfaceMethods = rec(credentialSurfaceForms.methods);
  const credentialSurfaceActions = rec(credentialSurfaceForms.actions);
  const credentialSurfaceInputs = rec(credentialSurfaceProfile.inputs);
  const credentialSurfaceCategories = rec(credentialSurfaceInputs.categories);
  const technologyFindings = records(technologyProfile.findings)
    .slice(0, 24)
    .map((finding) => {
      const category = boundedTechnologyText(finding.category || 'technology', 80);
      const evidence = records(finding.evidence)
        .slice(0, 4)
        .map((item) => ({
          source: statusLabel(boundedTechnologyText(item.source || 'evidence', 80)),
          role: boundedTechnologyText(item.role, 40),
          description: boundedTechnologyText(
            item.description || 'Observed signature matched.',
            300,
          ),
        }));
      const declaredRoles = stringList(finding.roles)
        .map((role) => boundedTechnologyText(role, 40));
      return {
        id: boundedTechnologyText(finding.id, 80),
        name: boundedTechnologyText(finding.name || 'Unknown indicator', 120),
        category: statusLabel(category),
        confidence: boundedTechnologyText(finding.confidence || 'unknown', 20),
        roles: technologyEvidenceRoles({ category, roles: declaredRoles, evidence }),
        evidence,
      };
    });
  const pageRoles = records(pageRoleProfile.findings)
    .slice(0, 4)
    .map((finding) => ({
      role: boundedTechnologyText(finding.role, 40),
      label: boundedTechnologyText(finding.label || 'Unclassified', 80),
      confidence: statusLabel(boundedTechnologyText(finding.confidence || 'low', 20)),
      evidence: stringList(finding.evidence)
        .slice(0, 4)
        .map((item) => boundedTechnologyText(item, 180))
        .filter(Boolean),
    }));

  return {
    credentialSurface: {
      formCount: boundedCredentialCount(credentialSurfaceForms.count, 50),
      inputCount: boundedCredentialCount(credentialSurfaceInputs.count),
      classifiedCount: boundedCredentialCount(credentialSurfaceInputs.classifiedCount),
      categories: {
        'password': boundedCredentialCount(credentialSurfaceCategories.password),
        email: boundedCredentialCount(credentialSurfaceCategories.email),
        username: boundedCredentialCount(credentialSurfaceCategories.username),
        oneTimeCode: boundedCredentialCount(credentialSurfaceCategories.one_time_code),
        payment: boundedCredentialCount(credentialSurfaceCategories.payment),
      },
      methods: {
        missing: boundedCredentialCount(credentialSurfaceMethods.missing, 50),
        get: boundedCredentialCount(credentialSurfaceMethods.get, 50),
        post: boundedCredentialCount(credentialSurfaceMethods.post, 50),
        dialog: boundedCredentialCount(credentialSurfaceMethods.dialog, 50),
        other: boundedCredentialCount(credentialSurfaceMethods.other, 50),
      },
      actions: {
        sameOrigin: boundedCredentialCount(credentialSurfaceActions.sameOrigin, 50),
        external: boundedCredentialCount(credentialSurfaceActions.external, 50),
        missing: boundedCredentialCount(credentialSurfaceActions.missing, 50),
        cleartext: boundedCredentialCount(credentialSurfaceActions.cleartext, 50),
        unclassified: boundedCredentialCount(credentialSurfaceActions.unclassified, 50),
      },
    },
    credentialSurfaceLimitations: stringList(credentialSurfaceProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    structuredIdentities: records(structuredDataIdentity.entities)
      .slice(0, 16)
      .map((entity) => ({
        types: stringList(entity.types)
          .slice(0, 8)
          .map((item) => boundedTechnologyText(item, 80))
          .filter(Boolean)
          .join(', '),
        name: boundedTechnologyText(entity.name, 160),
        declaredOrigin: boundedTechnologyText(entity.declaredOrigin, 2048),
        sameAsHosts: stringList(entity.sameAsHosts)
          .slice(0, 12)
          .map((item) => boundedTechnologyText(item, 253))
          .filter(Boolean)
          .join(', '),
      })),
    structuredIdentityLimitations: stringList(structuredDataIdentity.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    technologyFindings,
    technologyLimitations: stringList(technologyProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    pageRoles,
    primaryPageRole: pageRoles.find((role) => role.role === pageRoleProfile.primaryRole)?.label
      || pageRoles[0]?.label
      || 'Unclassified',
    pageRoleLimitations: stringList(pageRoleProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    clientScriptSummary: {
      elementsObserved: boundedCredentialCount(clientScriptSummary.elementsObserved),
      referencedScripts: boundedCredentialCount(clientScriptSummary.referencedScripts),
      inlineScripts: boundedCredentialCount(clientScriptSummary.inlineScripts),
      moduleScripts: boundedCredentialCount(clientScriptSummary.moduleScripts),
    },
    clientBehaviorIndicators: records(clientBehaviorProfile.indicators)
      .slice(0, 12)
      .map((indicator) => ({
        id: boundedTechnologyText(indicator.id, 80),
        label: boundedTechnologyText(indicator.label || 'Static indicator', 120),
        evidenceClass: statusLabel(boundedTechnologyText(indicator.evidenceClass || 'static evidence', 40)),
        occurrences: boundedCredentialCount(indicator.occurrences, 999),
        explanation: boundedTechnologyText(indicator.explanation || 'Static indicator observed.', 240),
      })),
    clientBehaviorLimitations: stringList(clientBehaviorProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
    browserLibraries: records(browserLibraryProfile.findings)
      .slice(0, 16)
      .map((finding) => ({
        id: boundedTechnologyText(finding.id, 80),
        name: statusLabel(boundedTechnologyText(finding.name || 'unknown library', 80)),
        version: boundedTechnologyText(finding.apparentVersion || 'unknown', 64),
        detection: stringList(finding.detectionMethods).slice(0, 4).map(statusLabel).join(', '),
        advisoryCount: Math.max(0, Math.min(128, Number(finding.advisoryCount) || 0)),
        severity: boundedTechnologyText(finding.highestSeverity, 16),
        identifiers: stringList(finding.advisoryIdentifiers).slice(0, 16).join(', '),
        knownExploitedIdentifiers: stringList(finding.knownExploitedIdentifiers).slice(0, 16).join(', '),
        knownExploitedCount: Math.max(0, Math.min(16, Number(finding.knownExploitedCount) || 0)),
        weaknesses: stringList(finding.weaknessClasses).slice(0, 12).join(', '),
      })),
    browserLibraryLimitations: stringList(browserLibraryProfile.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
  };
}

export function buildLookupSecurityPostureDisplay(input: {
  securityPosture: JsonRecord;
  securityPostureSummary: JsonRecord;
}) {
  const { securityPosture, securityPostureSummary } = input;
  return {
    securityPostureSummary: {
      observed: boundedPostureCount(securityPostureSummary.observed),
      potentialExposure: boundedPostureCount(securityPostureSummary.potentialExposure),
      observedAbsence: boundedPostureCount(securityPostureSummary.observedAbsence),
      unavailable: boundedPostureCount(securityPostureSummary.unavailable),
    },
    securityPostureFindings: records(
      securityPosture.findings,
      MAX_SECURITY_POSTURE_FINDINGS,
    ).map((finding) => ({
      id: boundedTechnologyText(finding.id, 80),
      category: statusLabel(boundedTechnologyText(finding.category || 'posture', 80)),
      state: SECURITY_POSTURE_STATES.has(boundedTechnologyText(finding.state, 40))
        ? boundedTechnologyText(finding.state, 40)
        : 'unavailable',
      tone: SECURITY_POSTURE_TONES.has(boundedTechnologyText(finding.tone, 40))
        ? boundedTechnologyText(finding.tone, 40)
        : 'neutral',
      label: boundedTechnologyText(finding.label || 'Posture finding', 160),
      detail: boundedTechnologyText(
        finding.detail || 'No additional detail is available.',
        300,
      ),
      evidence: stringList(finding.evidence)
        .slice(0, 4)
        .map((item) => boundedTechnologyText(item, 120))
        .filter(Boolean),
    })),
    securityPostureLimitations: stringList(securityPosture.limitations)
      .slice(0, 10)
      .map((item) => boundedTechnologyText(item, 300))
      .filter(Boolean),
  };
}
