// package.json's version is the one source of truth for "what version is
// this" — bumped to match the stage number as of this stage onward (see
// package.json). Reading it here rather than hardcoding a duplicate
// string means AppVersion.jsx can never drift out of sync with what
// actually shipped.
import pkg from '../package.json';

export const APP_VERSION = pkg.version;
