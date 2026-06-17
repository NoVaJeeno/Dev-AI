const ENCRYPTION_MARKER = '::ENC::';
const VERSION = 'v1';

function generateKey(passphrase: string): number[] {
  const key: number[] = [];
  for (let i = 0; i < passphrase.length; i++) {
    key.push(passphrase.charCodeAt(i));
  }
  let expanded: number[] = [...key];
  while (expanded.length < 256) {
    const last = expanded[expanded.length - 1];
    const prev = expanded[expanded.length - 2] || 0;
    expanded.push((last * 31 + prev + expanded.length) & 0xFF);
  }
  return expanded;
}

function xorTransform(data: string, key: number[]): string {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const charCode = data.charCodeAt(i);
    const keyByte = key[i % key.length];
    result.push(charCode ^ keyByte);
  }
  return result.map(c => String.fromCharCode(c)).join('');
}

function toBase64(str: string): string {
  try {
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
      bytes[i] = str.charCodeAt(i) & 0xFF;
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

function fromBase64(b64: string): string {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(bytes).map(b => String.fromCharCode(b)).join('');
  } catch {
    return decodeURIComponent(escape(atob(b64)));
  }
}

export function encryptData(data: string, passphrase: string): string {
  try {
    if (!data || !passphrase) return data;
    const key = generateKey(passphrase);
    const transformed = xorTransform(data, key);
    const encoded = toBase64(transformed);
    return `${ENCRYPTION_MARKER}${VERSION}:${encoded}`;
  } catch (e) {
    console.error('[Encryption] Encrypt failed:', e);
    return data;
  }
}

export function decryptData(encrypted: string, passphrase: string): string {
  try {
    if (!encrypted || !passphrase) return encrypted;
    if (!encrypted.startsWith(ENCRYPTION_MARKER)) return encrypted;

    const withoutMarker = encrypted.slice(ENCRYPTION_MARKER.length);
    const colonIdx = withoutMarker.indexOf(':');
    if (colonIdx === -1) return encrypted;

    const encoded = withoutMarker.slice(colonIdx + 1);
    const key = generateKey(passphrase);
    const decoded = fromBase64(encoded);
    return xorTransform(decoded, key);
  } catch (e) {
    console.error('[Encryption] Decrypt failed:', e);
    return encrypted;
  }
}

export function isEncrypted(data: string): boolean {
  return typeof data === 'string' && data.startsWith(ENCRYPTION_MARKER);
}

export function encryptObject<T>(obj: T, passphrase: string): string {
  try {
    const json = JSON.stringify(obj);
    return encryptData(json, passphrase);
  } catch (e) {
    console.error('[Encryption] encryptObject failed:', e);
    return JSON.stringify(obj);
  }
}

export function decryptObject<T>(encrypted: string, passphrase: string): T | null {
  try {
    const decrypted = decryptData(encrypted, passphrase);
    return JSON.parse(decrypted) as T;
  } catch (e) {
    console.error('[Encryption] decryptObject failed:', e);
    try {
      return JSON.parse(encrypted) as T;
    } catch {
      return null;
    }
  }
}

export function generateDeviceFingerprint(): string {
  const base = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash) + base.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
