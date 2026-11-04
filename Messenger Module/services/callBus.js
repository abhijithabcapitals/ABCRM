// How a chat's Call button reaches the call screen, which sits above every page. No imports.
let listener = null;
export const onStartCall = (fn) => { listener = fn; return () => { if (listener === fn) listener = null; }; };
export const startCall = (request) => listener?.(request);
