const MAX_CT_QUERY_LENGTH = 200;
const CT_QUERY_ERROR_CODE = 'INVALID_CT_QUERY';
const CT_QUERY_ERROR_MESSAGE = `Certificate Transparency query must be at most ${MAX_CT_QUERY_LENGTH} characters and contain no control or invisible formatting characters.`;
const UNSAFE_QUERY_CHARACTER_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;

class CtQueryError extends Error {
  code = CT_QUERY_ERROR_CODE;

  constructor() {
    super(CT_QUERY_ERROR_MESSAGE);
    this.name = 'CtQueryError';
  }
}

function normalizeCtQuery(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string'
    || value.length > MAX_CT_QUERY_LENGTH
    || UNSAFE_QUERY_CHARACTER_RE.test(value)) {
    throw new CtQueryError();
  }
  return value.trim();
}

function isCtQueryError(value: unknown): value is CtQueryError {
  return value instanceof Error
    && 'code' in value
    && value.code === CT_QUERY_ERROR_CODE;
}

export {
  CT_QUERY_ERROR_CODE,
  CT_QUERY_ERROR_MESSAGE,
  CtQueryError,
  isCtQueryError,
  MAX_CT_QUERY_LENGTH,
  normalizeCtQuery,
};
