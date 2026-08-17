/**
 * Spün Media API — Unified Error Registry
 * 
 * This file is the single source of truth for all error states across the 
 * Spün ecosystem (Gateway and Providers). It follows the "Black Box" principle:
 * no internal infrastructure or third-party providers are ever exposed.
 */

export type SpunErrorCode = 
  | 'INVALID_ID'
  | 'NOT_FOUND'
  | 'INVALID_TYPE'
  | 'INVALID_GENRE'
  | 'INVALID_STUDIO'
  | 'MISSING_EXTERNAL_ID'
  | 'UPSTREAM_ERROR'
  | 'ROUTE_NOT_FOUND'
  | 'MISSING_QUERY'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'SERVICE_OFFLINE'
  | 'CONTENT_UNAVAILABLE'
  | 'STREAMS_UNAVAILABLE'
  | 'DOWNLOADS_UNAVAILABLE'
  | 'EPISODE_UNAVAILABLE'
  | 'QUALITY_UNAVAILABLE'
  | 'AUDIO_UNAVAILABLE'
  | 'SOURCE_RESPONSE_INVALID'
  | 'SOURCE_TIMEOUT'
  | 'SOURCE_ACCESS_DENIED'
  | 'PROXY_TOKEN_INVALID'
  | 'PROXY_TOKEN_EXPIRED'
  | 'PROXY_UPSTREAM_UNAVAILABLE'
  | 'PROXY_FORMAT_UNSUPPORTED'
  | 'DOWNLOAD_LINK_INVALID'
  | 'MAPPING_NOT_FOUND'
  | 'MAPPING_AMBIGUOUS'
  | 'MAPPING_TYPE_MISMATCH'
  | 'REGION_RESTRICTED'
  | 'SECURE_LINK_ERROR'
  | 'GATEWAY_TIMEOUT'
  | 'RATE_LIMIT'
  | 'MAINTENANCE'
  | 'METHOD_NOT_ALLOWED'
  | 'SUBTITLE_UNAVAILABLE'
  | 'SUBTITLE_ARCHIVE_INVALID'
  | 'SUBTITLE_TRACK_NOT_FOUND'
  | 'SUBTITLE_CONVERSION_FAILED'
  | 'RESOLVE_NAMESPACE_UNSUPPORTED'
  | 'RESOLVE_IDENTIFIER_REQUIRED'
  | 'RESOLVE_IDENTIFIER_INVALID'
  | 'RESOLVE_NAMESPACE_TYPE_MISMATCH'
  | 'RESOLVE_CONTENT_NOT_FOUND'
  | 'RESOLVE_AMBIGUOUS'
  | 'RESOLVE_METADATA_UNAVAILABLE'
  | 'RESOLVE_METADATA_TIMEOUT'
  | 'RESOLVE_REGISTRATION_FAILED'
  | 'RESOLVE_CONFLICT'
  | 'RESOLVE_UNSUPPORTED_RESULT'
  | 'UNSUPPORTED_SUBJECT_TYPE'
  | 'INTERNAL_ERROR';

export interface SpunErrorDetail {
  code:        SpunErrorCode;
  error:       string; // The error message
  description: string; // Why it happened
  action:      string; // What to do
}

export const ERROR_REGISTRY: Record<SpunErrorCode, Omit<SpunErrorDetail, 'code'>> = {
  INVALID_ID: {
    error:       'Content not found',
    description: 'The requested ID does not exist in the Spün library.',
    action:      'Verify the ID from a search result or try searching for the title again.'
  },
  NOT_FOUND: {
    error:       'Resource not found',
    description: 'The requested resource does not exist in the Spün Media API.',
    action:      'Check the identifier or endpoint path and try again.'
  },
  INVALID_TYPE: {
    error:       'Invalid content type',
    description: 'The requested operation does not support the supplied content type.',
    action:      'Use one of the content types documented for this endpoint.'
  },
  INVALID_GENRE: {
    error:       'Invalid genre',
    description: 'The supplied genre is not available in the Spün catalogue for this operation.',
    action:      'Use a genre returned by the catalogue or API documentation.'
  },
  INVALID_STUDIO: {
    error:       'Invalid studio',
    description: 'The supplied studio or network is not available in the Spün catalogue.',
    action:      'Use a studio returned by the catalogue or API documentation.'
  },
  MISSING_EXTERNAL_ID: {
    error:       'External identifier unavailable',
    description: 'This catalogue entry does not have the external identifier required for the requested operation.',
    action:      'Resolve or search for the title again before retrying.'
  },
  UPSTREAM_ERROR: {
    error:       'Upstream request failed',
    description: 'A required content or metadata request could not be completed.',
    action:      'Please try again later.'
  },
  ROUTE_NOT_FOUND: {
    error:       'Endpoint not found',
    description: 'The requested API endpoint does not exist.',
    action:      'Check the API documentation for the correct endpoint path.'
  },
  MISSING_QUERY: {
    error:       'Search query required',
    description: 'No search term was provided in the request.',
    action:      'Please provide a valid search term with at least 2 characters.'
  },
  BAD_REQUEST: {
    error:       'Malformed request',
    description: 'The request contains invalid parameters or is missing required fields.',
    action:      'Review the request parameters and try again.'
  },
  UNAUTHORIZED: {
    error:       'Authentication required',
    description: 'This request requires authentication or the provided API key is invalid.',
    action:      'Ensure you are sending a valid Authorization header with your request.'
  },
  FORBIDDEN: {
    error:       'Permission denied',
    description: 'You do not have permission to access this specific resource.',
    action:      'Upgrade your plan or contact support if you believe this is an error.'
  },
  SERVICE_OFFLINE: {
    error:       'Service temporarily unavailable',
    description: 'A component of the Spün media infrastructure is currently unreachable.',
    action:      'This is usually temporary. Please try your request again in a few minutes.'
  },
  CONTENT_UNAVAILABLE: {
    error:       'No playable sources found',
    description: 'We searched all available infrastructure, but no active links were found for this title.',
    action:      'This content is currently offline. Our automated systems have been notified to find new sources.'
  },
  STREAMS_UNAVAILABLE: {
    error:       'No playable streams found',
    description: 'We searched the available streaming infrastructure, but no usable stream was found for this title.',
    action:      'Try again later or select another title.'
  },
  DOWNLOADS_UNAVAILABLE: {
    error:       'No downloads found',
    description: 'No usable download resource was found for this title or requested episode.',
    action:      'Try another quality, episode, or title.'
  },
  EPISODE_UNAVAILABLE: {
    error:       'Episode unavailable',
    description: 'The requested season and episode do not currently have a usable source.',
    action:      'Check the season and episode values or try again later.'
  },
  QUALITY_UNAVAILABLE: {
    error:       'Quality unavailable',
    description: 'The requested quality is not available for this title.',
    action:      'Choose another available quality.'
  },
  AUDIO_UNAVAILABLE: {
    error:       'Audio option unavailable',
    description: 'The requested audio or language variant is not available for this title.',
    action:      'Choose another audio option.'
  },
  SOURCE_RESPONSE_INVALID: {
    error:       'Source response invalid',
    description: 'The content source responded, but its result could not be prepared for playback.',
    action:      'Try again later or select another title.'
  },
  SOURCE_TIMEOUT: {
    error:       'Source request timed out',
    description: 'A content source took too long to respond.',
    action:      'Please try again in a moment.'
  },
  SOURCE_ACCESS_DENIED: {
    error:       'Source access unavailable',
    description: 'A content source rejected the request needed to prepare this result.',
    action:      'Try again later or select another title.'
  },
  PROXY_TOKEN_INVALID: {
    error:       'Invalid media reference',
    description: 'The media capability reference is invalid or was issued for another media type.',
    action:      'Request a fresh media URL from Spün.'
  },
  PROXY_TOKEN_EXPIRED: {
    error:       'Media reference expired',
    description: 'The media capability reference has expired.',
    action:      'Request a fresh media URL from Spün.'
  },
  PROXY_UPSTREAM_UNAVAILABLE: {
    error:       'Media source unavailable',
    description: 'The approved media source could not be reached.',
    action:      'Try again later or choose another source.'
  },
  PROXY_FORMAT_UNSUPPORTED: {
    error:       'Media format unsupported',
    description: 'The requested proxy cannot handle this media format.',
    action:      'Use the media URL returned for the supported format.'
  },
  DOWNLOAD_LINK_INVALID: {
    error:       'Download link unavailable',
    description: 'The returned download resource did not pass validation.',
    action:      'Try another quality or request the downloads again.'
  },
  MAPPING_NOT_FOUND: {
    error:       'Content mapping unavailable',
    description: 'No compatible content mapping was found for this title.',
    action:      'Try again later or select another title.'
  },
  MAPPING_AMBIGUOUS: {
    error:       'Content mapping ambiguous',
    description: 'More than one content mapping matched and the request could not be completed safely.',
    action:      'Use a more specific title or identifier.'
  },
  MAPPING_TYPE_MISMATCH: {
    error:       'Content type mismatch',
    description: 'The mapped source does not match the requested movie, TV, or anime type.',
    action:      'Verify the content type and try again.'
  },
  REGION_RESTRICTED: {
    error:       'Content restricted',
    description: 'This content is not available for access from your current location.',
    action:      'Access to this title is limited in your region. Try a different title or check your connection.'
  },
  SECURE_LINK_ERROR: {
    error:       'Connection error',
    description: 'We found the content but could not establish a secure handshake with the source.',
    action:      'This is a technical issue with the source. Please report this to the Spün team.'
  },
  GATEWAY_TIMEOUT: {
    error:       'Request timed out',
    description: 'The Spün infrastructure took too long to process the request.',
    action:      'This usually happens with heavy searches. Please try again in a moment.'
  },
  RATE_LIMIT: {
    error:       'Too many requests',
    description: 'You have exceeded the allowed number of requests in a short period.',
    action:      'Please wait a few seconds before making another request.'
  },
  MAINTENANCE: {
    error:       'Scheduled maintenance',
    description: 'The API is currently undergoing scheduled maintenance.',
    action:      "We'll be back shortly. Check our status page for updates."
  },
  METHOD_NOT_ALLOWED: {
    error:       'Method not allowed',
    description: 'You tried to use an invalid HTTP method for this endpoint.',
    action:      'Check the API documentation for the supported HTTP methods.'
  },
  SUBTITLE_UNAVAILABLE: {
    error:       'Subtitle track unavailable',
    description: 'We could not retrieve the subtitle archive from the source.',
    action:      'This is usually a temporary connection issue. Please try again in a moment.'
  },
  SUBTITLE_ARCHIVE_INVALID: {
    error:       'Invalid subtitle archive',
    description: 'The retrieved subtitle archive is corrupt or uses an unsupported format.',
    action:      'Our automated systems have been notified. Please try a different subtitle track.'
  },
  SUBTITLE_TRACK_NOT_FOUND: {
    error:       'Subtitle track not found',
    description: 'The archive was retrieved, but it does not contain a usable subtitle file for the requested language.',
    action:      'Try selecting a different subtitle track or language.'
  },
  SUBTITLE_CONVERSION_FAILED: {
    error:       'Subtitle preparation failed',
    description: 'We found the subtitle track but could not convert it to a format playable in your browser.',
    action:      'This is a technical issue with the source file. Please try a different track.'
  },
  RESOLVE_NAMESPACE_UNSUPPORTED: {
    error:       'Identifier type not supported',
    description: 'The requested identifier namespace is not currently supported by Spün Media API.',
    action:      'Request one of the supported identifier namespaces from GET /v1/resolve.'
  },
  RESOLVE_IDENTIFIER_REQUIRED: {
    error:       'Identifier required',
    description: 'No identifier was provided for resolution.',
    action:      'Provide an id query parameter with the requested identifier.'
  },
  RESOLVE_IDENTIFIER_INVALID: {
    error:       'Invalid identifier',
    description: 'The supplied identifier is not valid for the requested identifier namespace.',
    action:      'Check the identifier format and try the request again.'
  },
  RESOLVE_NAMESPACE_TYPE_MISMATCH: {
    error:       'Identifier type mismatch',
    description: 'The resolved title is not compatible with the requested content type.',
    action:      'Use an identifier from the supported content type for this namespace.'
  },
  RESOLVE_CONTENT_NOT_FOUND: {
    error:       'Content not found',
    description: 'The identifier was processed successfully, but no matching title was found.',
    action:      'Verify the identifier or try another supported identifier namespace.'
  },
  RESOLVE_AMBIGUOUS: {
    error:       'Multiple matches found',
    description: 'The identifier returned more than one possible title and could not be resolved safely.',
    action:      'Use a more specific identifier or provide the correct identifier namespace.'
  },
  RESOLVE_METADATA_UNAVAILABLE: {
    error:       'Metadata temporarily unavailable',
    description: 'The title could not be resolved because the metadata service is temporarily unavailable.',
    action:      'Please try again in a few moments.'
  },
  RESOLVE_METADATA_TIMEOUT: {
    error:       'Metadata request timed out',
    description: 'The metadata resolution request took too long to complete.',
    action:      'Please try again in a few moments.'
  },
  RESOLVE_REGISTRATION_FAILED: {
    error:       'Catalog registration failed',
    description: 'The title was found, but Spün could not register its identity in the catalog.',
    action:      'Please try again later.'
  },
  RESOLVE_CONFLICT: {
    error:       'Resolution conflict',
    description: 'Another catalog operation conflicted with this resolution request.',
    action:      'Please retry the request.'
  },
  RESOLVE_UNSUPPORTED_RESULT: {
    error:       'Unsupported metadata result',
    description: 'The resolved title could not be normalized into a supported Spün content model.',
    action:      'Try another identifier or namespace.'
  },
  UNSUPPORTED_SUBJECT_TYPE: {
    error:       'Unsupported subject type',
    description: 'Only movie and TV subjects are supported by the Spün Media API.',
    action:      'Use subject type 1 for movies or 2 for TV content.'
  },
  INTERNAL_ERROR: {
    error:       'Unexpected error',
    description: 'An internal error occurred while processing your request.',
    action:      'We are looking into it. Please try again later.'
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
