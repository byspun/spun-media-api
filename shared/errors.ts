/**
 * Spün Media API — Unified Error Registry
 * 
 * This file is the single source of truth for all error states across the 
 * Spün ecosystem (Gateway and Providers). It follows the "Black Box" principle:
 * no internal infrastructure or third-party providers are ever exposed.
 */

export type SpunErrorCode = 
  | 'INVALID_ID'
  | 'ROUTE_NOT_FOUND'
  | 'MISSING_QUERY'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SERVICE_OFFLINE'
  | 'CONTENT_UNAVAILABLE'
  | 'REGION_RESTRICTED'
  | 'SECURE_LINK_ERROR'
  | 'GATEWAY_TIMEOUT'
  | 'RATE_LIMIT'
  | 'MAINTENANCE'
  | 'METHOD_NOT_ALLOWED'
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
  ROUTE_NOT_FOUND: {
    error:      'Endpoint not found',
    why:        'The requested API endpoint does not exist.',
    what_to_do: 'Check the API documentation for the correct endpoint path.'
  },
  MISSING_QUERY: {
    error:      'Search query required',
    why:        'No search term was provided in the request.',
    what_to_do: 'Please provide a valid search term with at least 2 characters.'
  },
  BAD_REQUEST: {
    error:      'Malformed request',
    why:        'The request contains invalid parameters or is missing required fields.',
    what_to_do: 'Review the request parameters and try again.'
  },
  UNAUTHORIZED: {
    error:      'Authentication required',
    why:        'This request requires authentication or the provided API key is invalid.',
    what_to_do: 'Ensure you are sending a valid Authorization header with your request.'
  },
  FORBIDDEN: {
    error:      'Permission denied',
    why:        'You do not have permission to access this specific resource.',
    what_to_do: 'Upgrade your plan or contact support if you believe this is an error.'
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
  GATEWAY_TIMEOUT: {
    error:      'Request timed out',
    why:        'The Spün infrastructure took too long to process the request.',
    what_to_do: 'This usually happens with heavy searches. Please try again in a moment.'
  },
  RATE_LIMIT: {
    error:      'Too many requests',
    why:        'You have exceeded the allowed number of requests in a short period.',
    what_to_do: 'Please wait a few seconds before making another request.'
  },
  MAINTENANCE: {
    error:      'Scheduled maintenance',
    why:        'The API is currently undergoing scheduled maintenance.',
    what_to_do: "We'll be back shortly. Check our status page for updates."
  },
  METHOD_NOT_ALLOWED: {
    error:      'Method not allowed',
    why:        'You tried to use an invalid HTTP method for this endpoint.',
    what_to_do: 'Check the API documentation for the supported HTTP methods.'
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
