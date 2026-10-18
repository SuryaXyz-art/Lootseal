// This file is part of Lootseal.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Passphrase-encrypted backups of a participant's private state for one
// drop: the publisher's "fulfiller bundle", or a holder's key backup.
// AES-256-GCM with a PBKDF2-SHA256 key (310k iterations), via Web Crypto,
// which both browsers and Node 22 provide. Browser-safe.
import { type LootsealPrivateState } from './witnesses.js';

export const BUNDLE_KIND = 'lootseal-private-state';
export const BUNDLE_VERSION = 1;
const ITERATIONS = 310_000;

export interface EncryptedBundle {
  kind: typeof BUNDLE_KIND;
  version: typeof BUNDLE_VERSION;
  /** The drop this state belongs to (hex contract address). */
  dropAddress: string;
  /** Whether it carries publisher secrets (a fulfiller bundle). */
  publisher: boolean;
  salt: string;
  iv: string;
  ciphertext: string;
}

const b64 = (u: Uint8Array): string => {
  let s = '';
  for (const byte of u) s += String.fromCharCode(byte);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** JSON with bigint and Uint8Array preserved. */
export const encodeState = (ps: LootsealPrivateState): string =>
  JSON.stringify(ps, (_k, v) => {
    if (typeof v === 'bigint') return { $bigint: v.toString() };
    if (v instanceof Uint8Array) return { $bytes: b64(v) };
    return v;
  });

export const decodeState = (json: string): LootsealPrivateState =>
  JSON.parse(json, (_k, v) => {
    if (v && typeof v === 'object' && typeof v.$bigint === 'string') return BigInt(v.$bigint);
    if (v && typeof v === 'object' && typeof v.$bytes === 'string') return unb64(v.$bytes);
    return v;
  }) as LootsealPrivateState;

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt, iterations: ITERATIONS },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptBundle(
  dropAddress: string,
  ps: LootsealPrivateState,
  passphrase: string,
): Promise<EncryptedBundle> {
  if (passphrase.length < 12) throw new Error('Use a passphrase of at least 12 characters');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const plain = new TextEncoder().encode(encodeState(ps));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plain));
  return {
    kind: BUNDLE_KIND,
    version: BUNDLE_VERSION,
    dropAddress,
    publisher: ps.publisher !== null,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ciphertext),
  };
}

export async function decryptBundle(bundle: EncryptedBundle, passphrase: string): Promise<LootsealPrivateState> {
  if (bundle.kind !== BUNDLE_KIND || bundle.version !== BUNDLE_VERSION) {
    throw new Error('This file is not a Lootseal backup');
  }
  const key = await deriveKey(passphrase, unb64(bundle.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(bundle.iv) }, key, unb64(bundle.ciphertext));
  } catch {
    throw new Error('Wrong passphrase, or the backup is damaged');
  }
  return decodeState(new TextDecoder().decode(plain));
}

export const parseBundle = (text: string): EncryptedBundle => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Lootseal backup');
  }
  const b = parsed as Partial<EncryptedBundle>;
  if (b.kind !== BUNDLE_KIND || typeof b.ciphertext !== 'string' || typeof b.dropAddress !== 'string') {
    throw new Error('This file is not a Lootseal backup');
  }
  return b as EncryptedBundle;
};
