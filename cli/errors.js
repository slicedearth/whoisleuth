'use strict';

const MAX_CLI_ERROR_MESSAGE_LENGTH = 300;

function boundedCliErrorMessage(error, fallback = 'Unexpected command failure') {
  return String(error?.message || error || fallback)
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/[\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CLI_ERROR_MESSAGE_LENGTH) || fallback;
}

module.exports = { MAX_CLI_ERROR_MESSAGE_LENGTH, boundedCliErrorMessage };
