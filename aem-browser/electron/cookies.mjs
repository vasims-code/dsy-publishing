/**
 * Keeps session cookies across restarts, the way Chrome does with "Continue where you
 * left off". WDS single sign-on and the AEM login token are session cookies: without
 * this, every start of the browser would mean signing in again.
 *
 * They are written encrypted with the operating system's own protection (DPAPI on
 * Windows, via safeStorage) - the same protection Chrome gives its cookie store - and
 * nothing is written at all when that is not available.
 */
import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

const file = () => path.join(app.getPath("userData"), "session-cookies.bin");

export async function saveSessionCookies(ses) {
  if (!safeStorage.isEncryptionAvailable()) return;
  try {
    const cookies = (await ses.cookies.get({})).filter((c) => c.session);
    const list = cookies.map((c) => ({
      url: `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`,
      name: c.name,
      value: c.value,
      domain: c.hostOnly ? undefined : c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    }));
    fs.writeFileSync(file(), safeStorage.encryptString(JSON.stringify({ at: Date.now(), list })));
  } catch (e) {
    console.error("Could not keep session cookies", e);
  }
}

export async function restoreSessionCookies(ses) {
  if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(file())) return 0;
  let n = 0;
  try {
    const { list } = JSON.parse(safeStorage.decryptString(fs.readFileSync(file())));
    for (const c of list) {
      // No expirationDate: they come back as session cookies, as they were.
      await ses.cookies.set(c).then(
        () => n++,
        () => {}
      );
    }
  } catch (e) {
    console.error("Could not restore session cookies", e);
  }
  return n;
}
