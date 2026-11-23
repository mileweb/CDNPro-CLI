/**
 * Strings that come back from the API (names, comments, error bodies) are
 * attacker-influenceable. Printed raw to a terminal, an ESC byte can rewrite the
 * screen, retitle the window, or hide text. JSON output is already safe because
 * JSON.stringify escapes control characters; this covers table/human output.
 *
 * Newlines and tabs are kept (they are layout, not control sequences); every
 * other C0/C1 control character, DEL included, is shown as a visible \xNN escape.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export function sanitizeForTerminal(text: string): string {
  return text.replace(CONTROL_CHARS, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
