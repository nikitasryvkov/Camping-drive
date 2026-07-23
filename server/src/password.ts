import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

const algorithm = "scrypt";
const keyLength = 64;
const saltLength = 16;
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const maxMemory = 64 * 1024 * 1024;

const dummyPasswordHash = hashPassword(randomBytes(32).toString("base64url"));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const derivedKey = await deriveKey(password, salt);

  return [
    algorithm,
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) {
    return false;
  }

  const actualKey = await deriveKey(password, parsed.salt);
  return timingSafeEqual(actualKey, parsed.derivedKey);
}

export async function verifyPasswordOrDummy(
  password: string,
  encodedHash: string | undefined,
): Promise<boolean> {
  return verifyPassword(password, encodedHash ?? (await dummyPasswordHash));
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: maxMemory,
  });
}

function parsePasswordHash(
  encodedHash: string,
): { salt: Buffer; derivedKey: Buffer } | undefined {
  const parts = encodedHash.split("$");
  if (parts.length !== 6) {
    return undefined;
  }
  const [encodedAlgorithm, encodedCost, encodedBlockSize, encodedParallelization, salt, key] = parts;

  if (
    encodedAlgorithm !== algorithm ||
    encodedCost !== String(cost) ||
    encodedBlockSize !== String(blockSize) ||
    encodedParallelization !== String(parallelization) ||
    !salt ||
    !key
  ) {
    return undefined;
  }

  try {
    const decodedSalt = Buffer.from(salt, "base64url");
    const decodedKey = Buffer.from(key, "base64url");

    if (
      decodedSalt.length !== saltLength ||
      decodedKey.length !== keyLength ||
      decodedSalt.toString("base64url") !== salt ||
      decodedKey.toString("base64url") !== key
    ) {
      return undefined;
    }

    return { salt: decodedSalt, derivedKey: decodedKey };
  } catch {
    return undefined;
  }
}
