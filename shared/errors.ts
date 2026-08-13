/**
 * Spün Media API — Unified Error Registry
 * 
 * This file is the single source of truth for all error states across the 
 * Spün ecosystem (Gateway and Providers). It follows the "Black Box" principle:
 * no internal infrastructure or third-party providers are ever exposed.
 */

export type SpunErrorCode = 
  | 'INVALID_ID'
  | 'MISSING_QUERY'
  | 'SERVICE_OFFLINE'
  | 'CONTENT_UNAVAILABLE'
  | 'REGION_RESTRICTED'
  | 'SECURE_LINK_ERROR'
  | 'RATE_LIMIT'
  | 'INTERNAL_ERROR';

export interface SpunErrorDetail {
  code:       SpunErrorCode;
  error:      string; // The error message
  why:        string; // Why it happened
  what_to_do: string; // What to do
}

export const ERROR_REGISTRY: Record<SpunErrorCode, Omit<SpunErrorDetail, 'code'>> = {
  INVALID_ID: {
    error:      'Content not found',
    why:        'The requested ID does not exist in the Spün library.',
    what_to_do: 'Verify the ID from a search result or try searching for the title again.'
  },
  MISSING_QUERY: {
    error:      'Search query required',
    why:        'No search term was provided in the request.',
    what_to_do: 'Please provide a valid search term with at least 2 characters.'
  },
  SERVICE_OFFLINE: {
    error:      'Service temporarily unavailable',
    why:        'A component of the Spün media infrastructure is currently unreachable.',
    what_to_do: 'This is usually temporary. Please try your request again in a few minutes.'
  },
  CONTENT_UNAVAILABLE: {
    error:      'No playable sources found',
    why:        'We searched all available infrastructure, but no active links were found for this title.',
    what_to_do: 'This content is currently offline. Our automated systems have been notified to find new sources.'
  },
  REGION_RESTRICTED: {
    error:      'Content restricted',
    why:        'This content is not available for access from your current location.',
    what_to_do: 'Access to this title is limited in your region. Try a different title or check your connection.'
  },
  SECURE_LINK_ERROR: {
    error:      'Connection error',
    why:        'We found the content but could not establish a secure handshake with the source.',
    what_to_do: 'This is a technical issue with the source. Please report this to the Spün team.'
  },
  RATE_LIMIT: {
    error:      'Too many requests',
    why:        'You have exceeded the allowed number of requests in a short period.',
    what_to_do: 'Please wait a few seconds before making another request.'
  },
  INTERNAL_ERROR: {
    error:      'Unexpected error',
    why:        'An internal error occurred while processing your request.',
    what_to_do: 'We are looking into it. Please try again later.'
  }
};

/**
 * Helper to get error details by code.
 * Falls back to INTERNAL_ERROR if the code is unrecognized.
 */
export function getError(code: string): SpunErrorDetail {
  const detail = ERROR_REGISTRY[code as SpunErrorCode] || ERROR_REGISTRY.INTERNAL_ERROR;
  return {
    code: (ERROR_REGISTRY[code as SpunErrorCode] ? code : 'INTERNAL_ERROR') as SpunErrorCode,
    ...detail
  };
}
