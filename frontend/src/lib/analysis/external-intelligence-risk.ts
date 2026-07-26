// Browser-facing compatibility module. The canonical implementation lives in
// the shared runtime so the web UI and offline CLI cannot drift.
export {
  EXTERNAL_INTELLIGENCE_CALIBRATION_VERSION,
  EXTERNAL_INTELLIGENCE_RECENT_DAYS,
  calibrateExternalIntelligenceRisk,
} from '../../../../lib/external-intelligence-risk.mts';
