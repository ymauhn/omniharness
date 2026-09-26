// Minimal browser globals every app/*.mjs module needs merely to be imported outside a browser:
// state.mjs reads location.search once at import time, and workspace.mjs reads location.search
// and registers a window listener once per createWorkspace() call. A test that drives a real DOM
// still sets its own fake `document`; this file only keeps a bare import from throwing.
// Import this before any app/*.mjs import (import ordering runs it first).
if (typeof globalThis.location === 'undefined') globalThis.location = { search: '', href: 'http://localhost/', pathname: '/' };
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener() {}, removeEventListener() {}, open() {} };
