// Embed/media extractors — resolve provider-specific embed URLs into direct media.
// Each extractor takes an embed URL (or provider-specific identifier) and returns
// direct stream URLs + subtitles. All inputs are treated as untrusted data; nothing
// upstream is ever executed.

export { extractMegaPlay, decryptMegaPlay } from './megaplay.js';
export type { MegaPlayResult, MegaPlayTrack } from './megaplay.js';

export { extractFlixCloud, decryptFlixPlaylist } from './flixcloud.js';
export type { FlixCloudResult } from './flixcloud.js';

export { extractFlikhub, flikhubToRawStreams, flikhubToRawSubtitles } from './flikhub.js';
export type { FlikhubResult, FlikhubSource, FlikhubTrack } from './flikhub.js';